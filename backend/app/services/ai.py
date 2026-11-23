"""OpenAI-backed transcription, speaker identification, transcript refinement and MOM extraction."""
import json
import logging
import os
from datetime import date
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, Field, field_validator

from app.config import get_settings

log = logging.getLogger(__name__)


# --- Data shapes -------------------------------------------------------------------------------


class Segment(BaseModel):
    """One diarized utterance, times in seconds relative to the audio chunk."""
    start: float
    end: float
    speaker: str
    text: str


class RawLine(BaseModel):
    """Merged, time-ordered line before refinement."""
    t: float          # seconds since recording start
    source: str       # "mic" or "meeting"
    speaker: str      # user's name for mic; chunk-scoped label (e.g. "M3-A") or mapped name for meeting
    text: str


class RefinedLine(BaseModel):
    t: float
    speaker: str
    text: str


class ExtractedActionItem(BaseModel):
    task: str
    owner: str | None = None
    deadline: date | None = None

    @field_validator("deadline", mode="before")
    @classmethod
    def lenient_date(cls, v):
        # The LLM is asked for ISO dates; anything else ("next week") becomes None
        # so the organiser fills it in during review instead of failing.
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
    def transcribe_segments(self, audio_path: str) -> list[Segment]: ...
    def identify_speakers(self, lines: list[RawLine], participants: list[str], user_name: str) -> dict[str, str | None]: ...
    def refine_transcript(self, lines: list[RawLine], participants: list[str], user_name: str) -> list[RefinedLine]: ...
    def extract_mom(self, transcript: str, meeting_title: str, meeting_date: date | None) -> ExtractedMom: ...


# --- Prompts -----------------------------------------------------------------------------------

SPEAKER_PROMPT = """You identify speakers in a meeting transcript.
The meeting audio was split into chunks and diarized per chunk, so anonymous labels look like
"M3-A" (chunk 3, speaker A). The SAME person usually has DIFFERENT labels in different chunks.
Lines from source "mic" are always the app user (already named).

Using the participant list from the calendar invite and clues in the conversation (people
addressing each other by name, introductions, roles, continuity of topic and speaking style),
map each anonymous label to a participant name.

Return ONLY a JSON object: {"mapping": {"<label>": "<participant name>" or null}}
Include every anonymous label. Use null when you are not reasonably confident.
Only use names from the participant list."""

REFINE_PROMPT = """You turn a raw, machine-generated meeting transcript into a clean, readable one.
Input lines have: t (seconds), source ("mic" = the app user, "meeting" = other participants), speaker, text.

Rules:
- Fix obvious transcription errors, punctuation and casing. Remove filler words (um, uh, you know)
  and false starts, but NEVER change meaning, add content, or summarise.
- The mic also picks up other participants through the user's speakers. If a "mic" line repeats
  what a "meeting" line at about the same time says, DROP the mic line (it is echo).
- Merge consecutive lines by the same speaker into one line (keep the first line's t).
- Keep speaker names exactly as given (including placeholders like "Speaker 3A").
- Keep the original language; do not translate.

Return ONLY JSON: {"lines": [{"t": number, "speaker": string, "text": string}]}"""

MOM_PROMPT = """You are an expert executive assistant who writes Minutes of Meeting (MOM).
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


def _lines_json(lines: list[RawLine]) -> str:
    return json.dumps([l.model_dump() for l in lines], ensure_ascii=False)


# --- OpenAI implementation ---------------------------------------------------------------------


class OpenAIClient:
    def __init__(self) -> None:
        from openai import AzureOpenAI, OpenAI

        s = get_settings()
        if not s.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        base_url = s.openai_base_url or os.environ.get("OPENAI_BASE_URL") or None
        if s.openai_api_version:
            # Azure: https://<resource>.openai.azure.com[/openai/v1/] -> endpoint without the path
            endpoint = (base_url or "").split("/openai")[0].rstrip("/")
            if not endpoint:
                raise RuntimeError("OPENAI_BASE_URL (the Azure OpenAI endpoint) is required with OPENAI_API_VERSION")
            self._client = AzureOpenAI(api_key=s.openai_api_key, azure_endpoint=endpoint, api_version=s.openai_api_version)
        else:
            # Explicit default: the SDK would take an empty OPENAI_BASE_URL env var literally.
            self._client = OpenAI(api_key=s.openai_api_key, base_url=base_url or "https://api.openai.com/v1")
        self._transcribe_model = s.openai_transcribe_model
        self._llm_model = s.openai_llm_model

    def _json_chat(self, system: str, user: str) -> dict:
        resp = self._client.chat.completions.create(
            model=self._llm_model,
            temperature=0.1,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        return json.loads(resp.choices[0].message.content or "{}")

    def transcribe_segments(self, audio_path: str) -> list[Segment]:
        with Path(audio_path).open("rb") as f:
            result = self._client.audio.transcriptions.create(
                model=self._transcribe_model,
                file=f,
                response_format="diarized_json",
                chunking_strategy="auto",  # required by the diarize model for audio > 30 s
            )
        return [
            Segment(start=s.start, end=s.end, speaker=s.speaker, text=s.text.strip())
            for s in (result.segments or [])
            if s.text and s.text.strip()
        ]

    def identify_speakers(self, lines: list[RawLine], participants: list[str], user_name: str) -> dict[str, str | None]:
        data = self._json_chat(
            SPEAKER_PROMPT,
            f"App user (mic): {user_name}\nParticipants: {json.dumps(participants, ensure_ascii=False)}\n\n"
            f"Transcript lines:\n{_lines_json(lines)}",
        )
        allowed = {p.lower(): p for p in participants}
        mapping = {}
        for label, name in (data.get("mapping") or {}).items():
            # Never accept a name that is not on the invite.
            mapping[label] = allowed.get(str(name).lower()) if name else None
        return mapping

    def refine_transcript(self, lines: list[RawLine], participants: list[str], user_name: str) -> list[RefinedLine]:
        data = self._json_chat(
            REFINE_PROMPT,
            f"App user (mic): {user_name}\nParticipants: {json.dumps(participants, ensure_ascii=False)}\n\n"
            f"Lines:\n{_lines_json(lines)}",
        )
        out = []
        for item in data.get("lines") or []:
            try:
                out.append(RefinedLine.model_validate(item))
            except Exception:  # noqa: BLE001 - skip a malformed line rather than lose the batch
                log.warning("Dropping malformed refined line: %r", item)
        return out

    def extract_mom(self, transcript: str, meeting_title: str, meeting_date: date | None) -> ExtractedMom:
        data = self._json_chat(
            MOM_PROMPT,
            f"Meeting title: {meeting_title}\n"
            f"Meeting date: {meeting_date.isoformat() if meeting_date else 'unknown'}\n\n"
            f"Transcript:\n{transcript}",
        )
        return ExtractedMom.model_validate(data)


def get_ai_client() -> AIClient:
    return OpenAIClient()
