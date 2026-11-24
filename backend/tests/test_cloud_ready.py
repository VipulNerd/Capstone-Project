"""Azure readiness: Blob audio storage and resuming meetings interrupted by a restart/scale-to-zero."""
from pathlib import Path

import pytest
from azure.core.exceptions import ResourceNotFoundError

from app.models import Meeting, MeetingStatus
from app.services import pipeline, storage
from app.services.pipeline import resume_interrupted
from app.services.storage import BlobAudioStore, LocalAudioStore
from tests.conftest import segs
from tests.test_recording import chunk, start


class FakeContainer:
    """In-memory stand-in for azure.storage.blob.ContainerClient."""

    def __init__(self):
        self.blobs: dict[str, bytes] = {}

    def upload_blob(self, name, data, overwrite=False):
        assert overwrite
        self.blobs[name] = bytes(data)

    def download_blob(self, name):
        if name not in self.blobs:
            raise ResourceNotFoundError("missing")
        data = self.blobs[name]
        return type("Downloader", (), {"readall": lambda _self: data})()

    def delete_blob(self, name):
        if name not in self.blobs:
            raise ResourceNotFoundError("missing")
        del self.blobs[name]

    def list_blobs(self, name_starts_with=""):
        return [type("Blob", (), {"name": n})() for n in list(self.blobs) if n.startswith(name_starts_with)]


@pytest.fixture
def blob_store(monkeypatch):
    store = BlobAudioStore("unused", "audio", container_client=FakeContainer())
    monkeypatch.setattr(storage, "get_audio_store", lambda: store)
    monkeypatch.setattr(pipeline, "get_audio_store", lambda: store)
    return store


def test_blob_store_roundtrip():
    c = FakeContainer()
    s = BlobAudioStore("unused", "audio", container_client=c)
    key = s.save(7, "mic", 3, ".webm", b"abc")
    assert key == "meetings/7/mic-000003.webm" and c.blobs[key] == b"abc"
    with s.local_copy(key) as p:
        assert Path(p).name == "mic-000003.webm" and Path(p).read_bytes() == b"abc"
    assert not Path(p).exists()  # temporary download cleaned up
    s.save(7, "meeting", 0, ".webm", b"x")
    s.save(8, "mic", 0, ".webm", b"y")
    s.delete(key)
    s.delete(key)  # deleting twice is fine
    s.delete_meeting(7)
    assert list(c.blobs) == ["meetings/8/mic-000000.webm"]


def test_local_store_keys_are_paths(tmp_path):
    s = LocalAudioStore(tmp_path)
    key = s.save(1, "mic", 0, ".wav", b"z")
    with s.local_copy(key) as p:
        assert p == key and Path(p).read_bytes() == b"z"


def test_full_flow_with_blob_storage(client, auth, fake_ai, blob_store):
    mid = start(client, auth).json()["id"]
    chunk(client, auth, mid, "mic", 0, 0, segs((1, "A", "hello from blob storage")))
    chunk(client, auth, mid, "meeting", 0, 0, segs((3, "A", "meeting audio")))
    assert sorted(blob_store.container.blobs) == [f"meetings/{mid}/meeting-000000.webm", f"meetings/{mid}/mic-000000.webm"]

    client.post(f"/meetings/{mid}/end", headers=auth)
    m = client.get(f"/meetings/{mid}", headers=auth).json()
    assert m["status"] == "draft", m["error_message"]
    assert len(fake_ai.transcribe_calls) == 2
    assert blob_store.container.blobs == {}  # RETAIN_AUDIO=false: blobs removed after transcription

    # Deleting a meeting removes any remaining blobs too
    mid2 = start(client, auth).json()["id"]
    chunk(client, auth, mid2, "mic", 0, 0, segs((0, "A", "x")))
    assert client.delete(f"/meetings/{mid2}", headers=auth).status_code == 204
    assert blob_store.container.blobs == {}


def _interrupt(session_factory, mid):
    """Simulate the container stopping mid-processing: status stuck at 'finalizing'."""
    with session_factory() as db:
        db.get(Meeting, mid).status = MeetingStatus.finalizing
        db.commit()


def test_resume_interrupted_meeting(client, auth, fake_ai, session_factory):
    mid = start(client, auth).json()["id"]
    chunk(client, auth, mid, "mic", 0, 0, segs((0, "A", "resumed after restart")))
    _interrupt(session_factory, mid)

    assert resume_interrupted(session_factory, lambda: fake_ai) == 1
    m = client.get(f"/meetings/{mid}", headers=auth).json()
    assert m["status"] == "draft" and m["has_transcript"]
    assert resume_interrupted(session_factory, lambda: fake_ai) == 0  # nothing left to resume


def test_resume_without_ai_marks_failed_and_allows_retry(client, auth, fake_ai, session_factory):
    mid = start(client, auth).json()["id"]
    chunk(client, auth, mid, "mic", 0, 0, segs((0, "A", "hi")))
    _interrupt(session_factory, mid)

    def no_ai():
        raise RuntimeError("OPENAI_API_KEY is not configured")

    assert resume_interrupted(session_factory, no_ai) == 0
    m = client.get(f"/meetings/{mid}", headers=auth).json()
    assert m["status"] == "failed" and "could not resume" in m["error_message"]
    assert client.post(f"/meetings/{mid}/retry", headers=auth).status_code == 202  # user can retry
    assert client.get(f"/meetings/{mid}", headers=auth).json()["status"] == "draft"
