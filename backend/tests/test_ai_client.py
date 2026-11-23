"""Which OpenAI SDK client OpenAIClient builds from the settings (no network calls)."""
import pytest
from openai import AzureOpenAI, OpenAI

from app.config import get_settings
from app.services.ai import OpenAIClient


@pytest.fixture
def build(monkeypatch):
    def _build(**env):
        monkeypatch.setenv("OPENAI_API_KEY", "test-key")
        # Override anything a local backend/.env might set.
        for key in ("OPENAI_BASE_URL", "OPENAI_API_VERSION"):
            monkeypatch.setenv(key, env.get(key, ""))
        get_settings.cache_clear()
        return OpenAIClient()._client

    yield _build
    get_settings.cache_clear()


def test_plain_openai_client_by_default(build):
    client = build()
    assert type(client) is OpenAI
    assert str(client.base_url).startswith("https://api.openai.com/v1")


def test_openai_compatible_base_url(build):
    client = build(OPENAI_BASE_URL="https://api.groq.com/openai/v1")
    assert type(client) is OpenAI
    assert str(client.base_url) == "https://api.groq.com/openai/v1/"


def test_api_version_switches_to_azure_client(build):
    client = build(OPENAI_BASE_URL="https://res.openai.azure.com/openai/v1/", OPENAI_API_VERSION="2025-04-01-preview")
    assert isinstance(client, AzureOpenAI)
    assert str(client.base_url).startswith("https://res.openai.azure.com/openai")
    assert "/v1" not in str(client.base_url)
    assert client._api_version == "2025-04-01-preview"


def test_azure_needs_endpoint(build):
    with pytest.raises(RuntimeError, match="OPENAI_BASE_URL"):
        build(OPENAI_API_VERSION="2025-04-01-preview")
