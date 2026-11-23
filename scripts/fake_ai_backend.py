"""Test harness: the real backend app with a fake AI client and a flaky mailer.

Used by the end-to-end regression suite (frontend/e2e/regression.spec.js) so the whole UI flow
can be tested without an AI key, a Postgres server or real email:
  - SQLite in a fresh temp folder (new empty database on every start)
  - FakeAI returns fixed transcripts and a fixed MOM, and leaves one speaker unnamed ("Speaker 0B")
  - audio files under 200 bytes fail to "transcribe" (exercises the failed-chunk UI)
  - email to addresses starting with "bounce" fails (exercises the failed-delivery UI)

Usage (from the repo root):
  backend\\.venv\\Scripts\\python.exe scripts\\fake_ai_backend.py      # http://127.0.0.1:8001
Backend code is imported, not modified.
"""
import os
import sys
import tempfile
import time
from datetime import date, timedelta
from pathlib import Path

PORT = int(os.environ.get("FAKE_BACKEND_PORT", "8001"))
DATA = Path(tempfile.mkdtemp(prefix="mom-fake-backend-"))
os.environ["DATABASE_URL"] = "sqlite:///" + (DATA / "test.db").as_posix()
os.environ["AUDIO_DIR"] = str(DATA / "audio")
os.environ["EMAIL_OUTBOX_DIR"] = str(DATA / "outbox")
os.environ["EMAIL_BACKEND"] = "console"
os.environ["SECRET_KEY"] = "fake-backend-secret"
os.environ["MS_CLIENT_ID"] = ""
os.environ["RETAIN_AUDIO"] = "true"
os.environ["CORS_ORIGINS"] = '["http://localhost:5173","http://localhost:5174"]'

BACKEND = Path(__file__).resolve().parent.parent / "backend"
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))

import uvicorn  # noqa: E402
from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.routers.meetings import ai_dependency  # noqa: E402
from app.services.ai import ExtractedActionItem, ExtractedMom, RefinedLine, Segment  # noqa: E402
from app.services.emailer import ConsoleMailer, get_mailer  # noqa: E402

Base.metadata.create_all(engine)


class FakeAI:
    def transcribe_segments(self, audio_path):
        time.sleep(1)
        if os.path.getsize(audio_path) < 200:
            raise RuntimeError("audio too short to decode")
        if os.path.basename(audio_path).startswith("mic"):
            return [Segment(start=1, end=3, speaker="A", text="um I'll send the release notes by Friday")]
        return [
            Segment(start=0, end=2, speaker="A", text="welcome everyone this is the launch sync"),
            Segment(start=2.5, end=4, speaker="B", text="QA found two blockers in checkout"),
        ]

    def identify_speakers(self, lines, participants, user_name):
        # First meeting voice -> first participant; the rest stay unnamed ("Speaker 0B").
        labels = sorted({line.speaker for line in lines if line.source == "meeting"})
        return {lab: (participants[0] if i == 0 and participants else None) for i, lab in enumerate(labels)}

    def refine_transcript(self, lines, participants, user_name):
        time.sleep(1)
        return [RefinedLine(t=line.t, speaker=line.speaker, text=line.text.replace("um ", "").capitalize() + ".")
                for line in lines]

    def extract_mom(self, transcript, meeting_title, meeting_date):
        time.sleep(1)
        base = meeting_date or date.today()
        return ExtractedMom(
            summary=f"The team held {meeting_title}. QA reported two checkout blockers.",
            discussion_points=["Launch readiness", "Checkout blockers"],
            decisions=["Launch stays on schedule"],
            action_items=[
                ExtractedActionItem(task="Send release notes", owner=None, deadline=base + timedelta(days=3)),
                ExtractedActionItem(task="Fix checkout blockers", owner=None, deadline=None),
            ],
            participants=["Speaker 0B"],
        )


class FlakyMailer(ConsoleMailer):
    def send(self, to, subject, body, attachment):
        if to.startswith("bounce"):
            raise ConnectionError("SMTP refused recipient")
        super().send(to, subject, body, attachment)


app.dependency_overrides[ai_dependency] = lambda: FakeAI()
app.dependency_overrides[get_mailer] = lambda: FlakyMailer()

if __name__ == "__main__":
    print(f"Fake-AI backend on http://127.0.0.1:{PORT} (data in {DATA})")
    uvicorn.run(app, host="127.0.0.1", port=PORT)
