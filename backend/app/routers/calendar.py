import logging
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import CalendarConnection, CalendarSource, User
from app.schemas import AttendeeOut, AuthorizationUrl, CalendarConnectionOut, CalendarEventOut, CalendarProviderOut
from app.security import CurrentUser, sign_state, verify_state
from app.services.calendar import (
    CalendarError,
    CalendarEvent,
    CalendarNotConnected,
    GoogleCalendar,
    MicrosoftCalendar,
    OAuthCalendar,
    get_google_calendar,
    get_microsoft_calendar,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/calendar", tags=["calendar"])
DB = Annotated[Session, Depends(get_db)]
Provider = Literal["google", "microsoft"]
PROVIDER_ORDER = (CalendarSource.google, CalendarSource.microsoft)


def ms_optional() -> MicrosoftCalendar | None:
    """None when Microsoft calendar isn't configured (MS_CLIENT_ID empty)."""
    try:
        return get_microsoft_calendar()
    except CalendarError:
        return None


def google_optional() -> GoogleCalendar | None:
    """None when Google calendar isn't configured (GOOGLE_CLIENT_ID empty)."""
    try:
        return get_google_calendar()
    except CalendarError:
        return None


def calendars(
    ms: Annotated[MicrosoftCalendar | None, Depends(ms_optional)],
    google: Annotated[GoogleCalendar | None, Depends(google_optional)],
) -> dict[CalendarSource, OAuthCalendar | None]:
    return {CalendarSource.microsoft: ms, CalendarSource.google: google}


Calendars = Annotated[dict[CalendarSource, OAuthCalendar | None], Depends(calendars)]
LABELS = {CalendarSource.microsoft: "Outlook", CalendarSource.google: "Google"}


def require_calendar(cals: dict, provider: CalendarSource) -> OAuthCalendar:
    cal = cals.get(provider)
    if cal is None:
        env = "MS_CLIENT_ID" if provider == CalendarSource.microsoft else "GOOGLE_CLIENT_ID"
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            f"{LABELS[provider]} calendar is not configured on the server ({env} is empty)")
    return cal


def event_out(e: CalendarEvent, provider: CalendarSource) -> CalendarEventOut:
    return CalendarEventOut(
        provider=provider.value,
        event_id=e.event_id, title=e.title, start=e.start, end=e.end,
        organizer_name=e.organizer_name, organizer_email=e.organizer_email,
        attendees=[AttendeeOut(name=a.name, email=a.email, optional=a.optional) for a in e.attendees],
        join_url=e.join_url,
    )


def get_connection(db: Session, user: User, provider: CalendarSource) -> CalendarConnection:
    conn = db.query(CalendarConnection).filter_by(user_id=user.id, provider=provider).one_or_none()
    if conn is None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"{provider.value} calendar not connected. Call GET /calendar/{provider.value}/connect first.")
    return conn


@router.get("/providers", response_model=list[CalendarProviderOut])
def providers(cals: Calendars):
    """Which calendars this server can connect to (configured by the admin)."""
    return [CalendarProviderOut(provider=p.value, configured=cals[p] is not None) for p in PROVIDER_ORDER]


@router.get("/{provider}/connect", response_model=AuthorizationUrl)
def connect(provider: Provider, user: CurrentUser, cals: Calendars):
    """Returns the provider's sign-in/consent URL. The user opens it, reviews the requested
    permissions (read-only calendar, basic profile) and approves."""
    src = CalendarSource(provider)
    cal = require_calendar(cals, src)
    return AuthorizationUrl(authorization_url=cal.authorization_url(sign_state({"uid": user.id, "p": provider})))


def _page(title: str, message: str, code: int = 200) -> HTMLResponse:
    return HTMLResponse(
        f"<!doctype html><meta charset=utf-8><title>{escape(title)}</title>"
        f"<body style='font-family:system-ui;max-width:32rem;margin:4rem auto'>"
        f"<h2>{escape(title)}</h2><p>{escape(message)}</p></body>",
        status_code=code,
    )


@router.get("/{provider}/callback", response_class=HTMLResponse, include_in_schema=False)
def callback(
    provider: Provider,
    db: DB,
    cals: Calendars,
    state: str,
    code: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
):
    payload = verify_state(state)
    if payload.get("p") != provider:
        return _page("Calendar not connected", "This sign-in link belongs to a different calendar.", 400)
    cal = require_calendar(cals, CalendarSource(provider))
    if error:
        return _page("Calendar not connected", error_description or error, 400)
    if not code:
        return _page("Calendar not connected", "Missing authorization code.", 400)
    try:
        conn = cal.connect(db, payload["uid"], code)
    except CalendarError as e:
        return _page("Calendar not connected", str(e), 400)
    return _page("Calendar connected",
                 f"Connected {conn.account_email or 'your account'}. You can close this window and press Refresh in MinutesAI.")


@router.get("/connections", response_model=list[CalendarConnectionOut])
def list_connections(user: CurrentUser, db: DB):
    return db.query(CalendarConnection).filter_by(user_id=user.id).all()


@router.delete("/connections/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def disconnect(provider: CalendarSource, user: CurrentUser, db: DB):
    """Withdraw consent: stored tokens are deleted. (Users can also revoke the app at
    https://myaccount.google.com/permissions or https://myapps.microsoft.com.)"""
    db.delete(get_connection(db, user, provider))
    db.commit()


@router.get("/events", response_model=list[CalendarEventOut])
def list_events(
    user: CurrentUser,
    db: DB,
    cals: Calendars,
    start: Annotated[datetime | None, Query(description="Default: 2 hours ago")] = None,
    end: Annotated[datetime | None, Query(description="Default: 12 hours from now")] = None,
):
    """Meetings around now from every connected calendar, so the user can pick the one they are joining."""
    now = datetime.now(timezone.utc)
    start = start or now - timedelta(hours=2)
    end = end or now + timedelta(hours=12)
    conns = [c for c in db.query(CalendarConnection).filter_by(user_id=user.id).all()
             if c.provider in cals and cals[c.provider] is not None]
    if not conns:
        raise HTTPException(status.HTTP_409_CONFLICT, "No calendar connected. Connect Google Calendar or Outlook first.")
    events: list[CalendarEventOut] = []
    problems: list[tuple[CalendarError, CalendarSource]] = []
    for conn in conns:
        try:
            events += [event_out(e, conn.provider) for e in cals[conn.provider].list_events(db, conn, start, end)]
        except CalendarError as e:  # one calendar failing shouldn't hide the others
            log.warning("Listing %s events for user %s failed: %s", conn.provider.value, user.id, e)
            problems.append((e, conn.provider))
    if problems and not events and len(problems) == len(conns):
        err, _ = problems[0]
        code = status.HTTP_409_CONFLICT if isinstance(err, CalendarNotConnected) else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(code, str(err))
    far_future = datetime.max.replace(tzinfo=timezone.utc)
    return sorted(events, key=lambda e: e.start or far_future)
