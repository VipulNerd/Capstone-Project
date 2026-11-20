import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.db import get_db, get_sessionmaker
from app.models import ActionItem, DeliveryStatus, EmailDelivery, Meeting, MeetingStatus, Participant, SourceType
from app.schemas import (
    ApproveRequest,
    DeliveryOut,
    DistributeRequest,
    DistributeResult,
    MeetingOut,
    MeetingSummary,
    MomUpdate,
    ParticipantIn,
)
from app.services.ai import AIClient, get_ai_client
from app.services.emailer import Attachment, Mailer, get_mailer
from app.services.exporter import export_mom
from app.services.pipeline import clean_transcript, decode_text, process_meeting
from app.services.storage import AUDIO_EXTENSIONS, TRANSCRIPT_EXTENSIONS, save_upload

router = APIRouter(prefix="/meetings", tags=["meetings"])

DB = Annotated[Session, Depends(get_db)]


def ai_dependency() -> AIClient:
    try:
        return get_ai_client()
    except RuntimeError as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from e


def _get(db: Session, meeting_id: int) -> Meeting:
    m = db.get(Meeting, meeting_id)
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
    return m


def _require(m: Meeting, *allowed: MeetingStatus, action: str) -> None:
    if m.status not in allowed:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Cannot {action} a meeting in status '{m.status.value}' "
            f"(allowed: {', '.join(s.value for s in allowed)})",
        )


@router.post("", response_model=MeetingOut, status_code=status.HTTP_201_CREATED)
async def upload_meeting(
    db: DB,
    file: Annotated[UploadFile, File(description="Audio recording or transcript (.txt/.md/.vtt/.srt)")],
    title: Annotated[str, Form(min_length=1, max_length=255)],
    organizer_name: Annotated[str, Form(min_length=1)],
    organizer_email: Annotated[str, Form(min_length=3)],
    meeting_date: Annotated[date | None, Form()] = None,
    participants: Annotated[str | None, Form(description='JSON list: [{"name": "...", "email": "..."}]')] = None,
):
    filename = file.filename or "upload"
    suffix = Path(filename).suffix.lower()
    if suffix in AUDIO_EXTENSIONS:
        source_type = SourceType.audio
    elif suffix in TRANSCRIPT_EXTENSIONS:
        source_type = SourceType.transcript
    else:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Unsupported file type '{suffix}'. Audio: {sorted(AUDIO_EXTENSIONS)}; "
            f"transcript: {sorted(TRANSCRIPT_EXTENSIONS)}",
        )

    try:
        organizer_email = TypeAdapter(EmailStr).validate_python(organizer_email)
        parsed_participants = (
            TypeAdapter(list[ParticipantIn]).validate_json(participants) if participants else []
        )
    except ValidationError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Invalid organiser email or participants: {e}") from e

    data = await file.read()
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, f"File exceeds {get_settings().max_upload_mb} MB")
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "File is empty")

    m = Meeting(
        title=title,
        meeting_date=meeting_date,
        organizer_name=organizer_name,
        organizer_email=organizer_email,
        source_type=source_type,
        source_filename=filename,
        source_path=save_upload(filename, data),
        participants=[Participant(name=p.name, email=p.email) for p in parsed_participants],
    )
    if source_type == SourceType.transcript:
        m.transcript = clean_transcript(decode_text(data), suffix)

    db.add(m)
    db.commit()
    db.refresh(m)
    return m


@router.get("", response_model=list[MeetingSummary])
def list_meetings(db: DB, status_filter: Annotated[MeetingStatus | None, Query(alias="status")] = None):
    stmt = select(Meeting).order_by(Meeting.created_at.desc())
    if status_filter:
        stmt = stmt.where(Meeting.status == status_filter)
    return db.scalars(stmt).all()


@router.get("/{meeting_id}", response_model=MeetingOut)
def get_meeting(meeting_id: int, db: DB):
    return _get(db, meeting_id)


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meeting(meeting_id: int, db: DB):
    m = _get(db, meeting_id)
    if m.source_path:
        Path(m.source_path).unlink(missing_ok=True)
    db.delete(m)
    db.commit()


