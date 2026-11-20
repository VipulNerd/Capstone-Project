import json

TRANSCRIPT = b"Alice: We will ship v1 on Friday.\nBob: I'll write the release notes."


def upload(client, filename="standup.txt", content=TRANSCRIPT, participants=None):
    data = {
        "title": "Weekly sync",
        "organizer_name": "Alice",
        "organizer_email": "alice@example.com",
        "meeting_date": "2026-11-20",
    }
    if participants is not None:
        data["participants"] = json.dumps(participants)
    return client.post("/meetings", data=data, files={"file": (filename, content)})


def make_draft(client, **kw):
    mid = upload(client, **kw).json()["id"]
    r = client.post(f"/meetings/{mid}/process")
    assert r.status_code == 202
    m = client.get(f"/meetings/{mid}").json()
    assert m["status"] == "draft", m
    return m


def test_upload_transcript(client):
    r = upload(client, participants=[{"name": "Bob", "email": "bob@example.com"}])
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "uploaded"
    assert body["source_type"] == "transcript"
    assert "ship v1" in body["transcript"]
    assert body["participants"][0]["email"] == "bob@example.com"


def test_upload_rejects_bad_type_and_bad_email(client):
    assert upload(client, filename="x.exe").status_code == 415
    r = client.post(
        "/meetings",
        data={"title": "t", "organizer_name": "a", "organizer_email": "not-an-email"},
        files={"file": ("a.txt", b"hi")},
    )
    assert r.status_code == 422


def test_vtt_is_cleaned(client):
    vtt = b"WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nAlice: hello\n\n2\n00:00:04.000 --> 00:00:05.000\nBob: hi\n"
    body = upload(client, filename="call.vtt", content=vtt).json()
    assert body["transcript"] == "Alice: hello\nBob: hi"


def test_process_generates_draft_and_merges_participants(client):
    m = make_draft(client, participants=[{"name": "Bob", "email": "bob@example.com"}])
    assert m["summary"] == "Team agreed to ship v1."
    assert m["decisions"] == ["Ship v1 on Friday"]
    assert m["action_items"][0] == {**m["action_items"][0], "owner": "Bob", "deadline": "2026-11-27"}
    names = {p["name"]: p["email"] for p in m["participants"]}
    assert names == {"Bob": "bob@example.com", "Alice": None}


def test_audio_is_transcribed(client, fake_ai):
    mid = upload(client, filename="rec.mp3", content=b"\x00fake-audio").json()["id"]
    client.post(f"/meetings/{mid}/process")
    m = client.get(f"/meetings/{mid}").json()
    assert len(fake_ai.transcribed) == 1
    assert m["transcript"].startswith("Alice:")
    assert m["status"] == "draft"


def test_processing_failure_is_recorded(client, fake_ai):
    fake_ai.fail = True
    mid = upload(client).json()["id"]
    client.post(f"/meetings/{mid}/process")
    m = client.get(f"/meetings/{mid}").json()
    assert m["status"] == "failed"
    assert "LLM exploded" in m["error_message"]


def test_edit_approve_lock_and_reopen(client):
    mid = make_draft(client)["id"]
    r = client.put(f"/meetings/{mid}/mom", json={
        "summary": "Edited summary",
        "action_items": [{"task": "Deploy", "owner": "Carol", "deadline": None}],
        "participants": [{"name": "Carol", "email": "carol@example.com"}],
    })
    assert r.status_code == 200
    assert r.json()["summary"] == "Edited summary"
    assert [a["owner"] for a in r.json()["action_items"]] == ["Carol"]
    assert r.json()["decisions"] == ["Ship v1 on Friday"]  # untouched

    assert client.post(f"/meetings/{mid}/approve", json={"approved_by": "Alice"}).json()["status"] == "approved"
    assert client.put(f"/meetings/{mid}/mom", json={"summary": "x"}).status_code == 409

    assert client.post(f"/meetings/{mid}/reopen").json()["status"] == "draft"
    assert client.put(f"/meetings/{mid}/mom", json={"summary": "x"}).status_code == 200


def test_distribute_requires_approval(client, fake_mailer):
    mid = make_draft(client)["id"]
    assert client.post(f"/meetings/{mid}/distribute").status_code == 409
    assert fake_mailer.sent == []


