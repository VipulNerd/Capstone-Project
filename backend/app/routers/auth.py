"""Sign in with email + password, sign out, and "forgot password" by emailed 6-digit code."""
import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User
from app.routers.users import user_created
from app.schemas import ForgotPasswordRequest, LoginRequest, Message, ResetPasswordRequest, UserCreated
from app.security import (
    RESET_CODE_TTL,
    RESET_MAX_ATTEMPTS,
    RESET_RESEND_AFTER,
    CurrentToken,
    aware,
    hash_password,
    hash_reset_code,
    hmac_equal,
    issue_token,
    new_reset_code,
    revoke_all_tokens,
    verify_password,
)
from app.services.emailer import Mailer, get_mailer

log = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])
DB = Annotated[Session, Depends(get_db)]

BAD_LOGIN = "Email or password is incorrect"
FORGOT_SENT = "If an account exists for that email, a 6-digit code is on its way. It is valid for 15 minutes."
BAD_CODE = "That code is wrong or has expired. Request a new one."


def _user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email.strip().lower()))


@router.post("/login", response_model=UserCreated)
def login(body: LoginRequest, db: DB):
    """Returns a new session token. Other browsers stay signed in."""
    user = _user_by_email(db, body.email)
    if user is None or not verify_password(body.password, user.password_hash):
        detail = BAD_LOGIN
        if user is not None and not user.has_password:
            detail += ". This account has no password yet: use \"Forgot password?\" to set one."
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail)
    token = issue_token(db, user)
    db.commit()
    return user_created(user, token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(tok: CurrentToken, db: DB):
    """Ends this browser's session only."""
    db.delete(tok)
    db.commit()


def _send_reset_email(mailer: Mailer, to: str, name: str, code: str) -> None:
    body = (
        f"Hello {name},\n\n"
        f"Your MinutesAI password reset code is: {code}\n\n"
        f"It is valid for {int(RESET_CODE_TTL.total_seconds() // 60)} minutes. "
        "If you didn't ask to reset your password, ignore this email; your password is unchanged.\n\n"
        "MinutesAI"
    )
    try:
        mailer.send(to, f"MinutesAI password reset code: {code}", body)
    except Exception:  # noqa: BLE001 - the response must not reveal whether the account exists
        log.exception("Could not send the password reset email to user %s", to)


@router.post("/forgot-password", response_model=Message)
def forgot_password(body: ForgotPasswordRequest, db: DB, background: BackgroundTasks,
                    mailer: Annotated[Mailer, Depends(get_mailer)]):
    """Emails a 6-digit code. Always answers the same way, so it never reveals which emails have accounts."""
    user = _user_by_email(db, body.email)
    now = datetime.now(timezone.utc)
    if user is not None:
        sent = aware(user.reset_sent_at)
        if sent is None or now - sent >= RESET_RESEND_AFTER:
            code = new_reset_code()
            user.reset_code_hash = hash_reset_code(user.id, code)
            user.reset_expires_at = now + RESET_CODE_TTL
            user.reset_sent_at = now
            user.reset_attempts = 0
            db.commit()
            background.add_task(_send_reset_email, mailer, user.email, user.name, code)
    return Message(message=FORGOT_SENT)


@router.post("/reset-password", response_model=UserCreated)
def reset_password(body: ResetPasswordRequest, db: DB):
    """Sets a new password with the emailed code, signs out every other session and signs in here."""
    user = _user_by_email(db, body.email)
    now = datetime.now(timezone.utc)
    if user is None or not user.reset_code_hash:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_CODE)
    expires = aware(user.reset_expires_at)
    if user.reset_attempts >= RESET_MAX_ATTEMPTS or expires is None or expires < now:
        user.reset_code_hash = None
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_CODE)
    if not hmac_equal(hash_reset_code(user.id, body.code.strip()), user.reset_code_hash):
        user.reset_attempts += 1
        if user.reset_attempts >= RESET_MAX_ATTEMPTS:
            user.reset_code_hash = None
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_CODE)

    user.password_hash = hash_password(body.new_password)
    user.reset_code_hash = user.reset_expires_at = None
    user.reset_attempts = 0
    revoke_all_tokens(db, user)
    token = issue_token(db, user)
    db.commit()
    return user_created(user, token)