@router.post("/{meeting_id}/process", response_model=MeetingOut, status_code=status.HTTP_202_ACCEPTED)
def start_processing(
    meeting_id: int,
    db: DB,
    background: BackgroundTasks,
    ai: Annotated[AIClient, Depends(ai_dependency)],
    session_factory: Annotated[sessionmaker, Depends(get_sessionmaker)],
):
    """Transcribe (audio only) and generate the MOM draft in the background.
    Poll GET /meetings/{id} until status is 'draft' or 'failed'.
    Re-running on a draft regenerates it and discards edits."""
    m = _get(db, meeting_id)
    _require(m, MeetingStatus.uploaded, MeetingStatus.failed, MeetingStatus.draft, action="process")
    m.status = MeetingStatus.processing
    m.error_message = None
    db.commit()
    background.add_task(process_meeting, m.id, session_factory, ai)
    return m


@router.put("/{meeting_id}/mom", response_model=MeetingOut)
def update_mom(meeting_id: int, body: MomUpdate, db: DB):
    m = _get(db, meeting_id)
    _require(m, MeetingStatus.draft, action="edit")

    fields = body.model_dump(exclude_unset=True)
    for key in ("title", "meeting_date", "summary", "discussion_points", "decisions"):
        if key in fields:
            setattr(m, key, fields[key])
    if body.participants is not None:
        m.participants = [Participant(name=p.name, email=p.email) for p in body.participants]
    if body.action_items is not None:
        m.action_items = [ActionItem(task=a.task, owner=a.owner, deadline=a.deadline) for a in body.action_items]

    db.commit()
    db.refresh(m)
    return m


@router.post("/{meeting_id}/approve", response_model=MeetingOut)
def approve(meeting_id: int, body: ApproveRequest, db: DB):
    m = _get(db, meeting_id)
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
def reopen(meeting_id: int, db: DB):
    """Withdraw approval to make further edits (only before distribution)."""
    m = _get(db, meeting_id)
    _require(m, MeetingStatus.approved, action="reopen")
    m.status = MeetingStatus.draft
    m.approved_by = None
    m.approved_at = None
    db.commit()
    db.refresh(m)
    return m


@router.get("/{meeting_id}/export")
def export(meeting_id: int, db: DB, format: Literal["pdf", "docx"] = "pdf"):
    m = _get(db, meeting_id)
    _require(m, MeetingStatus.draft, MeetingStatus.approved, MeetingStatus.distributed, action="export")
    content, media_type, filename = export_mom(m, format)
    ext = filename.rsplit(".", 1)[1]
    utf8_name = quote(f"MOM_{m.title}.{ext}", safe="")
    return Response(
        content,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{utf8_name}"},
    )


@router.post("/{meeting_id}/distribute", response_model=DistributeResult)
def distribute(
    meeting_id: int,
    db: DB,
    mailer: Annotated[Mailer, Depends(get_mailer)],
    body: DistributeRequest | None = None,
):
    """Email the approved MOM to all participants with an email address and the organiser.
    Only approved (or already distributed, for resends) meetings can be sent."""
    m = _get(db, meeting_id)
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
    text = (
        f"Hello,\n\nPlease find attached the approved minutes for \"{m.title}\".\n\n"
        f"Summary:\n{m.summary}\n\n"
        + (
            "Action items:\n"
            + "\n".join(
                f"- {a.task} (owner: {a.owner or 'unassigned'}, due: {a.deadline or 'TBD'})" for a in m.action_items
            )
            + "\n\n"
            if m.action_items
            else ""
        )
        + f"Regards,\n{m.organizer_name}"
    )

    new: list[EmailDelivery] = []
    for to in recipients:
        try:
            mailer.send(to, subject, text, attachment)
            new.append(EmailDelivery(recipient_email=to, status=DeliveryStatus.sent))
        except Exception as e:  # noqa: BLE001 - record per-recipient failure, keep going
            new.append(EmailDelivery(recipient_email=to, status=DeliveryStatus.failed, error=f"{type(e).__name__}: {e}"))
    m.deliveries.extend(new)

    sent = sum(d.status == DeliveryStatus.sent for d in new)
    if sent:
        m.status = MeetingStatus.distributed
    db.commit()
    return DistributeResult(sent=sent, failed=len(new) - sent, deliveries=[DeliveryOut.model_validate(d) for d in new])


@router.get("/{meeting_id}/deliveries", response_model=list[DeliveryOut])
def list_deliveries(meeting_id: int, db: DB):
    return _get(db, meeting_id).deliveries
