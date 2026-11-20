"""Meeting metadata (title, time, organiser, attendees) from calendars.

- Microsoft Graph: Outlook / Microsoft 365, after the user grants consent via OAuth.
- ICS: a meeting-invite file, no cloud setup needed.
A Google Calendar provider can be added with the same CalendarEvent output.
"""
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote, urlencode

import httpx
from icalendar import Calendar
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import CalendarConnection
from app.security import decrypt, encrypt


@dataclass
class Attendee:
    name: str
    email: str | None
    optional: bool = False


@dataclass
class CalendarEvent:
    event_id: str
    title: str
    start: datetime | None
    end: datetime | None
    organizer_name: str | None
    organizer_email: str | None
    attendees: list[Attendee] = field(default_factory=list)
    join_url: str | None = None


class CalendarError(Exception):
    pass


class CalendarNotConnected(CalendarError):
    pass


# --- ICS ---------------------------------------------------------------------------------------


def _ics_person(prop) -> tuple[str | None, str | None]:
    if prop is None:
        return None, None
    email = str(prop)
    email = email[7:] if email.lower().startswith("mailto:") else email
    name = prop.params.get("CN") if hasattr(prop, "params") else None
    return (str(name) if name else None), (email or None)


def _as_utc(v) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v.astimezone(timezone.utc)
    if isinstance(v, date):  # all-day event
        return datetime(v.year, v.month, v.day, tzinfo=timezone.utc)
    return None


def parse_ics(data: bytes) -> CalendarEvent:
    try:
        cal = Calendar.from_ical(data)
    except Exception as e:  # noqa: BLE001 - icalendar raises various types on bad input
        raise CalendarError(f"Not a valid .ics file: {e}") from e
    events = [c for c in cal.walk("VEVENT")]
    if not events:
        raise CalendarError("No VEVENT found in .ics file")
    ev = events[0]

    org_name, org_email = _ics_person(ev.get("ORGANIZER"))
    raw_att = ev.get("ATTENDEE")
    raw_att = [] if raw_att is None else (raw_att if isinstance(raw_att, list) else [raw_att])
    attendees = []
    for a in raw_att:
        name, email = _ics_person(a)
        if a.params.get("CUTYPE", "INDIVIDUAL").upper() not in ("INDIVIDUAL", "UNKNOWN"):
            continue  # skip rooms / resources
        attendees.append(Attendee(
            name=name or (email.split("@")[0] if email else "Unknown"),
            email=email,
            optional=str(a.params.get("ROLE", "")).upper() == "OPT-PARTICIPANT",
        ))

    def dt(key):
        prop = ev.get(key)
        return _as_utc(prop.dt) if prop is not None else None

    join = ev.get("X-MICROSOFT-SKYPETEAMSMEETINGURL") or ev.get("URL")
    return CalendarEvent(
        event_id=str(ev.get("UID", "")) or "ics",
        title=str(ev.get("SUMMARY", "")).strip() or "Untitled meeting",
        start=dt("DTSTART"),
        end=dt("DTEND"),
        organizer_name=org_name,
        organizer_email=org_email,
        attendees=attendees,
        join_url=str(join) if join else None,
    )


# --- Microsoft Graph ---------------------------------------------------------------------------

MS_SCOPES = "offline_access openid email User.Read Calendars.Read"
GRAPH = "https://graph.microsoft.com/v1.0"


