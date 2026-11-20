"""OpenAI-backed transcription and MOM extraction."""
import json
import logging
from datetime import date
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, Field, field_validator

from app.config import get_settings

log = logging.getLogger(__name__)


class ExtractedActionItem(BaseModel):
    task: str
    owner: str | None = None
    deadline: date | None = None

    @field_validator("deadline", mode="before")
    @classmethod
    def lenient_date(cls, v):
        # The LLM is asked for ISO dates; anything else ("next week") becomes
        # None so the organiser fills it in during review instead of failing.
        if v in (None, "", "null"):
            return None
        try:
            return date.fromisoformat(str(v)[:10])
        except ValueError:
            return None


class ExtractedMom(BaseModel):
    summary: str = ""
    discussion_points: list[str] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)
    action_items: list[ExtractedActionItem] = Field(default_factory=list)
    participants: list[str] = Field(default_factory=list)


class AIClient(Protocol):
    def transcribe(self, audio_path: str) -> str: ...
    def extract_mom(self, transcript: str, meeting_title: str, meeting_date: date | None) -> ExtractedMom: ...


SYSTEM_PROMPT = """You are an expert executive assistant who writes Minutes of Meeting (MOM).
Read the meeting transcript and return ONLY a JSON object with exactly these keys:

{
  "summary": string - 3 to 6 sentence professional summary,
  "discussion_points": [string] - key topics discussed, one concise point each,
  "decisions": [string] - decisions explicitly agreed in the meeting (empty list if none),
  "action_items": [{"task": string, "owner": string or null, "deadline": "YYYY-MM-DD" or null}],
  "participants": [string] - names of people who spoke or were mentioned as attending
}

Rules:
- Only include information supported by the transcript. Do not invent owners, decisions or deadlines.
- owner must be the person responsible as named in the transcript; use null if unclear.
- Resolve relative deadlines ("by Friday", "end of next week") to absolute dates using the
  meeting date given below. If no meeting date is given or no deadline was stated, use null.
- Write in clear, neutral, professional English."""


class OpenAIClient:
    def __init__(self) -> None:
        from openai import OpenAI

        s = get_settings()
        if not s.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        self._client = OpenAI(api_key=s.openai_api_key)
        self._transcribe_model = s.openai_transcribe_model
        self._llm_model = s.openai_llm_model

    def transcribe(self, audio_path: str) -> str:
        with Path(audio_path).open("rb") as f:
            result = self._client.audio.transcriptions.create(
                model=self._transcribe_model, file=f, response_format="text"
            )
        # response_format="text" returns a plain string
        return result if isinstance(result, str) else result.text

    def extract_mom(self, transcript: str, meeting_title: str, meeting_date: date | None) -> ExtractedMom:
        user_msg = (
            f"Meeting title (as given by organiser): {meeting_title}\n"
            f"Meeting date: {meeting_date.isoformat() if meeting_date else 'unknown'}\n\n"
            f"Transcript:\n{transcript}"
        )
        resp = self._client.chat.completions.create(
            model=self._llm_model,
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
        )
        content = resp.choices[0].message.content or "{}"
        return ExtractedMom.model_validate(json.loads(content))


def get_ai_client() -> AIClient:
    return OpenAIClient()
