import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import get_settings
from app.db import SessionLocal, engine
from app.routers import auth, calendar, meetings, users
from app.services.emailer import smtp_config_problem

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

settings = get_settings()
if settings.secret_key == "dev-only-change-me":
    log.warning("SECRET_KEY is the dev default; set a strong value before deploying")
if settings.email_backend == "console":
    log.warning("EMAIL_BACKEND=console: 'Send MOM' only saves emails under %s; nothing is emailed", settings.email_outbox_dir)
elif problem := smtp_config_problem(settings):
    log.error("%s; every email send will fail", problem)


def _resume_in_background() -> None:
    from app.services.ai import get_ai_client
    from app.services.pipeline import resume_interrupted

    try:
        resume_interrupted(SessionLocal, get_ai_client)
    except Exception:  # noqa: BLE001 - e.g. database unreachable; the app keeps serving
        log.exception("Could not resume interrupted meetings")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.resume_on_startup:
        # A thread, so a long resume never delays startup or health probes.
        threading.Thread(target=_resume_in_background, name="resume-meetings", daemon=True).start()
    yield


app = FastAPI(title=settings.app_name, version="0.3.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(calendar.router)
app.include_router(meetings.router)


@app.get("/health", tags=["health"])
def health():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False
    s = get_settings()
    email = s.email_backend if s.email_backend == "console" or not smtp_config_problem(s) else "misconfigured"
    return {"status": "ok" if db_ok else "degraded", "database": db_ok, "email": email}
