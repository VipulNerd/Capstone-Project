"""Review -> approve -> export -> distribute (unchanged MOM workflow on top of the recording flow)."""
from tests.conftest import register, segs
from tests.test_recording import PARTICIPANTS, chunk, finish, start


def draft(client, auth, title="Weekly sync", participants=PARTICIPANTS):
    mid = start(client, auth, title=title, participants=participants).json()["id"]
    chunk(client, auth, mid, "mic", 0, 0, segs((0, "A", "let's ship friday")))
    m = finish(client, auth, mid)
    assert m["status"] == "draft", m["error_message"]
    return mid


def test_users_register_and_tokens(client):
    h = register(client)
    assert client.post("/users", json={"name": "X", "email": "VIPUL@example.com", "password": "another pass"}).status_code == 409
    assert client.get("/users/me", headers=h).json()["email"] == "vipul@example.com"
    assert client.get("/users/me").status_code == 401
    assert client.get("/users/me", headers={"Authorization": "Bearer nope"}).status_code == 401
    new = client.post("/users/me/rotate-token", headers=h).json()["api_token"]
    assert client.get("/users/me", headers=h).status_code == 401  # old token revoked
    assert client.get("/users/me", headers={"Authorization": f"Bearer {new}"}).status_code == 200


def test_edit_approve_lock_and_reopen(client, auth):
    mid = draft(client, auth)
    r = client.put(f"/meetings/{mid}/mom", headers=auth, json={
        "summary": "Edited summary",
        "action_items": [{"task": "Deploy", "owner": "Carol", "deadline": None}],
    })
    assert r.status_code == 200 and r.json()["summary"] == "Edited summary"
    assert r.json()["decisions"] == ["Ship v1 on Friday"]  # untouched
    assert client.post(f"/meetings/{mid}/approve", json={"approved_by": "Vipul"}, headers=auth).json()["status"] == "approved"
    assert client.put(f"/meetings/{mid}/mom", json={"summary": "x"}, headers=auth).status_code == 409
    assert client.post(f"/meetings/{mid}/reopen", headers=auth).json()["status"] == "draft"


def test_participant_edit_keeps_calendar_provenance(client, auth):
    ics = (b"BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Plan\r\nDTSTART:20261120T100000Z\r\n"
           b"ORGANIZER;CN=Bob:mailto:bob@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
    mid = client.post("/meetings/from-ics", headers=auth, data={"recording_consent": "true"},
                      files={"invite": ("i.ics", ics)}).json()["id"]
    chunk(client, auth, mid, "mic", 0, 0, segs((0, "A", "hi")))
    finish(client, auth, mid)
    r = client.put(f"/meetings/{mid}/mom", headers=auth, json={"participants": [
        {"name": "Bob", "email": "bob@example.com"}, {"name": "New", "email": "new@example.com"}]}).json()
    assert {p["email"]: p["source"] for p in r["participants"]} == {"bob@example.com": "calendar", "new@example.com": "manual"}


def test_distribute_requires_approval_and_tracks_delivery(client, auth, fake_mailer):
    mid = draft(client, auth)
    assert client.post(f"/meetings/{mid}/distribute", headers=auth).status_code == 409
    client.post(f"/meetings/{mid}/approve", json={"approved_by": "Vipul"}, headers=auth)
    fake_mailer.fail_for = {"carol@example.com"}
    body = client.post(f"/meetings/{mid}/distribute", json={"format": "docx"}, headers=auth).json()
    assert (body["sent"], body["failed"]) == (2, 1)  # bob + vipul ok, carol failed
    assert {to for to, *_ in fake_mailer.sent} == {"bob@example.com", "vipul@example.com"}
    assert fake_mailer.sent[0][2].endswith(".docx")
    assert client.get(f"/meetings/{mid}", headers=auth).json()["status"] == "distributed"
    assert client.post(f"/meetings/{mid}/reopen", headers=auth).status_code == 409
    failed = [d for d in client.get(f"/meetings/{mid}/deliveries", headers=auth).json() if d["status"] == "failed"]
    assert failed[0]["recipient_email"] == "carol@example.com" and "SMTP down" in failed[0]["error"]


def test_export_non_ascii_title(client, auth):
    mid = draft(client, auth, title="साप्ताहिक बैठक Q4")
    for path in (f"/meetings/{mid}/export?format=pdf", f"/meetings/{mid}/transcript?format=docx"):
        r = client.get(path, headers=auth)
        assert r.status_code == 200 and "filename*=UTF-8''" in r.headers["content-disposition"]


def test_newline_in_title_does_not_break_email(client, auth, fake_mailer):
    mid = draft(client, auth, title="Sync\r\nBcc: evil@example.com")
    client.post(f"/meetings/{mid}/approve", json={"approved_by": "V"}, headers=auth)
    from app.services.emailer import _build_message
    built = []
    fake_mailer.send = lambda to, subject, body, att: built.append(_build_message("f@example.com", to, subject, body, att))
    r = client.post(f"/meetings/{mid}/distribute", headers=auth).json()
    assert r["failed"] == 0 and built[0]["Subject"].startswith("Minutes of Meeting: Sync Bcc: evil@example.com")
    assert built[0]["Bcc"] is None


def test_state_guards_and_listing(client, auth):
    mid = start(client, auth).json()["id"]
    assert client.post(f"/meetings/{mid}/approve", json={"approved_by": "A"}, headers=auth).status_code == 409
    assert client.get(f"/meetings/{mid}/export", headers=auth).status_code == 409
    assert client.post(f"/meetings/{mid}/retry", headers=auth).status_code == 409
    assert client.get("/meetings/9999", headers=auth).status_code == 404
    draft(client, auth)
    assert len(client.get("/meetings", headers=auth).json()) == 2
    assert len(client.get("/meetings?status=recording", headers=auth).json()) == 1
