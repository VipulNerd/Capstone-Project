"""Audio chunk storage: local disk (dev/tests) or Azure Blob Storage (production).

The value stored in AudioChunk.path is an opaque storage key:
  - local: the absolute file path (unchanged from earlier versions, so existing rows keep working)
  - blob:  "meetings/<meeting_id>/<track>-<seq>.<ext>" inside AZURE_STORAGE_CONTAINER
The transcriber needs a file on disk, so `local_copy()` yields a path: the file itself for local
storage, or a temporary download (same file name) for blobs.
"""
import logging
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from app.config import get_settings

log = logging.getLogger(__name__)

AUDIO_EXTENSIONS = {".webm", ".ogg", ".wav", ".mp3", ".m4a", ".flac", ".mp4", ".mpeg", ".mpga"}


def _chunk_name(track: str, seq: int, suffix: str) -> str:
    # Built only from validated values; never from the client filename.
    return f"{track}-{seq:06d}{suffix}"


class AudioStore(Protocol):
    def save(self, meeting_id: int, track: str, seq: int, suffix: str, data: bytes) -> str: ...
    def local_copy(self, key: str) -> AbstractContextManager[str]: ...
    def delete(self, key: str | None) -> None: ...
    def delete_meeting(self, meeting_id: int) -> None: ...


class LocalAudioStore:
    def __init__(self, root: Path):
        self.root = root

    def _dir(self, meeting_id: int) -> Path:
        return self.root / str(meeting_id)

    def save(self, meeting_id: int, track: str, seq: int, suffix: str, data: bytes) -> str:
        d = self._dir(meeting_id)
        d.mkdir(parents=True, exist_ok=True)
        path = d / _chunk_name(track, seq, suffix)
        path.write_bytes(data)
        return str(path)

    @contextmanager
    def local_copy(self, key: str) -> Iterator[str]:
        yield key

    def delete(self, key: str | None) -> None:
        if key:
            Path(key).unlink(missing_ok=True)

    def delete_meeting(self, meeting_id: int) -> None:
        shutil.rmtree(self._dir(meeting_id), ignore_errors=True)


class BlobAudioStore:
    def __init__(self, connection_string: str, container: str, container_client=None):
        if container_client is None:
            from azure.core.exceptions import ResourceExistsError
            from azure.storage.blob import BlobServiceClient

            container_client = BlobServiceClient.from_connection_string(connection_string).get_container_client(container)
            try:
                container_client.create_container()  # private by default
            except ResourceExistsError:
                pass
        self.container = container_client

    @staticmethod
    def _prefix(meeting_id: int) -> str:
        return f"meetings/{meeting_id}/"

    def save(self, meeting_id: int, track: str, seq: int, suffix: str, data: bytes) -> str:
        key = self._prefix(meeting_id) + _chunk_name(track, seq, suffix)
        self.container.upload_blob(key, data, overwrite=True)
        return key

    @contextmanager
    def local_copy(self, key: str) -> Iterator[str]:
        with tempfile.TemporaryDirectory(prefix="mom-chunk-") as tmp:
            path = Path(tmp) / Path(key).name  # keep the "<track>-<seq>.<ext>" name and extension
            path.write_bytes(self.container.download_blob(key).readall())
            yield str(path)

    def delete(self, key: str | None) -> None:
        if not key:
            return
        from azure.core.exceptions import ResourceNotFoundError

        try:
            self.container.delete_blob(key)
        except ResourceNotFoundError:
            pass

    def delete_meeting(self, meeting_id: int) -> None:
        for blob in self.container.list_blobs(name_starts_with=self._prefix(meeting_id)):
            self.delete(blob.name)


@lru_cache
def get_audio_store() -> AudioStore:
    s = get_settings()
    if s.storage_backend == "blob":
        if not s.azure_storage_connection_string:
            raise RuntimeError("STORAGE_BACKEND=blob needs AZURE_STORAGE_CONNECTION_STRING")
        return BlobAudioStore(s.azure_storage_connection_string, s.azure_storage_container)
    return LocalAudioStore(s.audio_dir)


# --- Module-level helpers used by the routers and pipeline -------------------------------------


def save_chunk(meeting_id: int, track: str, seq: int, suffix: str, data: bytes) -> str:
    return get_audio_store().save(meeting_id, track, seq, suffix, data)


def delete_file(key: str | None) -> None:
    get_audio_store().delete(key)


def delete_meeting_audio(meeting_id: int) -> None:
    get_audio_store().delete_meeting(meeting_id)
