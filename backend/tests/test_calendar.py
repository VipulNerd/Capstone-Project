"""Calendar sources: .ics invites and Microsoft Graph (Outlook) with OAuth consent.
Graph is exercised through the real MicrosoftCalendar class over a mocked HTTP transport."""
import json
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.config import get_settings
from app.main import app
from app.models import CalendarConnection
from app.routers.calendar import ms_optional
from app.services.calendar import MicrosoftCalendar, parse_ics

INVITE = b"""BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VTIMEZONE\r
TZID:India Standard Time\r
BEGIN:STANDARD\r
DTSTART:16010101T000000\r
TZOFFSETFROM:+0530\r
TZOFFSETTO:+0530\r
END:STANDARD\r
END:VTIMEZONE\r
BEGIN:VEVENT\r
UID:abc-123\r
SUMMARY:Sprint planning\r
DTSTART;TZID=India Standard Time:20261120T153000\r
DTEND;TZID=India Standard Time:20261120T163000\r
ORGANIZER;CN=Bob Kumar:mailto:bob@example.com\r
ATTENDEE;CN=Carol;ROLE=REQ-PARTICIPANT:mailto:carol@example.com\r
ATTENDEE;CN=Dan;ROLE=OPT-PARTICIPANT:mailto:dan@example.com\r
ATTENDEE;CN=Vipul;ROLE=REQ-PARTICIPANT:mailto:VIPUL@example.com\r
ATTENDEE;CUTYPE=ROOM;CN=Room 4:mailto:room4@example.com\r
X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/xyz\r
END:VEVENT\r
END:VCALENDAR\r
"""


# --- ICS ---------------------------------------------------------------------------------------


def test_parse_ics():
    ev = parse_ics(INVITE)
    assert ev.title == "Sprint planning" and ev.event_id == "abc-123"
    assert ev.start == datetime(2026, 11, 20, 10, 0, tzinfo=timezone.utc)  # IST -> UTC
    assert (ev.organizer_name, ev.organizer_email) == ("Bob Kumar", "bob@example.com")
    assert [(a.name, a.optional) for a in ev.attendees] == [("Carol", False), ("Dan", True), ("Vipul", False)]
    assert ev.join_url.startswith("https://teams.microsoft.com/")


def test_start_from_ics(client, auth):
    r = client.post("/meetings/from-ics", headers=auth, data={"recording_consent": "true"},
                    files={"invite": ("invite.ics", INVITE)})
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["calendar_source"] == "ics" and m["title"] == "Sprint planning"
    assert m["organizer_email"] == "bob@example.com" and m["meeting_date"] == "2026-11-20"
    people = {p["email"].lower(): (p["source"], p["is_optional"]) for p in m["participants"]}
    # Organiser + attendees, room excluded, recording user not duplicated (case-insensitive)
    assert people == {
        "bob@example.com": ("calendar", False), "carol@example.com": ("calendar", False),
        "dan@example.com": ("calendar", True), "vipul@example.com": ("calendar", False),
    }


def test_start_from_ics_rejects_bad_input(client, auth):
    bad = client.post("/meetings/from-ics", headers=auth, data={"recording_consent": "true"},
                      files={"invite": ("x.ics", b"not a calendar")})
    assert bad.status_code == 422
    no_consent = client.post("/meetings/from-ics", headers=auth, data={"recording_consent": "false"},
                             files={"invite": ("x.ics", INVITE)})
    assert no_consent.status_code == 422


# --- Microsoft Graph ---------------------------------------------------------------------------


