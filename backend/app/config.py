from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "MOM Generator API"
    # Public URL of this API (used to build the OAuth redirect URI).
    public_base_url: str = "http://localhost:8000"
    # Signs OAuth state and encrypts stored calendar tokens. CHANGE IN PRODUCTION.
    secret_key: str = "dev-only-change-me"

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/mom_db"

    # --- OpenAI ---
    openai_api_key: str | None = None
    # Optional. OpenAI-compatible base URL, or the Azure OpenAI endpoint. Empty = api.openai.com
    # (the OpenAI SDK also reads OPENAI_BASE_URL from the process environment).
    openai_base_url: str | None = None
    # Azure OpenAI only: an API version such as "2025-04-01-preview" switches to the AzureOpenAI
    # client, which calls models by deployment (needed for gpt-4o-transcribe-diarize, which
    # Azure's /openai/v1 API does not serve). Empty = plain OpenAI client.
    openai_api_version: str | None = None
    # Must support response_format="diarized_json" (speaker labels + timestamps).
    openai_transcribe_model: str = "gpt-4o-transcribe-diarize"
    openai_llm_model: str = "gpt-4o-mini"
    transcribe_concurrency: int = 4      # parallel chunk transcriptions at meeting end
    refine_batch_lines: int = 120        # transcript lines per LLM refinement call

    # --- Audio chunks streamed by the overlay agent ---
    # "local" keeps chunks under AUDIO_DIR (dev, tests). "blob" uses Azure Blob Storage, which
    # survives container restarts and scale-to-zero (required on Azure Container Apps).
    storage_backend: Literal["local", "blob"] = "local"
    audio_dir: Path = Path("./data/audio")
    azure_storage_connection_string: str | None = None
    azure_storage_container: str = "audio"
    max_chunk_mb: int = 25               # OpenAI transcription limit per file
    retain_audio: bool = False           # delete raw audio once transcribed (privacy)

    # On startup, resume meetings left in "finalizing" by a restart or scale-to-zero.
    resume_on_startup: bool = True

    # --- Microsoft Graph (Outlook calendar). Leave client_id empty to disable. ---
    ms_client_id: str | None = None
    ms_client_secret: str | None = None
    ms_tenant: str = "common"            # "common" = work/school + personal accounts

    # --- Email ---
    email_backend: Literal["console", "smtp"] = "console"
    email_outbox_dir: Path = Path("./data/outbox")
    email_from: str = "mom-bot@example.com"
    smtp_host: str = "localhost"
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool = True

    cors_origins: list[str] = ["http://localhost:8501"]

    @property
    def ms_redirect_uri(self) -> str:
        return f"{self.public_base_url.rstrip('/')}/calendar/microsoft/callback"


@lru_cache
def get_settings() -> Settings:
    return Settings()
