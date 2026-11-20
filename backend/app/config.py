from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "MOM Generator API"

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/mom_db"

    openai_api_key: str | None = None
    openai_transcribe_model: str = "whisper-1"
    openai_llm_model: str = "gpt-4o-mini"

    upload_dir: Path = Path("./data/uploads")
    max_upload_mb: int = 25  # OpenAI transcription limit is 25 MB per file

    email_backend: Literal["console", "smtp"] = "console"
    email_outbox_dir: Path = Path("./data/outbox")
    email_from: str = "mom-bot@example.com"
    smtp_host: str = "localhost"
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool = True

    cors_origins: list[str] = ["http://localhost:8501"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