class GraphMock:
    """Fake login.microsoftonline.com + graph.microsoft.com."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.token_count = 0
        self.revoked = False

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        if req.url.path.endswith("/oauth2/v2.0/token"):
            form = parse_qs(req.content.decode())
            if form.get("code") == ["bad"]:
                return httpx.Response(400, json={"error": "invalid_grant", "error_description": "Code expired"})
            self.token_count += 1
            return httpx.Response(200, json={
                "access_token": f"AT{self.token_count}", "refresh_token": f"RT{self.token_count}",
                "expires_in": 3600, "scope": "Calendars.Read User.Read"})
        if self.revoked:
            return httpx.Response(401, json={"error": {"code": "InvalidAuthenticationToken"}})
        if req.url.path == "/v1.0/me":
            return httpx.Response(200, json={"mail": "vipul@contoso.com"})
        event = {
            "id": "AAMk/evt+1=",
            "subject": "Design review",
            "start": {"dateTime": "2026-11-20T09:00:00.0000000", "timeZone": "UTC"},
            "end": {"dateTime": "2026-11-20T10:00:00.0000000", "timeZone": "UTC"},
            "organizer": {"emailAddress": {"name": "Bob", "address": "bob@contoso.com"}},
            "attendees": [
                {"type": "required", "emailAddress": {"name": "Carol", "address": "carol@contoso.com"}},
                {"type": "optional", "emailAddress": {"name": "Dan", "address": "dan@contoso.com"}},
                {"type": "resource", "emailAddress": {"name": "Room 1", "address": "room1@contoso.com"}},
            ],
            "onlineMeeting": {"joinUrl": "https://teams.microsoft.com/l/meetup-join/abc"},
        }
        if req.url.path == "/v1.0/me/calendarView":
            return httpx.Response(200, json={"value": [event]})
        if req.url.path.startswith("/v1.0/me/events/"):
            return httpx.Response(200, json=event)
        return httpx.Response(404, json={})


@pytest.fixture
def graph(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "ms_client_id", "client-123")
    monkeypatch.setattr(get_settings(), "ms_client_secret", "shh")
    mock = GraphMock()
    app.dependency_overrides[ms_optional] = lambda: MicrosoftCalendar(http=httpx.Client(transport=httpx.MockTransport(mock)))
    return mock


def connect(client, auth) -> None:
    url = client.get("/calendar/microsoft/connect", headers=auth).json()["authorization_url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    r = client.get("/calendar/microsoft/callback", params={"code": "good", "state": state})
    assert r.status_code == 200 and "Calendar connected" in r.text, r.text


def test_not_configured_returns_503(client, auth):
    assert client.get("/calendar/microsoft/connect", headers=auth).status_code == 503
    r = client.post("/meetings", headers=auth, json={"recording_consent": True, "calendar_event_id": "x"})
    assert r.status_code == 503


def test_consent_url(client, auth, graph):
    url = client.get("/calendar/microsoft/connect", headers=auth).json()["authorization_url"]
    q = parse_qs(urlparse(url).query)
    assert q["client_id"] == ["client-123"] and q["response_type"] == ["code"]
    assert "Calendars.Read" in q["scope"][0] and "offline_access" in q["scope"][0]
    assert q["redirect_uri"] == ["http://localhost:8000/calendar/microsoft/callback"]


def test_callback_stores_encrypted_tokens(client, auth, graph, session_factory):
    connect(client, auth)
    conns = client.get("/calendar/connections", headers=auth).json()
    assert [(c["provider"], c["account_email"]) for c in conns] == [("microsoft", "vipul@contoso.com")]
    with session_factory() as db:
        row = db.query(CalendarConnection).one()
        assert "AT1" not in row.access_token_enc and "RT1" not in row.refresh_token_enc


def test_callback_rejects_tampered_state_and_errors(client, auth, graph):
    assert client.get("/calendar/microsoft/callback", params={"code": "good", "state": "x.y"}).status_code == 400
    url = client.get("/calendar/microsoft/connect", headers=auth).json()["authorization_url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    denied = client.get("/calendar/microsoft/callback",
                        params={"state": state, "error": "access_denied", "error_description": "User declined"})
    assert denied.status_code == 400 and "User declined" in denied.text
    assert client.get("/calendar/microsoft/callback", params={"code": "bad", "state": state}).status_code == 400
    assert client.get("/calendar/connections", headers=auth).json() == []


def test_list_events_requires_connection(client, auth, graph):
    assert client.get("/calendar/events", headers=auth).status_code == 409
    connect(client, auth)
    events = client.get("/calendar/events", headers=auth).json()
    assert events[0]["title"] == "Design review"
    assert [(a["name"], a["optional"]) for a in events[0]["attendees"]] == [("Carol", False), ("Dan", True)]
    graph_req = [r for r in graph.requests if r.url.path == "/v1.0/me/calendarView"][0]
    assert graph_req.headers["Authorization"] == "Bearer AT1"


def test_start_meeting_from_outlook_event(client, auth, graph):
    connect(client, auth)
    r = client.post("/meetings", headers=auth, json={"recording_consent": True, "calendar_event_id": "AAMk/evt+1="})
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["calendar_source"] == "microsoft" and m["title"] == "Design review"
    assert m["join_url"].startswith("https://teams.microsoft.com/")
    assert {p["email"] for p in m["participants"]} == {
        "bob@contoso.com", "carol@contoso.com", "dan@contoso.com", "vipul@example.com"}
    # Event id with / + = is URL-encoded into the Graph path
    assert any("AAMk%2Fevt%2B1%3D" in str(r.url) for r in graph.requests)


def test_expired_token_is_refreshed(client, auth, graph, session_factory):
    connect(client, auth)
    with session_factory() as db:
        row = db.query(CalendarConnection).one()
        row.access_token_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
    client.get("/calendar/events", headers=auth)
    token_req = [r for r in graph.requests if r.url.path.endswith("/token")][-1]
    assert parse_qs(token_req.content.decode())["grant_type"] == ["refresh_token"]
    assert parse_qs(token_req.content.decode())["refresh_token"] == ["RT1"]
    last = [r for r in graph.requests if r.url.path == "/v1.0/me/calendarView"][-1]
    assert last.headers["Authorization"] == "Bearer AT2"


def test_revoked_access_and_disconnect(client, auth, graph):
    connect(client, auth)
    graph.revoked = True
    r = client.get("/calendar/events", headers=auth)
    assert r.status_code == 409 and "reconnect" in r.json()["detail"]
    assert client.delete("/calendar/connections/microsoft", headers=auth).status_code == 204
    assert client.get("/calendar/connections", headers=auth).json() == []
