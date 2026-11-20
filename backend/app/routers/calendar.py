from datetime import datetime, timedelta, timezone
from html import escape
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import CalendarConnection, CalendarSource, User
from app.schemas import AttendeeOut, AuthorizationUrl, CalendarConnectionOut, CalendarEventOut
from app.security import CurrentUser, sign_state, verify_state
from app.services.calendar import CalendarError, CalendarEvent, CalendarNotConnected, MicrosoftCalendar, get_microsoft_calendar

router = APIRouter(prefix="/calendar", tags=["calendar"])
DB = Annotated[Session, Depends(get_db)]


def ms_optional() -> MicrosoftCalendar | None:
    """None when Microsoft calendar isn't configured (MS_CLIENT_ID empty)."""
    try:
        return get_microsoft_calendar()
    except CalendarError:
        return None


def ms_dependency(cal: Annotated[MicrosoftCalendar | None, Depends(ms_optional)]) -> MicrosoftCalendar:
    if cal is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Microsoft calendar is not configured on the server (MS_CLIENT_ID is empty)")
    return cal


MS = Annotated[MicrosoftCalendar, Depends(ms_dependency)]


def event_out(e: CalendarEvent) -> CalendarEventOut:
    return CalendarEventOut(
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


@router.get("/microsoft/connect", response_model=AuthorizationUrl)
def microsoft_connect(user: CurrentUser, ms: MS):
    """Returns the Microsoft sign-in/consent URL. The overlay agent opens it in the browser;
    the user reviews the requested permissions (read calendar, basic profile) and approves."""
    return AuthorizationUrl(authorization_url=ms.authorization_url(sign_state({"uid": user.id, "p": "microsoft"})))


def _page(title: str, message: str, code: int = 200) -> HTMLResponse:
    return HTMLResponse(
        f"<!doctype html><meta charset=utf-8><title>{escape(title)}</title>"
        f"<body style='font-family:system-ui;max-width:32rem;margin:4rem auto'>"
        f"<h2>{escape(title)}</h2><p>{escape(message)}</p></body>",
        status_code=code,
    )


@router.get("/microsoft/callback", response_class=HTMLResponse, include_in_schema=False)
def microsoft_callback(
    db: DB,
    ms: MS,
    state: str,
    code: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
):
    payload = verify_state(state)
    if error:
        return _page("Calendar not connected", error_description or error, 400)
    if not code:
        return _page("Calendar not connected", "Missing authorization code.", 400)
    try:
        conn = ms.connect(db, payload["uid"], code)
    except CalendarError as e:
        return _page("Calendar not connected", str(e), 400)
    return _page("Calendar connected", f"Connected {conn.account_email or 'your account'}. You can close this window.")


@router.get("/connections", response_model=list[CalendarConnectionOut])
def list_connections(user: CurrentUser, db: DB):
    return db.query(CalendarConnection).filter_by(user_id=user.id).all()


@router.delete("/connections/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def disconnect(provider: CalendarSource, user: CurrentUser, db: DB):
    """Withdraw consent: stored tokens are deleted. (Users can also revoke the app at
    https://myapps.microsoft.com or https://account.live.com/consent/Manage.)"""
    db.delete(get_connection(db, user, provider))
    db.commit()


@router.get("/events", response_model=list[CalendarEventOut])
def list_events(
    user: CurrentUser,
    db: DB,
    ms: MS,
    start: Annotated[datetime | None, Query(description="Default: 2 hours ago")] = None,
    end: Annotated[datetime | None, Query(description="Default: 12 hours from now")] = None,
):
    """Meetings around now, so the overlay can let the user pick the one they are joining."""
    now = datetime.now(timezone.utc)
    start = start or now - timedelta(hours=2)
    end = end or now + timedelta(hours=12)
    conn = get_connection(db, user, CalendarSource.microsoft)
    try:
        return [event_out(e) for e in ms.list_events(db, conn, start, end)]
    except CalendarNotConnected as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    except CalendarError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e
