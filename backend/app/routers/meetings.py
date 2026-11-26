from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.db import get_db, get_sessionmaker
from app.models import (
    ActionItem,
    AudioChunk,
    AudioTrack,
    CalendarSource,
    DeliveryStatus,
    EmailDelivery,
    Meeting,
    MeetingStatus,
    Participant,
    ParticipantSource,
    User,
)
from app.routers.calendar import get_connection, ms_optional
from app.schemas import (
    ApproveRequest,
    ChunkOut,
    DeliveryOut,
    DistributeRequest,
    DistributeResult,
    MeetingOut,
    MeetingStart,
    MeetingSummary,
    MomUpdate,
    RetryRequest,
)
from app.security import CurrentUser
from app.services.ai import AIClient, get_ai_client
from app.services.calendar import CalendarError, CalendarEvent, CalendarNotConnected, MicrosoftCalendar, parse_ics
from app.services.emailer import Attachment, EmailError, Mailer, get_mailer
from app.services.exporter import export_mom, export_transcript
from app.services.pipeline import finalize_meeting
from app.services.storage import AUDIO_EXTENSIONS, delete_meeting_audio, save_chunk

router = APIRouter(prefix="/meetings", tags=["meetings"])

DB = Annotated[Session, Depends(get_db)]


def ai_dependency() -> AIClient:
    try:
        return get_ai_client()
    except RuntimeError as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from e


def _get(db: Session, meeting_id: int, user: User) -> Meeting:
    m = db.get(Meeting, meeting_id)
    if m is None or m.owner_id != user.id:  # don't reveal other users' meetings exist
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
    return m


def _require(m: Meeting, *allowed: MeetingStatus, action: str) -> None:
    if m.status not in allowed:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Cannot {action} a meeting in status '{m.status.value}' "
            f"(allowed: {', '.join(s.value for s in allowed)})",
        )


def _require_consent(consent: bool) -> None:
    if not consent:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "recording_consent must be true: confirm participants were informed and agree to recording",
        )


def _attachment_headers(filename: str, display_name: str) -> dict:
    return {"Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(display_name, safe='')}"}


def _new_meeting(user: User, source: CalendarSource, ev: CalendarEvent | None,
                 title: str | None, extra: list | None = None) -> Meeting:
    now = datetime.now(timezone.utc)
    m = Meeting(
        owner_id=user.id,
        calendar_source=source,
        title=(ev.title if ev else title) or "Untitled meeting",
        organizer_name=(ev.organizer_name if ev else None) or user.name,
        organizer_email=(ev.organizer_email if ev else None) or user.email,
        status=MeetingStatus.recording,
        recording_consent_at=now,
        recording_started_at=now,
    )
    people: list[Participant] = []
    if ev:
        m.calendar_event_id = ev.event_id
        m.scheduled_start, m.scheduled_end, m.join_url = ev.start, ev.end, ev.join_url
        if ev.organizer_email:
            people.append(Participant(name=ev.organizer_name or ev.organizer_email.split("@")[0],
                                      email=ev.organizer_email, source=ParticipantSource.calendar))
        people += [Participant(name=a.name, email=a.email, is_optional=a.optional, source=ParticipantSource.calendar)
                   for a in ev.attendees]
    people += [Participant(name=p.name, email=p.email, source=ParticipantSource.manual) for p in extra or []]
    # The recording user always takes part (their mic is a track).
    people.append(Participant(name=user.name, email=user.email, source=ParticipantSource.manual))

    seen: set[str] = set()
    for p in people:  # de-dupe by email (or name when there is no email)
        key = (p.email or f"name:{p.name}").strip().lower()
        if key not in seen:
            seen.add(key)
            m.participants.append(p)
    m.meeting_date = (m.scheduled_start or now).date()
    return m


# --- Start a recording session -----------------------------------------------------------------


