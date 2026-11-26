"""Email delivery. "console" backend writes .eml files to disk (no credentials
needed for local dev; nothing is actually emailed); "smtp" sends for real
(e.g. Gmail with an app password). A Microsoft Graph backend can be added later
implementing the same Mailer protocol."""
import smtplib
import uuid
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

from app.config import Settings, get_settings


@dataclass
class Attachment:
    filename: str
    content: bytes
    media_type: str


class Mailer(Protocol):
    def send(self, to: str, subject: str, body: str, attachment: Attachment | None = None) -> None:
        """Raise on failure."""


class EmailError(Exception):
    """A send failure with a message meant for the delivery log."""


def sender_address(s: Settings) -> str:
    """EMAIL_FROM, or the SMTP login when it is empty (Gmail requires From to be the account)."""
    return (s.email_from or "").strip() or (s.smtp_username or "").strip() or "mom-bot@example.com"


def smtp_config_problem(s: Settings) -> str | None:
    """Why the SMTP settings cannot work, or None."""
    missing = [n for n, v in (("SMTP_HOST", s.smtp_host), ("SMTP_USERNAME", s.smtp_username),
                              ("SMTP_PASSWORD", s.smtp_password)) if not (v or "").strip()]
    return f"EMAIL_BACKEND=smtp but {', '.join(missing)} not set" if missing else None


def _build_message(sender: str, to: str, subject: str, body: str, att: Attachment | None) -> EmailMessage:
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, to, subject
    msg.set_content(body)
    if att is not None:
        maintype, subtype = att.media_type.split("/", 1)
        msg.add_attachment(att.content, maintype=maintype, subtype=subtype, filename=att.filename)
    return msg


def actually_emails(mailer: Mailer) -> bool:
    return not isinstance(mailer, ConsoleMailer)


class ConsoleMailer:
    def send(self, to: str, subject: str, body: str, attachment: Attachment | None = None) -> None:
        s = get_settings()
        s.email_outbox_dir.mkdir(parents=True, exist_ok=True)
        msg = _build_message(sender_address(s), to, subject, body, attachment)
        (s.email_outbox_dir / f"{uuid.uuid4().hex}.eml").write_bytes(bytes(msg))


class SmtpMailer:
    def send(self, to: str, subject: str, body: str, attachment: Attachment | None = None) -> None:
        s = get_settings()
        if problem := smtp_config_problem(s):
            raise EmailError(f"Email is not configured on the server: {problem}")
        msg = _build_message(sender_address(s), to, subject, body, attachment)
        try:
            if s.smtp_port == 465:  # implicit TLS
                smtp_cm = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=30)
            else:
                smtp_cm = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=30)
            with smtp_cm as smtp:
                if s.smtp_port != 465 and s.smtp_use_tls:
                    smtp.starttls()
                smtp.login(s.smtp_username, s.smtp_password)
                smtp.send_message(msg)
        except smtplib.SMTPAuthenticationError as e:
            raise EmailError(
                "The mail server rejected the login. For Gmail, SMTP_PASSWORD must be a 16-character "
                f"app password (not the normal password) and 2-Step Verification must be on. ({e.smtp_code})"
            ) from e
        except smtplib.SMTPRecipientsRefused as e:
            raise EmailError(f"The mail server refused the recipient address {to}") from e
        except (OSError, smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected) as e:
            raise EmailError(f"Could not connect to {s.smtp_host}:{s.smtp_port} ({type(e).__name__}: {e})") from e


def get_mailer() -> Mailer:
    return SmtpMailer() if get_settings().email_backend == "smtp" else ConsoleMailer()