def test_distribute_sends_and_tracks(client, fake_mailer):
    mid = make_draft(client, participants=[
        {"name": "Bob", "email": "bob@example.com"},
        {"name": "Dan", "email": "dan@example.com"},
    ])["id"]
    client.post(f"/meetings/{mid}/approve", json={"approved_by": "Alice"})
    fake_mailer.fail_for = {"dan@example.com"}

    r = client.post(f"/meetings/{mid}/distribute", json={"format": "docx"})
    assert r.status_code == 200
    body = r.json()
    assert (body["sent"], body["failed"]) == (2, 1)  # bob + organiser ok, dan failed
    assert {to for to, *_ in fake_mailer.sent} == {"bob@example.com", "alice@example.com"}
    assert fake_mailer.sent[0][2].endswith(".docx")

    assert client.get(f"/meetings/{mid}").json()["status"] == "distributed"
    deliveries = client.get(f"/meetings/{mid}/deliveries").json()
    failed = [d for d in deliveries if d["status"] == "failed"]
    assert failed[0]["recipient_email"] == "dan@example.com" and "SMTP down" in failed[0]["error"]


def test_export_pdf_and_docx(client):
    mid = make_draft(client)["id"]
    pdf = client.get(f"/meetings/{mid}/export?format=pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    docx = client.get(f"/meetings/{mid}/export?format=docx")
    assert docx.status_code == 200 and docx.content.startswith(b"PK")


def test_list_filter_and_delete(client):
    make_draft(client)
    upload(client)
    assert len(client.get("/meetings").json()) == 2
    drafts = client.get("/meetings?status=draft").json()
    assert len(drafts) == 1
    assert client.delete(f"/meetings/{drafts[0]['id']}").status_code == 204
    assert client.get(f"/meetings/{drafts[0]['id']}").status_code == 404


# --- Edge cases found during review ---------------------------------------------------------

def _upload_titled(client, title, content=b"Alice: hi", filename="t.txt"):
    return client.post(
        "/meetings",
        data={"title": title, "organizer_name": "Alice", "organizer_email": "alice@example.com"},
        files={"file": (filename, content)},
    )


def test_export_non_ascii_title(client):
    mid = _upload_titled(client, "साप्ताहिक बैठक Q4").json()["id"]
    client.post(f"/meetings/{mid}/process")
    r = client.get(f"/meetings/{mid}/export?format=docx")
    assert r.status_code == 200
    cd = r.headers["content-disposition"]
    assert 'filename="MOM_Q4.docx"' in cd and "filename*=UTF-8''" in cd


def test_newline_in_title_does_not_break_email(client, fake_mailer):
    mid = _upload_titled(client, "Sync\r\nBcc: evil@example.com").json()["id"]
    client.post(f"/meetings/{mid}/process")
    client.post(f"/meetings/{mid}/approve", json={"approved_by": "Alice"})
    # Use the real message builder so header validation is exercised
    from app.services.emailer import _build_message
    built = []
    fake_mailer.send = lambda to, subject, body, att: built.append(_build_message("f@example.com", to, subject, body, att))
    r = client.post(f"/meetings/{mid}/distribute").json()
    assert r["sent"] == 1 and r["failed"] == 0
    assert built[0]["Subject"] == "Minutes of Meeting: Sync Bcc: evil@example.com"
    assert built[0]["Bcc"] is None


def test_transcript_encodings(client):
    bom = _upload_titled(client, "t", "\ufeffAlice: héllo".encode("utf-8")).json()
    assert bom["transcript"] == "Alice: héllo"
    win = _upload_titled(client, "t", "Café – notes".encode("cp1252")).json()
    assert win["transcript"] == "Café – notes"


def test_reprocess_draft_does_not_duplicate_participants(client):
    mid = make_draft(client)["id"]
    client.post(f"/meetings/{mid}/process")
    names = [p["name"] for p in client.get(f"/meetings/{mid}").json()["participants"]]
    assert sorted(names) == ["Alice", "Bob"]


def test_bad_participants_json_and_empty_file(client):
    r = client.post(
        "/meetings",
        data={"title": "t", "organizer_name": "A", "organizer_email": "a@example.com", "participants": "not json"},
        files={"file": ("t.txt", b"x")},
    )
    assert r.status_code == 422
    assert _upload_titled(client, "t", b"").status_code == 422


def test_state_guards(client):
    mid = upload(client).json()["id"]
    assert client.post(f"/meetings/{mid}/approve", json={"approved_by": "A"}).status_code == 409  # not processed
    assert client.get(f"/meetings/{mid}/export").status_code == 409
    assert client.get("/meetings/9999").status_code == 404
    client.post(f"/meetings/{mid}/process")
    client.post(f"/meetings/{mid}/approve", json={"approved_by": "A"})
    client.post(f"/meetings/{mid}/distribute")
    assert client.post(f"/meetings/{mid}/reopen").status_code == 409  # already sent
    assert client.post(f"/meetings/{mid}/distribute").status_code == 200  # resend allowed
    assert len(client.get(f"/meetings/{mid}/deliveries").json()) == 2


def test_upload_too_large(client, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "max_upload_mb", 0)
    assert upload(client).status_code == 413
