import os
import tempfile
from datetime import date

_tmp = tempfile.mkdtemp(prefix="mom-tests-")
os.environ["UPLOAD_DIR"] = os.path.join(_tmp, "uploads")
os.environ["EMAIL_OUTBOX_DIR"] = os.path.join(_tmp, "outbox")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.db import Base, get_db, get_sessionmaker  # noqa: E402
from app.main import app  # noqa: E402
from app.routers.meetings import ai_dependency  # noqa: E402
from app.services.ai import ExtractedActionItem, ExtractedMom  # noqa: E402
from app.services.emailer import get_mailer  # noqa: E402


class FakeAI:
    def __init__(self):
        self.transcribed = []
        self.fail = False

    def transcribe(self, audio_path):
        self.transcribed.append(audio_path)
        return "Alice: We will ship v1 on Friday. Bob will write the release notes."

    def extract_mom(self, transcript, meeting_title, meeting_date):
        if self.fail:
            raise RuntimeError("LLM exploded")
        return ExtractedMom(
            summary="Team agreed to ship v1.",
            discussion_points=["Release timing"],
            decisions=["Ship v1 on Friday"],
            action_items=[ExtractedActionItem(task="Write release notes", owner="Bob", deadline=date(2026, 11, 27))],
            participants=["Alice", "Bob"],
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
def client(fake_ai, fake_mailer):
    engine = _make_engine()
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def _db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides.update({
        get_db: _db,
        get_sessionmaker: lambda: factory,
        ai_dependency: lambda: fake_ai,
        get_mailer: lambda: fake_mailer,
    })
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    engine.dispose()
