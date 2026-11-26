"""Google Calendar with OAuth consent, through the real GoogleCalendar class over a mocked
HTTP transport (accounts.google.com / oauth2.googleapis.com / www.googleapis.com)."""
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.config import get_settings
from app.main import app
from app.models import CalendarConnection
from app.routers.calendar import google_optional, ms_optional
from app.services.calendar import GoogleCalendar, MicrosoftCalendar
from tests.test_calendar import GraphMock

EVENT = {
    "id": "abc123_20261120T090000Z",
    "status": "confirmed",
    "summary": "Sprint review",
    "start": {"dateTime": "2026-11-20T14:30:00+05:30"},
    "end": {"dateTime": "2026-11-20T15:30:00+05:30"},
    "organizer": {"email": "bob@gmail.com", "displayName": "Bob"},
    "attendees": [
        {"email": "bob@gmail.com", "displayName": "Bob", "organizer": True},
        {"email": "carol@gmail.com", "displayName": "Carol"},
        {"email": "dan.k@gmail.com", "optional": True},
        {"email": "room-1@resource.calendar.google.com", "displayName": "Room 1", "resource": True},
    ],
    "hangoutLink": "https://meet.google.com/abc-defg-hij",
}
ALL_DAY = {"id": "allday1", "summary": "Offsite", "start": {"date": "2026-11-21"}, "end": {"date": "2026-11-22"},
           "conferenceData": {"entryPoints": [{"entryPointType": "phone", "uri": "tel:+1"},
                                              {"entryPointType": "video", "uri": "https://zoom.us/j/1"}]}}
CANCELLED = {"id": "gone", "status": "cancelled"}


class GoogleMock:
    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.token_count = 0
        self.revoked = False
        self.refresh_revoked = False
        self.fail_events = False

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        if req.url.host == "oauth2.googleapis.com":
            form = parse_qs(req.content.decode())
            if form.get("code") == ["bad"]:
                return httpx.Response(400, json={"error": "invalid_grant", "error_description": "Bad Request"})
            if form.get("grant_type") == ["refresh_token"] and self.refresh_revoked:
                return httpx.Response(400, json={"error": "invalid_grant", "error_description": "Token has been expired or revoked."})
            self.token_count += 1
            tok = {"access_token": f"GAT{self.token_count}", "expires_in": 3599, "scope": "openid email",
                   "token_type": "Bearer"}
            if form.get("grant_type") == ["authorization_code"]:
                tok["refresh_token"] = "GRT"  # Google sends it only on the first exchange
            return httpx.Response(200, json=tok)
        if req.url.host == "openidconnect.googleapis.com":
            return httpx.Response(200, json={"email": "vipul@gmail.com", "email_verified": True})
        if self.revoked:
            return httpx.Response(401, json={"error": {"code": 401}})
        if self.fail_events:
            return httpx.Response(500, text="backend error")
        if req.url.path == "/calendar/v3/calendars/primary/events":
            return httpx.Response(200, json={"items": [EVENT, ALL_DAY, CANCELLED]})
        if req.url.path.startswith("/calendar/v3/calendars/primary/events/"):
            return httpx.Response(200, json=EVENT)
        return httpx.Response(404, json={})


@pytest.fixture
def google(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "google_client_id", "gid.apps.googleusercontent.com")
    monkeypatch.setattr(get_settings(), "google_client_secret", "gsecret")
    mock = GoogleMock()
    app.dependency_overrides[google_optional] = lambda: GoogleCalendar(http=httpx.Client(transport=httpx.MockTransport(mock)))
    return mock


