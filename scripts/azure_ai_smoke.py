"""Smoke test for the AI provider the backend is configured with (e.g. Azure OpenAI).

Runs the backend's own OpenAIClient:
  1. diarized transcription of a real recording (OPENAI_TRANSCRIBE_MODEL, needs diarized_json)
  2. MOM extraction (OPENAI_LLM_MODEL, JSON mode, temperature as the backend sends it)

Usage (from the repo root, with the backend virtualenv):
  backend\\.venv\\Scripts\\python.exe scripts\\azure_ai_smoke.py --llm-only
      Only step 2, on a built-in sample transcript. No audio needed; costs about a cent.
      Use it to check a chat model deployment (e.g. gpt-5.1-mini) accepts the backend's parameters.
  backend\\.venv\\Scripts\\python.exe scripts\\azure_ai_smoke.py path\\to\\two_speakers.wav
      Both steps, on a real recording with 2+ voices.

Reads backend/.env. OPENAI_BASE_URL is copied from .env into the environment because the
OpenAI SDK only reads it from there. Exits non-zero if anything fails or no speech comes back.
"""
import os
import sys
import time
from datetime import date
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"

SAMPLE_TRANSCRIPT = """\
Priya Sharma: Thanks for joining. Today we decide on the launch date and go through the QA status.
Tom Lee: QA found two blockers in checkout. I can fix both by Friday.
Priya Sharma: Good. Then we keep the launch on the 1st of next month.
Sam Patel: I'll update the release notes once Tom's fixes are merged, say by Monday.
Priya Sharma: Great. Decision: launch stays on schedule. Tom fixes the blockers, Sam does release notes."""


def load_base_url() -> None:
    env = BACKEND / ".env"
    if "OPENAI_BASE_URL" in os.environ or not env.exists():
        return
    for raw in env.read_text(encoding="utf-8").splitlines():
        key, _, value = raw.partition("=")
        if key.strip() == "OPENAI_BASE_URL" and value.strip():
            os.environ["OPENAI_BASE_URL"] = value.strip().strip('"')


def explain(err: Exception, what: str) -> int:
    msg = str(err)
    print(f"FAIL ({what}): {type(err).__name__}: {msg}")
    low = msg.lower()
    if "temperature" in low:
        print("  -> This model rejects the backend's temperature=0.1. The backend needs an option to omit it.")
    elif "response_format" in low or "json" in low:
        print("  -> This model does not support JSON mode (response_format=json_object). Pick another chat model.")
    elif "deploymentnotfound" in low or "404" in low:
        print("  -> Check the model value is the DEPLOYMENT name. On Azure, set OPENAI_API_VERSION "
              "(e.g. 2025-04-01-preview): /openai/v1 does not serve gpt-4o-transcribe-diarize.")
    elif "401" in low or "unauthorized" in low:
        print("  -> Wrong OPENAI_API_KEY for this endpoint.")
    elif "diarized_json" in low:
        print("  -> This transcription model does not support diarized_json; use gpt-4o-transcribe-diarize.")
    return 1


def main() -> int:
    args = sys.argv[1:]
    llm_only = args == ["--llm-only"]
    if not llm_only and len(args) != 1:
        print(__doc__)
        return 2
    audio = None if llm_only else Path(args[0]).resolve()
    if audio and not audio.exists():
        print(f"File not found: {audio}")
        return 2

    load_base_url()
    os.chdir(BACKEND)  # so pydantic-settings finds backend/.env
    sys.path.insert(0, str(BACKEND))
    from app.config import get_settings
    from app.services.ai import OpenAIClient

    s = get_settings()
    print(f"Endpoint:      {os.environ.get('OPENAI_BASE_URL', 'https://api.openai.com/v1 (default)')}")
    if not llm_only:
        print(f"Transcription: {s.openai_transcribe_model}")
    print(f"LLM:           {s.openai_llm_model}\n")
    try:
        client = OpenAIClient()
    except RuntimeError as e:
        print(f"FAIL: {e} (set it in backend/.env)")
        return 1

    if llm_only:
        transcript = SAMPLE_TRANSCRIPT
    else:
        t0 = time.perf_counter()
        try:
            segments = client.transcribe_segments(str(audio))
        except Exception as e:  # noqa: BLE001
            return explain(e, "transcription")
        print(f"[1] Transcription: {len(segments)} segments in {time.perf_counter() - t0:.1f}s")
        if not segments:
            print("FAIL: no segments returned (known gpt-4o-transcribe-diarize issue; try another file or region)")
            return 1
        speakers = sorted({seg.speaker for seg in segments})
        print(f"    Speakers: {', '.join(speakers)}")
        for seg in segments[:8]:
            print(f"    {seg.start:6.1f}s  {seg.speaker:>4}: {seg.text}")
        if len(speakers) < 2:
            print("    WARNING: only one speaker detected; use a recording with two voices to check diarization")
        transcript = "\n".join(f"{seg.speaker}: {seg.text}" for seg in segments)

    t0 = time.perf_counter()
    try:
        mom = client.extract_mom(transcript, "Smoke test meeting", date.today())
    except Exception as e:  # noqa: BLE001
        return explain(e, "MOM extraction")
    print(f"\n[2] MOM extraction in {time.perf_counter() - t0:.1f}s")
    print(mom.model_dump_json(indent=2))
    if llm_only and not mom.action_items:
        print("WARNING: no action items extracted from the sample (expected 2); check output quality")
    print("\nPASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
