"""Live-recording flow: start -> stream mic/meeting chunks -> end -> refined transcript -> MOM."""
from pathlib import Path

from tests.conftest import register, segs

PARTICIPANTS = [{"name": "Bob", "email": "bob@example.com"}, {"name": "Carol", "email": "carol@example.com"}]


def start(client, auth, **kw):
    body = {"recording_consent": True, "title": "Weekly sync", "participants": PARTICIPANTS, **kw}
    return client.post("/meetings", json=body, headers=auth)


def chunk(client, auth, mid, track, seq, offset_ms, content, filename="c.webm"):
    return client.post(f"/meetings/{mid}/audio", headers=auth,
                       data={"track": track, "seq": seq, "offset_ms": offset_ms},
                       files={"file": (filename, content)})


def record_standard(client, auth, fake_ai):
    """Two 60-second chunks per track. Meeting-track labels are per chunk."""
    mid = start(client, auth).json()["id"]
    chunk(client, auth, mid, "meeting", 0, 0, segs((1, "A", "hi everyone, this is bob"), (10, "B", "carol here")))
    chunk(client, auth, mid, "mic", 0, 0, segs((5, "A", "hello, vipul here"), (10.5, "A", "carol here")))  # 2nd = echo
    chunk(client, auth, mid, "meeting", 1, 60_000, segs((2, "A", "carol again"), (30, "B", "ship friday")))
    chunk(client, auth, mid, "mic", 1, 60_000, segs((20, "A", "agreed")))
    fake_ai.speaker_map = {"M0-A": "Bob", "M0-B": "Carol", "M1-A": "Carol"}  # M1-B unidentified
    return mid


def finish(client, auth, mid):
    r = client.post(f"/meetings/{mid}/end", headers=auth)
    assert r.status_code == 202, r.text
    return client.get(f"/meetings/{mid}", headers=auth).json()


# --- starting --------------------------------------------------------------------------------


def test_start_requires_consent_and_source(client, auth):
    assert start(client, auth, recording_consent=False).status_code == 422
    r = client.post("/meetings", json={"recording_consent": True}, headers=auth)
    assert r.status_code == 422 and "calendar_event_id" in r.text


def test_start_manual_adds_owner_as_participant(client, auth):
    m = start(client, auth).json()
    assert m["status"] == "recording" and m["calendar_source"] == "manual"
    people = {p["email"]: p for p in m["participants"]}
    assert set(people) == {"bob@example.com", "carol@example.com", "vipul@example.com"}
    assert m["organizer_email"] == "vipul@example.com"


def test_requires_auth_and_isolates_users(client, auth):
    assert client.post("/meetings", json={"recording_consent": True, "title": "x"}).status_code == 401
    mid = start(client, auth).json()["id"]
    other = register(client, "Eve", "eve@example.com")
    assert client.get(f"/meetings/{mid}", headers=other).status_code == 404
    assert chunk(client, other, mid, "mic", 0, 0, segs()).status_code == 404
    assert client.get("/meetings", headers=other).json() == []


# --- streaming chunks --------------------------------------------------------------------------


def test_chunk_upload_validation_and_idempotency(client, auth):
    mid = start(client, auth).json()["id"]
    assert chunk(client, auth, mid, "mic", 0, 0, segs((0, "A", "x"))).status_code == 201
    again = chunk(client, auth, mid, "mic", 0, 0, b"different bytes")
    assert again.status_code == 200 and again.json()["seq"] == 0          # retry-safe, not overwritten
    assert chunk(client, auth, mid, "mic", 1, 0, b"x", "c.exe").status_code == 415
    assert chunk(client, auth, mid, "mic", 1, 0, b"").status_code == 422
    assert chunk(client, auth, mid, "speaker", 1, 0, b"x").status_code == 422  # bad track
    assert chunk(client, auth, mid, "mic", -1, 0, b"x").status_code == 422
    chunks = client.get(f"/meetings/{mid}/chunks", headers=auth).json()
    assert [(c["track"], c["seq"], c["status"]) for c in chunks] == [("mic", 0, "pending")]


def test_chunk_too_large(client, auth, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "max_chunk_mb", 0)
    mid = start(client, auth).json()["id"]
    assert chunk(client, auth, mid, "mic", 0, 0, b"x").status_code == 413


def test_end_requires_audio_and_blocks_further_chunks(client, auth):
    mid = start(client, auth).json()["id"]
    assert client.post(f"/meetings/{mid}/end", headers=auth).status_code == 422
    chunk(client, auth, mid, "mic", 0, 0, segs((0, "A", "hello")))
    finish(client, auth, mid)
    assert chunk(client, auth, mid, "mic", 1, 1000, segs()).status_code == 409
    assert client.post(f"/meetings/{mid}/end", headers=auth).status_code == 409


# --- finalization ------------------------------------------------------------------------------