def connect_google(client, auth) -> None:
    url = client.get("/calendar/google/connect", headers=auth).json()["authorization_url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    r = client.get("/calendar/google/callback", params={"code": "good", "state": state})
    assert r.status_code == 200 and "Calendar connected" in r.text, r.text


def test_providers_and_not_configured(client, auth):
    assert client.get("/calendar/providers").json() == [
        {"provider": "google", "configured": False}, {"provider": "microsoft", "configured": False}]
    assert client.get("/calendar/google/connect", headers=auth).status_code == 503
    r = client.post("/meetings", headers=auth, json={
        "recording_consent": True, "calendar_event_id": "x", "calendar_provider": "google"})
    assert r.status_code == 503


def test_consent_url(client, auth, google):
    assert client.get("/calendar/providers").json()[0] == {"provider": "google", "configured": True}
    url = client.get("/calendar/google/connect", headers=auth).json()["authorization_url"]
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    q = parse_qs(urlparse(url).query)
    assert q["client_id"] == ["gid.apps.googleusercontent.com"] and q["access_type"] == ["offline"]
    assert "calendar.events.readonly" in q["scope"][0]
    assert q["redirect_uri"] == ["http://localhost:8000/calendar/google/callback"]


def test_callback_stores_encrypted_tokens(client, auth, google, session_factory):
    connect_google(client, auth)
    conns = client.get("/calendar/connections", headers=auth).json()
    assert [(c["provider"], c["account_email"]) for c in conns] == [("google", "vipul@gmail.com")]
    with session_factory() as db:
        row = db.query(CalendarConnection).one()
        assert "GAT1" not in row.access_token_enc and "GRT" not in row.refresh_token_enc


def test_callback_rejects_bad_state_code_and_other_provider(client, auth, google):
    assert client.get("/calendar/google/callback", params={"code": "good", "state": "x.y"}).status_code == 400
    url = client.get("/calendar/google/connect", headers=auth).json()["authorization_url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    assert client.get("/calendar/google/callback", params={"code": "bad", "state": state}).status_code == 400
    denied = client.get("/calendar/google/callback", params={"state": state, "error": "access_denied"})
    assert denied.status_code == 400
    # A Google state can't be replayed against the Microsoft callback.
    assert client.get("/calendar/microsoft/callback", params={"code": "good", "state": state}).status_code == 400
    assert client.get("/calendar/connections", headers=auth).json() == []


def test_list_events_mapping(client, auth, google):
    assert client.get("/calendar/events", headers=auth).status_code == 409
    connect_google(client, auth)
    events = client.get("/calendar/events", headers=auth).json()
    assert [e["title"] for e in events] == ["Sprint review", "Offsite"]  # cancelled one dropped
    ev = events[0]
    assert ev["provider"] == "google" and ev["start"].startswith("2026-11-20T09:00:00")  # converted to UTC
    assert ev["join_url"] == "https://meet.google.com/abc-defg-hij"
    assert [(a["name"], a["optional"]) for a in ev["attendees"]] == [("Bob", False), ("Carol", False), ("dan.k", True)]
    assert events[1]["join_url"] == "https://zoom.us/j/1" and events[1]["start"].startswith("2026-11-21T00:00:00")
    req = [r for r in google.requests if r.url.path == "/calendar/v3/calendars/primary/events"][0]
    assert req.headers["Authorization"] == "Bearer GAT1" and req.url.params["singleEvents"] == "true"


def test_start_meeting_from_google_event(client, auth, google):
    connect_google(client, auth)
    r = client.post("/meetings", headers=auth, json={
        "recording_consent": True, "calendar_event_id": "abc123_20261120T090000Z", "calendar_provider": "google"})
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["calendar_source"] == "google" and m["title"] == "Sprint review"
    assert m["join_url"] == "https://meet.google.com/abc-defg-hij"
    assert {p["email"] for p in m["participants"]} == {
        "bob@gmail.com", "carol@gmail.com", "dan.k@gmail.com", "vipul@example.com"}


def test_expired_token_refreshes_and_revoked_refresh_asks_to_reconnect(client, auth, google, session_factory):
    connect_google(client, auth)

    def expire():
        with session_factory() as db:
            row = db.query(CalendarConnection).one()
            row.access_token_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
            db.commit()

    expire()
    assert client.get("/calendar/events", headers=auth).status_code == 200
    token_req = [r for r in google.requests if r.url.host == "oauth2.googleapis.com"][-1]
    assert parse_qs(token_req.content.decode())["refresh_token"] == ["GRT"]
    with session_factory() as db:  # refresh response had no new refresh_token: the old one is kept
        assert db.query(CalendarConnection).one().refresh_token_enc

    expire()
    google.refresh_revoked = True  # e.g. Google's 7-day expiry for apps in Testing
    r = client.get("/calendar/events", headers=auth)
    assert r.status_code == 409 and "reconnect" in r.json()["detail"]


def test_events_merge_google_and_outlook_and_survive_one_failing(client, auth, google, monkeypatch):
    monkeypatch.setattr(get_settings(), "ms_client_id", "client-123")
    graph = GraphMock()
    app.dependency_overrides[ms_optional] = lambda: MicrosoftCalendar(http=httpx.Client(transport=httpx.MockTransport(graph)))
    connect_google(client, auth)
    url = client.get("/calendar/microsoft/connect", headers=auth).json()["authorization_url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    assert client.get("/calendar/microsoft/callback", params={"code": "good", "state": state}).status_code == 200

    events = client.get("/calendar/events", headers=auth).json()
    assert [(e["provider"], e["title"]) for e in events] == [
        ("google", "Sprint review"), ("microsoft", "Design review"), ("google", "Offsite")]  # sorted by start

    google.fail_events = True
    events = client.get("/calendar/events", headers=auth).json()
    assert [e["provider"] for e in events] == ["microsoft"]