@router.post("", response_model=MeetingOut, status_code=status.HTTP_201_CREATED)
def start_meeting(
    body: MeetingStart,
    user: CurrentUser,
    db: DB,
    cal: Annotated[MicrosoftCalendar | None, Depends(ms_optional)],
):
    """Start recording. With calendar_event_id, title/time/organiser/attendees are read from
    the user's connected Outlook calendar; otherwise title + participants are used."""
    _require_consent(body.recording_consent)
    ev = None
    if body.calendar_event_id:
        if cal is None:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Microsoft calendar is not configured on the server")
        conn = get_connection(db, user, CalendarSource.microsoft)
        try:
            ev = cal.get_event(db, conn, body.calendar_event_id)
        except CalendarNotConnected as e:
            raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
        except CalendarError as e:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e
    m = _new_meeting(user, CalendarSource.microsoft if ev else CalendarSource.manual, ev, body.title, body.participants)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


@router.post("/from-ics", response_model=MeetingOut, status_code=status.HTTP_201_CREATED)
async def start_meeting_from_ics(
    user: CurrentUser,
    db: DB,
    invite: Annotated[UploadFile, File(description="Meeting invite (.ics)")],
    recording_consent: Annotated[bool, Form()],
):
    """Start recording using a meeting-invite file for title/time/participants (no calendar login needed)."""
    _require_consent(recording_consent)
    data = await invite.read()
    if len(data) > 1024 * 1024:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Invite file too large")
    try:
        ev = parse_ics(data)
    except CalendarError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    m = _new_meeting(user, CalendarSource.ics, ev, None)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


# --- Audio streaming from the overlay agent ----------------------------------------------------


@router.post("/{meeting_id}/audio", response_model=ChunkOut, status_code=status.HTTP_201_CREATED)
async def upload_chunk(
    meeting_id: int,
    user: CurrentUser,
    db: DB,
    response: Response,
    track: Annotated[AudioTrack, Form(description="'mic' = user's microphone, 'meeting' = system/loopback audio")],
    seq: Annotated[int, Form(ge=0, description="Per-track sequence number, starting at 0")],
    offset_ms: Annotated[int, Form(ge=0, description="Chunk start, ms since recording started")],
    file: Annotated[UploadFile, File(description="Audio chunk (webm/ogg/wav/mp3/m4a/flac)")],
):
    """Upload one audio chunk. Idempotent per (track, seq): re-sending an already received
    chunk returns 200 with the stored chunk, so the agent can safely retry after network errors."""
    m = _get(db, meeting_id, user)
    existing = db.scalar(select(AudioChunk).where(
        AudioChunk.meeting_id == m.id, AudioChunk.track == track, AudioChunk.seq == seq))
    if existing:
        response.status_code = status.HTTP_200_OK
        return existing
    _require(m, MeetingStatus.recording, action="upload audio to")

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in AUDIO_EXTENSIONS:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            f"Unsupported audio type '{suffix}'. Allowed: {sorted(AUDIO_EXTENSIONS)}")
    data = await file.read()
    limit = get_settings().max_chunk_mb
    if len(data) > limit * 1024 * 1024:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, f"Chunk exceeds {limit} MB; send shorter chunks")
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Empty audio chunk")

    chunk = AudioChunk(meeting_id=m.id, track=track, seq=seq, offset_ms=offset_ms,
                       path=save_chunk(m.id, track.value, seq, suffix, data), size_bytes=len(data))
    db.add(chunk)
    db.commit()
    return chunk


@router.get("/{meeting_id}/chunks", response_model=list[ChunkOut])
def list_chunks(meeting_id: int, user: CurrentUser, db: DB):
    """What the server has received, so the agent can re-send any missing chunks."""
    return _get(db, meeting_id, user).chunks


@router.post("/{meeting_id}/end", response_model=MeetingOut, status_code=status.HTTP_202_ACCEPTED)
def end_meeting(
    meeting_id: int,
    user: CurrentUser,
    db: DB,
    background: BackgroundTasks,
    ai: Annotated[AIClient, Depends(ai_dependency)],
    session_factory: Annotated[sessionmaker, Depends(get_sessionmaker)],
):
    """Meeting over: transcribe, merge both tracks, identify speakers, refine the transcript
    and draft the MOM in the background. Poll GET /meetings/{id} until 'draft' or 'failed'."""
    m = _get(db, meeting_id, user)
    _require(m, MeetingStatus.recording, action="end")
    if not m.chunks:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "No audio was received for this meeting")
    m.status = MeetingStatus.finalizing
    m.recording_ended_at = datetime.now(timezone.utc)
    db.commit()
    background.add_task(finalize_meeting, m.id, session_factory, ai)
    return m


