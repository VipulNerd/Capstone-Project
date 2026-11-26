"""SMTP mailer behaviour (no network: smtplib is replaced by a fake)."""
import smtplib

import pytest

from app.config import Settings
from app.services import emailer
from app.services.emailer import Attachment, EmailError, SmtpMailer, sender_address, smtp_config_problem
from tests.test_review import draft

ATT = Attachment("MOM.pdf", b"%PDF-1.4", "application/pdf")


class FakeSMTP:
    instances: list["FakeSMTP"] = []
    login_error: Exception | None = None

    def __init__(self, host, port, timeout=None):
        self.host, self.port, self.calls, self.msg = host, port, [], None
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self):
        self.calls.append("starttls")

    def login(self, user, password):
        self.calls.append(("login", user, password))
        if FakeSMTP.login_error:
            raise FakeSMTP.login_error

    def send_message(self, msg):
        self.msg = msg


class FakeSMTPSSL(FakeSMTP):
    pass


@pytest.fixture
def smtp(monkeypatch):
    FakeSMTP.instances, FakeSMTP.login_error = [], None
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSMTPSSL)

    def use(**overrides):
        values = {"email_backend": "smtp", "smtp_host": "smtp.gmail.com", "smtp_username": "me@gmail.com",
                  "smtp_password": "abcdabcdabcdabcd", "email_from": ""} | overrides
        s = Settings(**values)
        monkeypatch.setattr(emailer, "get_settings", lambda: s)
        return s

    return use


def test_gmail_587_starttls_and_from_falls_back_to_username(smtp):
    smtp()
    SmtpMailer().send("bob@example.com", "Subj", "Body", ATT)
    conn = FakeSMTP.instances[0]
    assert type(conn) is FakeSMTP and (conn.host, conn.port) == ("smtp.gmail.com", 587)
    assert conn.calls == ["starttls", ("login", "me@gmail.com", "abcdabcdabcdabcd")]
    assert conn.msg["From"] == "me@gmail.com" and conn.msg["To"] == "bob@example.com"


def test_port_465_uses_implicit_tls(smtp):
    smtp(smtp_port=465)
    SmtpMailer().send("bob@example.com", "Subj", "Body", ATT)
    conn = FakeSMTP.instances[0]
    assert type(conn) is FakeSMTPSSL and "starttls" not in conn.calls


def test_wrong_password_gives_app_password_hint(smtp):
    smtp()
    FakeSMTP.login_error = smtplib.SMTPAuthenticationError(535, b"Username and Password not accepted")
    with pytest.raises(EmailError, match="app password"):
        SmtpMailer().send("bob@example.com", "Subj", "Body", ATT)


def test_missing_credentials_fail_clearly(smtp):
    smtp(smtp_password="")
    with pytest.raises(EmailError, match="SMTP_PASSWORD"):
        SmtpMailer().send("bob@example.com", "Subj", "Body", ATT)
    assert FakeSMTP.instances == []  # never connected


def test_config_helpers():
    assert sender_address(Settings(email_from=" boss@x.com ", smtp_username="me@gmail.com")) == "boss@x.com"
    assert sender_address(Settings(email_from="", smtp_username="me@gmail.com")) == "me@gmail.com"
    assert smtp_config_problem(Settings(smtp_username="u", smtp_password="p")) is None
    assert "SMTP_USERNAME" in smtp_config_problem(Settings(smtp_username="", smtp_password="p"))


def test_console_mode_is_reported_as_not_emailed(client, auth):
    """With the console mailer nothing is emailed: no 'sent' rows, meeting stays approved."""
    from app.main import app
    from app.services.emailer import ConsoleMailer, get_mailer

    app.dependency_overrides[get_mailer] = ConsoleMailer
    mid = draft(client, auth)
    client.post(f"/meetings/{mid}/approve", json={"approved_by": "Vipul"}, headers=auth)
    body = client.post(f"/meetings/{mid}/distribute", headers=auth).json()
    assert body["email_mode"] == "console" and (body["sent"], body["failed"]) == (0, 0)
    assert {d["status"] for d in body["deliveries"]} == {"not_emailed"}
    assert "Not emailed" in body["deliveries"][0]["error"]
    assert client.get(f"/meetings/{mid}", headers=auth).json()["status"] == "approved"


def test_real_mailer_reports_smtp_mode(client, auth):
    mid = draft(client, auth)
    client.post(f"/meetings/{mid}/approve", json={"approved_by": "Vipul"}, headers=auth)
    assert client.post(f"/meetings/{mid}/distribute", headers=auth).json()["email_mode"] == "smtp"


def test_health_reports_email_mode(client):
    assert client.get("/health").json()["email"] == "console"


def test_email_error_message_is_stored_verbatim(client, auth, fake_mailer):
    mid = draft(client, auth)
    client.post(f"/meetings/{mid}/approve", json={"approved_by": "Vipul"}, headers=auth)

    def boom(*_a):
        raise EmailError("The mail server rejected the login.")

    fake_mailer.send = boom
    body = client.post(f"/meetings/{mid}/distribute", headers=auth).json()
    assert body["sent"] == 0 and body["deliveries"][0]["error"] == "The mail server rejected the login."
