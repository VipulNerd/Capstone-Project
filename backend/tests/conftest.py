import json
import os
import tempfile
from datetime import date
from pathlib import Path

_tmp = tempfile.mkdtemp(prefix="mom-tests-")
os.environ["AUDIO_DIR"] = os.path.join(_tmp, "audio")
os.environ["EMAIL_OUTBOX_DIR"] = os.path.join(_tmp, "outbox")
os.environ["SECRET_KEY"] = "test-secret"
os.environ["MS_CLIENT_ID"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.db import Base, get_db, get_sessionmaker  # noqa: E402
from app.main import app  # noqa: E402
from app.routers.meetings import ai_dependency  # noqa: E402
from app.services.ai import ExtractedActionItem, ExtractedMom, RefinedLine, Segment  # noqa: E402
from app.services.emailer import get_mailer  # noqa: E402


def segs(*items) -> bytes:
    """Fake audio chunk: the FakeAI 'transcribes' it to these segments.
    items: (start, speaker, text)"""
    return json.dumps([{"start": s, "end": s + 2, "speaker": sp, "text": t} for s, sp, t in items]).encode()


class FakeAI:
    def __init__(self):
        self.transcribe_calls = []
        self.speaker_map: dict[str, str] = {}
        self.speaker_calls = []
        self.refine_calls = []
        self.refine_empty = False
        self.mom_fail = False

    def transcribe_segments(self, audio_path):
        self.transcribe_calls.append(audio_path)
        data = Path(audio_path).read_bytes()
        if data.startswith(b"FAIL"):
            raise RuntimeError("corrupt audio")
        return [Segment(**s) for s in json.loads(data)]

    def identify_speakers(self, lines, participants, user_name):
        self.speaker_calls.append((lines, participants, user_name))
        return {l.speaker: self.speaker_map.get(l.speaker) for l in lines if l.source == "meeting"}

    def refine_transcript(self, lines, participants, user_name):
        self.refine_calls.append(lines)
        if self.refine_empty:
            return []
        meeting_texts = {l.text.lower() for l in lines if l.source == "meeting"}
        # Simulate echo removal: drop mic lines that repeat meeting audio.
        return [RefinedLine(t=l.t, speaker=l.speaker, text=l.text.strip().capitalize())
                for l in lines if not (l.source == "mic" and l.text.lower() in meeting_texts)]

    def extract_mom(self, transcript, meeting_title, meeting_date):
        if self.mom_fail:
            raise RuntimeError("LLM exploded")
        return ExtractedMom(
            summary="Team agreed to ship v1.",
            discussion_points=["Release timing"],
            decisions=["Ship v1 on Friday"],
            action_items=[ExtractedActionItem(task="Write release notes", owner="Bob", deadline=date(2026, 11, 27))],
            participants=["Bob", "Zed"],
        )


class FakeMailer:
    def __init__(self):
        self.sent = []
        self.fail_for = set()

    def send(self, to, subject, body, attachment):
        if to in self.fail_for:
            raise ConnectionError("SMTP down")
        self.sent.append((to, subject, attachment.filename))


@pytest.fixture
def fake_ai():
    return FakeAI()


@pytest.fixture
def fake_mailer():
    return FakeMailer()


def _make_engine():
    """SQLite in-memory by default; set TEST_DATABASE_URL to run against a real
    (disposable!) Postgres database. All tables there are dropped per test."""
    url = os.getenv("TEST_DATABASE_URL")
    if url:
        engine = create_engine(url)
        Base.metadata.drop_all(engine)
        return engine
    return create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@pytest.fixture
def session_factory():
    engine = _make_engine()
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    engine.dispose()


@pytest.fixture
def client(fake_ai, fake_mailer, session_factory):
    def _db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides.update({
        get_db: _db,
        get_sessionmaker: lambda: session_factory,
        ai_dependency: lambda: fake_ai,
        get_mailer: lambda: fake_mailer,
    })
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def register(client, name="Vipul", email="vipul@example.com") -> dict:
    r = client.post("/users", json={"name": name, "email": email})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['api_token']}"}


@pytest.fixture
def auth(client):
    return register(client)