@router.post("/{meeting_id}/retry", response_model=MeetingOut, status_code=status.HTTP_202_ACCEPTED)
def retry(
    meeting_id: int,
    user: CurrentUser,
    db: DB,
    background: BackgroundTasks,
    ai: Annotated[AIClient, Depends(ai_dependency)],
    session_factory: Annotated[sessionmaker, Depends(get_sessionmaker)],
    body: RetryRequest | None = None,
):
    """Resume a failed finalization. Already-transcribed chunks are not re-sent to OpenAI."""
    m = _get(db, meeting_id, user)
    _require(m, MeetingStatus.failed, action="retry")
    m.status = MeetingStatus.finalizing
    m.error_message = None
    db.commit()
    background.add_task(finalize_meeting, m.id, session_factory, ai, (body or RetryRequest()).skip_failed_chunks)
    return m


@router.get("/{meeting_id}/transcript")
def download_transcript(meeting_id: int, user: CurrentUser, db: DB,
                        format: Literal["txt", "docx", "pdf", "json"] = "txt"):
    """Download the refined transcript (available once finalization has produced it)."""
    m = _get(db, meeting_id, user)
    if not m.transcript_lines:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Transcript not ready (status '{m.status.value}')")
    content, media_type, filename = export_transcript(m, format)
    return Response(content, media_type=media_type,
                    headers=_attachment_headers(filename, f"Transcript_{m.title}.{format}"))


# --- Review, approval, distribution ------------------------------------------------------------


@router.get("", response_model=list[MeetingSummary])
def list_meetings(user: CurrentUser, db: DB,
                  status_filter: Annotated[MeetingStatus | None, Query(alias="status")] = None):
    stmt = select(Meeting).where(Meeting.owner_id == user.id).order_by(Meeting.created_at.desc())
    if status_filter:
        stmt = stmt.where(Meeting.status == status_filter)
    return db.scalars(stmt).all()


@router.get("/{meeting_id}", response_model=MeetingOut)
def get_meeting(meeting_id: int, user: CurrentUser, db: DB):
    return _get(db, meeting_id, user)


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meeting(meeting_id: int, user: CurrentUser, db: DB):
    m = _get(db, meeting_id, user)
    if m.status == MeetingStatus.finalizing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Meeting is being processed; try again shortly")
    delete_meeting_audio(m.id)
    db.delete(m)
    db.commit()


@router.put("/{meeting_id}/mom", response_model=MeetingOut)
def update_mom(meeting_id: int, body: MomUpdate, user: CurrentUser, db: DB):
    m = _get(db, meeting_id, user)
    _require(m, MeetingStatus.draft, action="edit")
    fields = body.model_dump(exclude_unset=True)
    for key in ("title", "meeting_date", "summary", "discussion_points", "decisions"):
        if key in fields:
            setattr(m, key, fields[key])
    if body.participants is not None:
        # Keep calendar provenance for people who were on the invite.
        prev = {(p.email or "").lower(): p for p in m.participants if p.email}
        m.participants = [
            Participant(
                name=p.name, email=p.email,
                source=prev[p.email.lower()].source if p.email and p.email.lower() in prev else ParticipantSource.manual,
                is_optional=prev[p.email.lower()].is_optional if p.email and p.email.lower() in prev else False,
            )
            for p in body.participants
        ]
    if body.action_items is not None:
        m.action_items = [ActionItem(task=a.task, owner=a.owner, deadline=a.deadline) for a in body.action_items]
    db.commit()
    db.refresh(m)
    return m


