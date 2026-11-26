"""Email + password sign-in, sessions, and "forgot password" by emailed code."""
import re
from datetime import datetime, timedelta, timezone

from app.models import User
from app.security import hash_password, verify_password
from tests.conftest import PASSWORD, register

EMAIL = "vipul@example.com"


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def login(client, email=EMAIL, password=PASSWORD):
    return client.post("/auth/login", json={"email": email, "password": password})


def last_code(fake_mailer) -> str:
    to, subject, body = fake_mailer.messages[-1]
    return re.search(r"\b(\d{6})\b", body).group(1)


def test_password_hashing():
    h = hash_password("s3cret pass")
    assert h.startswith("scrypt$") and "s3cret" not in h
    assert verify_password("s3cret pass", h) and not verify_password("wrong", h)
    assert not verify_password("x", None) and not verify_password("x", "garbage")
    assert hash_password("same") != hash_password("same")  # salted


def test_signup_validates_password(client):
    r = client.post("/users", json={"name": "A", "email": "a@example.com", "password": "short"})
    assert r.status_code == 422
    r = client.post("/users", json={"name": "A", "email": "a@example.com"})
    assert r.status_code == 422


def test_login_logout_and_multiple_sessions(client):
    first = register(client)
    assert client.get("/users/me", headers=first).json()["has_password"] is True

    assert login(client, password="wrong password").status_code == 401
    assert login(client, email="nobody@example.com").status_code == 401
    assert login(client, password="wrong password").json()["detail"] == login(client, email="x@y.com").json()["detail"]

    r = login(client, email="VIPUL@Example.com")  # case-insensitive
    assert r.status_code == 200 and r.json()["email"] == EMAIL
    second = bearer(r.json()["api_token"])
    assert client.get("/users/me", headers=first).status_code == 200  # both browsers signed in
    assert client.get("/users/me", headers=second).status_code == 200

    assert client.post("/auth/logout", headers=second).status_code == 204
    assert client.get("/users/me", headers=second).status_code == 401  # only that session ended
    assert client.get("/users/me", headers=first).status_code == 200


def test_forgot_and_reset_password(client, fake_mailer):
    old = register(client)
    r = client.post("/auth/forgot-password", json={"email": EMAIL})
    assert r.status_code == 200
    to, subject, body = fake_mailer.messages[-1]
    assert to == EMAIL and "reset code" in subject.lower()
    code = last_code(fake_mailer)

    r = client.post("/auth/reset-password", json={"email": EMAIL, "code": code, "new_password": "brand new pass"})
    assert r.status_code == 200, r.text
    assert client.get("/users/me", headers=bearer(r.json()["api_token"])).status_code == 200  # signed in
    assert client.get("/users/me", headers=old).status_code == 401  # every old session ended
    assert login(client).status_code == 401
    assert login(client, password="brand new pass").status_code == 200
    # The code is single-use.
    again = client.post("/auth/reset-password", json={"email": EMAIL, "code": code, "new_password": "third pass!"})
    assert again.status_code == 400


def test_forgot_password_does_not_reveal_accounts(client, fake_mailer):
    register(client)
    known = client.post("/auth/forgot-password", json={"email": EMAIL}).json()
    unknown = client.post("/auth/forgot-password", json={"email": "nobody@example.com"}).json()
    assert known == unknown
    assert [m[0] for m in fake_mailer.messages] == [EMAIL]


def test_resend_is_throttled(client, fake_mailer):
    register(client)
    client.post("/auth/forgot-password", json={"email": EMAIL})
    client.post("/auth/forgot-password", json={"email": EMAIL})
    assert len(fake_mailer.messages) == 1


def test_wrong_codes_lock_the_code(client, fake_mailer):
    register(client)
    client.post("/auth/forgot-password", json={"email": EMAIL})
    code = last_code(fake_mailer)
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        r = client.post("/auth/reset-password", json={"email": EMAIL, "code": wrong, "new_password": "brand new pass"})
        assert r.status_code == 400
    r = client.post("/auth/reset-password", json={"email": EMAIL, "code": code, "new_password": "brand new pass"})
    assert r.status_code == 400  # locked after 5 wrong tries, even with the right code


def test_expired_code_is_rejected(client, fake_mailer, session_factory):
    register(client)
    client.post("/auth/forgot-password", json={"email": EMAIL})
    code = last_code(fake_mailer)
    with session_factory() as db:
        user = db.query(User).filter_by(email=EMAIL).one()
        user.reset_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
    r = client.post("/auth/reset-password", json={"email": EMAIL, "code": code, "new_password": "brand new pass"})
    assert r.status_code == 400


def test_legacy_account_without_password_can_set_one(client, fake_mailer, session_factory):
    register(client)
    with session_factory() as db:
        db.query(User).filter_by(email=EMAIL).one().password_hash = None
        db.commit()
    r = login(client)
    assert r.status_code == 401 and "Forgot password" in r.json()["detail"]
    client.post("/auth/forgot-password", json={"email": EMAIL})
    r = client.post("/auth/reset-password",
                    json={"email": EMAIL, "code": last_code(fake_mailer), "new_password": "first password"})
    assert r.status_code == 200 and r.json()["has_password"] is True


def test_change_password(client):
    here = register(client)
    other = bearer(login(client).json()["api_token"])
    bad = client.put("/users/me/password", headers=here, json={"current_password": "nope", "new_password": "new password 1"})
    assert bad.status_code == 400
    ok = client.put("/users/me/password", headers=here,
                    json={"current_password": PASSWORD, "new_password": "new password 1"})
    assert ok.status_code == 200
    assert client.get("/users/me", headers=here).status_code == 200    # this browser stays signed in
    assert client.get("/users/me", headers=other).status_code == 401   # others are signed out
    assert login(client, password="new password 1").status_code == 200


def test_rotate_token_signs_out_everywhere(client):
    first = register(client)
    second = bearer(login(client).json()["api_token"])
    new = client.post("/users/me/rotate-token", headers=first).json()["api_token"]
    assert client.get("/users/me", headers=first).status_code == 401
    assert client.get("/users/me", headers=second).status_code == 401
    assert client.get("/users/me", headers=bearer(new)).status_code == 200