class MicrosoftCalendar:
    def __init__(self, http: httpx.Client | None = None):
        s = get_settings()
        if not s.ms_client_id:
            raise CalendarError("Microsoft calendar is not configured (MS_CLIENT_ID is empty)")
        self.s = s
        self.http = http or httpx.Client(timeout=20)
        self.authority = f"https://login.microsoftonline.com/{s.ms_tenant}/oauth2/v2.0"

    # OAuth: the user sees Microsoft's consent screen listing exactly MS_SCOPES.
    def authorization_url(self, state: str) -> str:
        return f"{self.authority}/authorize?" + urlencode({
            "client_id": self.s.ms_client_id,
            "response_type": "code",
            "redirect_uri": self.s.ms_redirect_uri,
            "response_mode": "query",
            "scope": MS_SCOPES,
            "state": state,
            "prompt": "select_account",
        })

    def _token_request(self, **data) -> dict:
        r = self.http.post(f"{self.authority}/token", data={
            "client_id": self.s.ms_client_id,
            "client_secret": self.s.ms_client_secret or "",
            "scope": MS_SCOPES,
            **data,
        })
        body = r.json()
        if r.status_code != 200:
            raise CalendarError(f"Token request failed: {body.get('error_description') or body.get('error')}")
        return body

    def connect(self, db: Session, user_id: int, code: str) -> CalendarConnection:
        tok = self._token_request(grant_type="authorization_code", code=code, redirect_uri=self.s.ms_redirect_uri)
        me = self.http.get(f"{GRAPH}/me", headers={"Authorization": f"Bearer {tok['access_token']}"}).json()
        conn = db.query(CalendarConnection).filter_by(user_id=user_id, provider="microsoft").one_or_none()
        if conn is None:
            conn = CalendarConnection(user_id=user_id, provider="microsoft")
            db.add(conn)
        conn.account_email = me.get("mail") or me.get("userPrincipalName")
        self._store(conn, tok)
        conn.connected_at = datetime.now(timezone.utc)
        db.commit()
        return conn

    def _store(self, conn: CalendarConnection, tok: dict) -> None:
        conn.scopes = tok.get("scope", MS_SCOPES)
        conn.access_token_enc = encrypt(tok["access_token"])
        if tok.get("refresh_token"):
            conn.refresh_token_enc = encrypt(tok["refresh_token"])
        conn.access_token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(tok.get("expires_in", 3600)) - 60)

    def _access_token(self, db: Session, conn: CalendarConnection) -> str:
        token = decrypt(conn.access_token_enc)
        expires = conn.access_token_expires_at
        if expires is not None and expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if token and expires and expires > datetime.now(timezone.utc):
            return token
        refresh = decrypt(conn.refresh_token_enc)
        if not refresh:
            raise CalendarNotConnected("Calendar access expired; please reconnect")
        self._store(conn, self._token_request(grant_type="refresh_token", refresh_token=refresh))
        db.commit()
        return decrypt(conn.access_token_enc)

    def _get(self, db: Session, conn: CalendarConnection, url: str, params: dict | None = None) -> dict:
        r = self.http.get(url, params=params, headers={
            "Authorization": f"Bearer {self._access_token(db, conn)}",
            "Prefer": 'outlook.timezone="UTC"',
        })
        if r.status_code == 404:
            raise CalendarError("Calendar event not found")
        if r.status_code == 401:
            raise CalendarNotConnected("Calendar access was revoked; please reconnect")
        if r.status_code >= 400:
            raise CalendarError(f"Microsoft Graph error {r.status_code}: {r.text[:200]}")
        return r.json()

    @staticmethod
    def _to_event(e: dict) -> CalendarEvent:
        def dt(v):
            if not v or not v.get("dateTime"):
                return None
            return datetime.fromisoformat(v["dateTime"][:26]).replace(tzinfo=timezone.utc)

        org = (e.get("organizer") or {}).get("emailAddress") or {}
        attendees = []
        for a in e.get("attendees") or []:
            if a.get("type") == "resource":
                continue
            ea = a.get("emailAddress") or {}
            attendees.append(Attendee(
                name=ea.get("name") or (ea.get("address") or "Unknown").split("@")[0],
                email=ea.get("address"),
                optional=a.get("type") == "optional",
            ))
        return CalendarEvent(
            event_id=e["id"],
            title=e.get("subject") or "Untitled meeting",
            start=dt(e.get("start")),
            end=dt(e.get("end")),
            organizer_name=org.get("name"),
            organizer_email=org.get("address"),
            attendees=attendees,
            join_url=(e.get("onlineMeeting") or {}).get("joinUrl"),
        )

    _SELECT = "id,subject,start,end,organizer,attendees,onlineMeeting"

    def list_events(self, db: Session, conn: CalendarConnection, start: datetime, end: datetime) -> list[CalendarEvent]:
        data = self._get(db, conn, f"{GRAPH}/me/calendarView", {
            "startDateTime": start.astimezone(timezone.utc).isoformat(),
            "endDateTime": end.astimezone(timezone.utc).isoformat(),
            "$select": self._SELECT, "$orderby": "start/dateTime", "$top": "50",
        })
        return [self._to_event(e) for e in data.get("value", [])]

    def get_event(self, db: Session, conn: CalendarConnection, event_id: str) -> CalendarEvent:
        return self._to_event(self._get(db, conn, f"{GRAPH}/me/events/{quote(event_id, safe='')}", {"$select": self._SELECT}))


def get_microsoft_calendar() -> MicrosoftCalendar:
    return MicrosoftCalendar()