@router.post("/{meeting_id}/approve", response_model=MeetingOut)
def approve(meeting_id: int, body: ApproveRequest, user: CurrentUser, db: DB):
    m = _get(db, meeting_id, user)
    _require(m, MeetingStatus.draft, action="approve")
    if not (m.summary or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "MOM has no summary")
    m.status = MeetingStatus.approved
    m.approved_by = body.approved_by
    m.approved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(m)
    return m


@router.post("/{meeting_id}/reopen", response_model=MeetingOut)
def reopen(meeting_id: int, user: CurrentUser, db: DB):
    """Withdraw approval to make further edits (only before distribution)."""
    m = _get(db, meeting_id, user)
    _require(m, MeetingStatus.approved, action="reopen")
    m.status = MeetingStatus.draft
    m.approved_by = None
    m.approved_at = None
    db.commit()
    db.refresh(m)
    return m


@router.get("/{meeting_id}/export")
def export(meeting_id: int, user: CurrentUser, db: DB, format: Literal["pdf", "docx"] = "pdf"):
    m = _get(db, meeting_id, user)
    _require(m, MeetingStatus.draft, MeetingStatus.approved, MeetingStatus.distributed, action="export")
    content, media_type, filename = export_mom(m, format)
    return Response(content, media_type=media_type, headers=_attachment_headers(filename, f"MOM_{m.title}.{format}"))


@router.post("/{meeting_id}/distribute", response_model=DistributeResult)
def distribute(
    meeting_id: int,
    user: CurrentUser,
    db: DB,
    mailer: Annotated[Mailer, Depends(get_mailer)],
    body: DistributeRequest | None = None,
):
    """Email the approved MOM to all participants with an email address and the organiser.
    Only approved (or already distributed, for resends) meetings can be sent."""
    m = _get(db, meeting_id, user)
    _require(m, MeetingStatus.approved, MeetingStatus.distributed, action="distribute")

    recipients: dict[str, None] = {}  # ordered de-dupe
    for email in [p.email for p in m.participants] + [m.organizer_email]:
        if email:
            recipients.setdefault(email.strip().lower(), None)
    if not recipients:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "No recipients with an email address")

    content, media_type, filename = export_mom(m, (body or DistributeRequest()).format)
    attachment = Attachment(filename, content, media_type)
    one_line_title = " ".join(m.title.split())  # CR/LF in a header would make every send fail
    subject = f"Minutes of Meeting: {one_line_title}" + (f" ({m.meeting_date.isoformat()})" if m.meeting_date else "")
    actions = "".join(
        f"- {a.task} (owner: {a.owner or 'unassigned'}, due: {a.deadline or 'TBD'})\n" for a in m.action_items
    )
    text = (
        f"Hello,\n\nPlease find attached the approved minutes for \"{one_line_title}\".\n\n"
        f"Summary:\n{m.summary}\n\n"
        + (f"Action items:\n{actions}\n" if actions else "")
        + f"Regards,\n{m.organizer_name}"
    )

    new: list[EmailDelivery] = []
    for to in recipients:
        try:
            mailer.send(to, subject, text, attachment)
            new.append(EmailDelivery(recipient_email=to, status=DeliveryStatus.sent))
        except Exception as e:  # noqa: BLE001 - record per-recipient failure, keep going
            error = str(e) if isinstance(e, EmailError) else f"{type(e).__name__}: {e}"
            new.append(EmailDelivery(recipient_email=to, status=DeliveryStatus.failed, error=error[:1000]))
    m.deliveries.extend(new)

    sent = sum(d.status == DeliveryStatus.sent for d in new)
    if sent:
        m.status = MeetingStatus.distributed
    db.commit()
    return DistributeResult(
        sent=sent,
        failed=len(new) - sent,
        deliveries=[DeliveryOut.model_validate(d) for d in new],
        email_mode=get_settings().email_backend,
    )


@router.get("/{meeting_id}/deliveries", response_model=list[DeliveryOut])
def list_deliveries(meeting_id: int, user: CurrentUser, db: DB):
    return _get(db, meeting_id, user).deliveries
