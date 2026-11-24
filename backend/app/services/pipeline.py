"""After the meeting ends: transcribe chunks -> merge tracks -> name speakers ->
refine transcript -> draft MOM. Each stage is persisted, so a retry resumes
where it failed instead of paying for transcription twice."""
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.models import ActionItem, AudioChunk, AudioTrack, ChunkStatus, Meeting, MeetingStatus, Participant, ParticipantSource
from app.services.ai import AIClient, RawLine, RefinedLine
from app.services.storage import delete_file, get_audio_store

log = logging.getLogger(__name__)


def _transcribe_chunk(ai: AIClient, key: str):
    # Blob storage: download to a temporary file first; local storage: use the file directly.
    with get_audio_store().local_copy(key) as path:
        return ai.transcribe_segments(path)

_LABEL = re.compile(r"^M(\d+)-(.+)$")


class PipelineError(Exception):
    pass


def fmt_ts(seconds: float) -> str:
    s = int(max(seconds, 0))
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def render_transcript(lines: list[dict]) -> str:
    return "\n".join(f"[{fmt_ts(l['t'])}] {l['speaker']}: {l['text']}" for l in lines)


def merge_tracks(chunks: list[AudioChunk], user_name: str) -> list[RawLine]:
    """Place every segment on the shared meeting timeline and interleave both tracks.
    Meeting-track speakers get chunk-scoped labels (diarization labels are per chunk)."""
    lines = []
    for c in chunks:
        if c.status != ChunkStatus.transcribed:
            continue
        base = c.offset_ms / 1000
        for s in c.segments or []:
            mic = c.track == AudioTrack.mic
            lines.append(RawLine(
                t=round(base + float(s["start"]), 2),
                source="mic" if mic else "meeting",
                speaker=user_name if mic else f"M{c.seq}-{s['speaker']}",
                text=s["text"],
            ))
    # Same timestamp: meeting audio first, so a mic echo follows the original.
    lines.sort(key=lambda l: (l.t, l.source == "mic"))
    return lines


def placeholder_name(label: str) -> str:
    m = _LABEL.match(label)
    return f"Speaker {m.group(1)}{m.group(2)}" if m else label


def _transcribe_pending(db, m: Meeting, ai: AIClient, skip_failed: bool) -> None:
    s = get_settings()
    todo = [c for c in m.chunks if c.status == ChunkStatus.pending or (c.status == ChunkStatus.failed and not skip_failed)]
    todo = [c for c in todo if c.path]
    if todo:
        # Network-bound OpenAI calls run in threads; DB writes stay on this thread.
        with ThreadPoolExecutor(max_workers=max(1, s.transcribe_concurrency)) as pool:
            futures = {pool.submit(_transcribe_chunk, ai, c.path): c for c in todo}
            for fut in as_completed(futures):
                c = futures[fut]
                try:
                    c.segments = [seg.model_dump() for seg in fut.result()]
                    c.status, c.error = ChunkStatus.transcribed, None
                except Exception as e:  # noqa: BLE001
                    log.warning("Chunk %s (%s #%s) failed: %s", c.id, c.track.value, c.seq, e)
                    c.status, c.error = ChunkStatus.failed, f"{type(e).__name__}: {e}"
        db.commit()

    failed = [c for c in m.chunks if c.status == ChunkStatus.failed]
    if failed and not skip_failed:
        raise PipelineError(
            f"{len(failed)} audio chunk(s) failed to transcribe (first error: {failed[0].error}). "
            "Retry, or retry with skip_failed_chunks=true to continue without them."
        )

    if not s.retain_audio:
        for c in m.chunks:
            if c.status == ChunkStatus.transcribed and c.path:
                delete_file(c.path)
                c.path = None
        db.commit()


def _build_transcript(m: Meeting, ai: AIClient) -> list[dict]:
    user_name = m.owner.name
    raw = merge_tracks(m.chunks, user_name)
    if not raw:
        raise PipelineError("No speech was detected in the recorded audio")

    names = [p.name for p in m.participants]
    labels = sorted({l.speaker for l in raw if l.source == "meeting"})
    mapping: dict[str, str | None] = {}
    if labels and names:
        others = [n for n in names if n.lower() != user_name.lower()]
        mapping = ai.identify_speakers(raw, others or names, user_name)
    for l in raw:
        if l.source == "meeting":
            l.speaker = mapping.get(l.speaker) or placeholder_name(l.speaker)

    batch = max(1, get_settings().refine_batch_lines)
    refined: list[RefinedLine] = []
    for i in range(0, len(raw), batch):
        part = raw[i:i + batch]
        out = ai.refine_transcript(part, names, user_name)
        # Never lose content because the LLM returned nothing for a batch.
        refined += out or [RefinedLine(t=l.t, speaker=l.speaker, text=l.text) for l in part]
    refined.sort(key=lambda l: l.t)
    return [l.model_dump() for l in refined]


def finalize_meeting(meeting_id: int, session_factory: sessionmaker, ai: AIClient, skip_failed_chunks: bool = False) -> None:
    with session_factory() as db:
        m = db.get(Meeting, meeting_id)
        if m is None:
            return
        try:
            if not m.transcript_lines:
                _transcribe_pending(db, m, ai, skip_failed_chunks)
                m.transcript_lines = _build_transcript(m, ai)
                m.transcript = render_transcript(m.transcript_lines)
                db.commit()  # the refined transcript is downloadable even if MOM generation fails

            mom = ai.extract_mom(m.transcript, m.title, m.meeting_date)
            m.summary = mom.summary
            m.discussion_points = mom.discussion_points
            m.decisions = mom.decisions
            m.action_items = [ActionItem(task=a.task, owner=a.owner, deadline=a.deadline) for a in mom.action_items]
            known = {p.name.strip().lower() for p in m.participants} | {m.owner.name.strip().lower()}
            for name in mom.participants:
                if name.strip() and name.strip().lower() not in known:
                    m.participants.append(Participant(name=name.strip(), source=ParticipantSource.detected))
                    known.add(name.strip().lower())

            m.status = MeetingStatus.draft
            m.error_message = None
        except Exception as e:  # noqa: BLE001 - any failure must land on the record
            log.exception("Finalizing meeting %s failed", meeting_id)
            m.status = MeetingStatus.failed
            m.error_message = str(e) if isinstance(e, PipelineError) else f"{type(e).__name__}: {e}"
        db.commit()


def resume_interrupted(session_factory: sessionmaker, ai_factory) -> int:
    """Re-run finalization for meetings left in "finalizing" because the process stopped
    mid-job (deploy, crash, or Container Apps scaling to zero). Finished stages are kept,
    so already-transcribed chunks are not sent to the AI again. Returns how many resumed.
    Run with a single replica: two processes resuming the same meeting would duplicate work."""
    from sqlalchemy import select

    with session_factory() as db:
        ids = list(db.scalars(select(Meeting.id).where(Meeting.status == MeetingStatus.finalizing)))
    if not ids:
        return 0
    log.info("Resuming %d interrupted meeting(s): %s", len(ids), ids)
    try:
        ai = ai_factory()
    except Exception as e:  # noqa: BLE001 - e.g. OPENAI_API_KEY missing
        with session_factory() as db:
            for mid in ids:
                m = db.get(Meeting, mid)
                m.status = MeetingStatus.failed
                m.error_message = f"Processing was interrupted and could not resume ({e}). Retry once fixed."
            db.commit()
        return 0
    for mid in ids:
        finalize_meeting(mid, session_factory, ai)
    return len(ids)
