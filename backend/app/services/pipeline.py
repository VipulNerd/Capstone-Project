"""Background job: transcribe (if audio) -> extract MOM -> store as draft."""
import logging
import re

from sqlalchemy.orm import sessionmaker

from app.models import ActionItem, Meeting, MeetingStatus, Participant, SourceType
from app.services.ai import AIClient

log = logging.getLogger(__name__)

_TIMESTAMP = re.compile(r"^\d{1,2}:\d{2}(:\d{2})?[.,]\d{3}\s*-->\s*\d{1,2}:\d{2}(:\d{2})?[.,]\d{3}")


def decode_text(data: bytes) -> str:
    """Transcripts come from many tools: UTF-8 (with/without BOM) or Windows-1252."""
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")  # never fails


def clean_transcript(text: str, suffix: str) -> str:
    """Strip WEBVTT/SRT cue numbers and timestamps so the LLM sees only speech."""
    if suffix not in (".vtt", ".srt"):
        return text.strip()
    lines = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s == "WEBVTT" or s.isdigit() or _TIMESTAMP.match(s):
            continue
        lines.append(s)
    return "\n".join(lines)


def process_meeting(meeting_id: int, session_factory: sessionmaker, ai: AIClient) -> None:
    with session_factory() as db:
        m = db.get(Meeting, meeting_id)
        if m is None:
            return
        try:
            if m.source_type == SourceType.audio and not m.transcript:
                m.transcript = ai.transcribe(m.source_path)
                db.commit()  # keep the (paid-for) transcript even if extraction fails

            if not (m.transcript or "").strip():
                raise ValueError("Transcript is empty")

            mom = ai.extract_mom(m.transcript, m.title, m.meeting_date)

            m.summary = mom.summary
            m.discussion_points = mom.discussion_points
            m.decisions = mom.decisions
            m.action_items = [
                ActionItem(task=a.task, owner=a.owner, deadline=a.deadline) for a in mom.action_items
            ]
            # Keep participants the organiser supplied (they carry emails);
            # add any extra names the LLM found so the organiser can fill in emails.
            known = {p.name.strip().lower() for p in m.participants}
            for name in mom.participants:
                if name.strip() and name.strip().lower() not in known:
                    m.participants.append(Participant(name=name.strip()))
                    known.add(name.strip().lower())

            m.status = MeetingStatus.draft
            m.error_message = None
        except Exception as e:  # noqa: BLE001 - any failure must land on the record
            log.exception("Processing meeting %s failed", meeting_id)
            m.status = MeetingStatus.failed
            m.error_message = f"{type(e).__name__}: {e}"
        db.commit()
