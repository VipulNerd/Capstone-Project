"""Local-disk audio storage. Kept behind a tiny interface so it can be swapped
for Azure Blob Storage later without touching the routers or pipeline."""
import shutil
from pathlib import Path

from app.config import get_settings

AUDIO_EXTENSIONS = {".webm", ".ogg", ".wav", ".mp3", ".m4a", ".flac", ".mp4", ".mpeg", ".mpga"}


def _meeting_dir(meeting_id: int) -> Path:
    return get_settings().audio_dir / str(meeting_id)


def save_chunk(meeting_id: int, track: str, seq: int, suffix: str, data: bytes) -> str:
    d = _meeting_dir(meeting_id)
    d.mkdir(parents=True, exist_ok=True)
    # Built only from validated values; never from the client filename.
    path = d / f"{track}-{seq:06d}{suffix}"
    path.write_bytes(data)
    return str(path)


def delete_file(path: str | None) -> None:
    if path:
        Path(path).unlink(missing_ok=True)


def delete_meeting_audio(meeting_id: int) -> None:
    shutil.rmtree(_meeting_dir(meeting_id), ignore_errors=True)
