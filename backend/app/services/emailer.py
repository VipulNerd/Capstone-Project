"""Email delivery. "console" backend writes .eml files to disk (no credentials
needed for local dev); "smtp" sends for real. A Microsoft Graph backend can be
added later implementing the same Mailer protocol."""
import smtplib
import uuid
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

from app.config import get_settings


@dataclass
class Attachment:
    filename: str
    content: bytes
    media_type: str


class Mailer(Protocol):
    def send(self, to: str, subject: str, body: str, attachment: Attachment) -> None:
        """Raise on failure."""


def _build_message(sender: str, to: str, subject: str, body: str, att: Attachment) -> EmailMessage:
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, to, subject
    msg.set_content(body)
    maintype, subtype = att.media_type.split("/", 1)
    msg.add_attachment(att.content, maintype=maintype, subtype=subtype, filename=att.filename)
    return msg


class ConsoleMailer:
    def send(self, to: str, subject: str, body: str, attachment: Attachment) -> None:
        s = get_settings()
        s.email_outbox_dir.mkdir(parents=True, exist_ok=True)
        msg = _build_message(s.email_from, to, subject, body, attachment)
        (s.email_outbox_dir / f"{uuid.uuid4().hex}.eml").write_bytes(bytes(msg))


class SmtpMailer:
    def send(self, to: str, subject: str, body: str, attachment: Attachment) -> None:
        s = get_settings()
        msg = _build_message(s.email_from, to, subject, body, attachment)
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=30) as smtp:
            if s.smtp_use_tls:
                smtp.starttls()
            if s.smtp_username:
                smtp.login(s.smtp_username, s.smtp_password or "")
            smtp.send_message(msg)


def get_mailer() -> Mailer:
    return SmtpMailer() if get_settings().email_backend == "smtp" else ConsoleMailer()