def test_full_flow_builds_refined_transcript(client, auth, fake_ai):
    mid = record_standard(client, auth, fake_ai)
    m = finish(client, auth, mid)
    assert m["status"] == "draft", m["error_message"]
    assert m["has_transcript"] and m["recording_ended_at"]

    lines = client.get(f"/meetings/{mid}/transcript?format=json", headers=auth).json()["lines"]
    assert [(l["t"], l["speaker"], l["text"]) for l in lines] == [
        (1.0, "Bob", "Hi everyone, this is bob"),
        (5.0, "Vipul", "Hello, vipul here"),
        (10.0, "Carol", "Carol here"),            # mic echo at 10.5 s dropped
        (62.0, "Carol", "Carol again"),           # chunk offset 60 s applied
        (80.0, "Vipul", "Agreed"),
        (90.0, "Speaker 1B", "Ship friday"),      # unidentified -> stable placeholder
    ]
    # Speaker identification gets invite names, excluding the mic user.
    _, names, user_name = fake_ai.speaker_calls[0]
    assert user_name == "Vipul" and set(names) == {"Bob", "Carol"}

    # Raw audio removed after successful transcription (RETAIN_AUDIO=false)
    assert not any(Path(p).exists() for p in fake_ai.transcribe_calls)
    assert len(fake_ai.transcribe_calls) == 4

    # MOM drafted; LLM-detected name added, existing ones not duplicated
    people = {p["name"]: p["source"] for p in m["participants"]}
    assert people == {"Bob": "manual", "Carol": "manual", "Vipul": "manual", "Zed": "detected"}
    assert m["summary"] == "Team agreed to ship v1."


def test_transcript_download_formats(client, auth, fake_ai):
    mid = record_standard(client, auth, fake_ai)
    assert client.get(f"/meetings/{mid}/transcript", headers=auth).status_code == 409  # not ready
    finish(client, auth, mid)
    txt = client.get(f"/meetings/{mid}/transcript?format=txt", headers=auth)
    assert txt.status_code == 200 and "[00:00:01] Bob: Hi everyone, this is bob" in txt.text
    assert txt.headers["content-type"].startswith("text/plain")
    assert 'filename="Transcript_Weekly_sync.txt"' in txt.headers["content-disposition"]
    assert client.get(f"/meetings/{mid}/transcript?format=pdf", headers=auth).content.startswith(b"%PDF")
    assert client.get(f"/meetings/{mid}/transcript?format=docx", headers=auth).content.startswith(b"PK")
    assert client.get(f"/meetings/{mid}/transcript?format=xml", headers=auth).status_code == 422


def test_failed_chunk_then_retry_and_skip(client, auth, fake_ai):
    mid = start(client, auth).json()["id"]
    chunk(client, auth, mid, "meeting", 0, 0, segs((1, "A", "first part")))
    chunk(client, auth, mid, "meeting", 1, 60_000, b"FAIL corrupt")
    m = finish(client, auth, mid)
    assert m["status"] == "failed" and "1 audio chunk(s) failed" in m["error_message"]
    assert m["has_transcript"] is False

    # Plain retry: the good chunk is NOT re-transcribed, the bad one is retried (and fails again)
    calls_before = len(fake_ai.transcribe_calls)
    client.post(f"/meetings/{mid}/retry", headers=auth)
    assert len(fake_ai.transcribe_calls) == calls_before + 1
    assert client.get(f"/meetings/{mid}", headers=auth).json()["status"] == "failed"

    # Skip the broken chunk and continue with what we have
    client.post(f"/meetings/{mid}/retry", json={"skip_failed_chunks": True}, headers=auth)
    m = client.get(f"/meetings/{mid}", headers=auth).json()
    assert m["status"] == "draft"
    statuses = {c["seq"]: c["status"] for c in client.get(f"/meetings/{mid}/chunks", headers=auth).json()}
    assert statuses == {0: "transcribed", 1: "failed"}


def test_mom_failure_keeps_transcript_and_retry_skips_transcription(client, auth, fake_ai):
    fake_ai.mom_fail = True
    mid = record_standard(client, auth, fake_ai)
    m = finish(client, auth, mid)
    assert m["status"] == "failed" and "LLM exploded" in m["error_message"]
    assert client.get(f"/meetings/{mid}/transcript", headers=auth).status_code == 200  # still downloadable

    fake_ai.mom_fail = False
    calls = (len(fake_ai.transcribe_calls), len(fake_ai.refine_calls))
    client.post(f"/meetings/{mid}/retry", headers=auth)
    assert client.get(f"/meetings/{mid}", headers=auth).json()["status"] == "draft"
    assert (len(fake_ai.transcribe_calls), len(fake_ai.refine_calls)) == calls


def test_no_speech_fails_cleanly(client, auth):
    mid = start(client, auth).json()["id"]
    chunk(client, auth, mid, "mic", 0, 0, segs())
    m = finish(client, auth, mid)
    assert m["status"] == "failed" and "No speech" in m["error_message"]


def test_refine_batches_and_empty_fallback(client, auth, fake_ai, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "refine_batch_lines", 2)
    fake_ai.refine_empty = True
    mid = start(client, auth).json()["id"]
    chunk(client, auth, mid, "mic", 0, 0, segs((0, "A", "one"), (3, "A", "two"), (6, "A", "three")))
    finish(client, auth, mid)
    assert [len(b) for b in fake_ai.refine_calls] == [2, 1]
    lines = client.get(f"/meetings/{mid}/transcript?format=json", headers=auth).json()["lines"]
    assert [l["text"] for l in lines] == ["one", "two", "three"]  # raw kept, nothing lost


def test_retain_audio_setting(client, auth, fake_ai, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "retain_audio", True)
    mid = start(client, auth).json()["id"]
    chunk(client, auth, mid, "mic", 0, 0, segs((0, "A", "keep me")))
    finish(client, auth, mid)
    assert Path(fake_ai.transcribe_calls[0]).exists()
    assert client.delete(f"/meetings/{mid}", headers=auth).status_code == 204
    assert not Path(fake_ai.transcribe_calls[0]).exists()
