"""Local-disk file storage. Kept behind a tiny interface so it can be swapped
for Azure Blob Storage later without touching the routers."""
import uuid
from pathlib import Path

from app.config import get_settings

AUDIO_EXTENSIONS = {".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".wav", ".webm", ".ogg", ".flac"}
TRANSCRIPT_EXTENSIONS = {".txt", ".md", ".vtt", ".srt"}


def save_upload(filename: str, data: bytes) -> str:
    upload_dir = get_settings().upload_dir
    upload_dir.mkdir(parents=True, exist_ok=True)
    # Never trust the client filename for the on-disk path.
    path = upload_dir / f"{uuid.uuid4().hex}{Path(filename).suffix.lower()}"
    path.write_bytes(data)
    return str(path)
