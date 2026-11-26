"""Passwords, API tokens (one per signed-in browser), password-reset codes, signed OAuth
state, and encryption of stored calendar tokens."""
import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated

from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import ApiToken, User

# --- Passwords (stdlib scrypt) ---------------------------------------------------------------

_SCRYPT = {"n": 2**14, "r": 8, "p": 1}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=32, **_SCRYPT)
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        if algo != "scrypt":
            return False
        expected = _unb64(digest)
        actual = hashlib.scrypt(password.encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p),
                                dklen=len(expected))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


# --- API tokens (sessions) -------------------------------------------------------------------


def aware(dt: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; treat them as UTC."""
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


def new_api_token() -> tuple[str, str]:
    """Returns (token given to the client, sha256 hash stored in the DB)."""
    token = "mom_" + secrets.token_urlsafe(32)
    return token, hash_token(token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token(db: Session, user: User) -> str:
    """Start a new session for the user (other browsers stay signed in). Caller commits."""
    token, token_hash = new_api_token()
    db.add(ApiToken(user_id=user.id, token_hash=token_hash))
    return token


def revoke_all_tokens(db: Session, user: User) -> None:
    db.execute(delete(ApiToken).where(ApiToken.user_id == user.id))


_bearer = HTTPBearer(auto_error=False)


def current_token(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> ApiToken:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token",
                            headers={"WWW-Authenticate": "Bearer"})
    tok = db.scalar(select(ApiToken).where(ApiToken.token_hash == hash_token(creds.credentials)))
    if tok is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token", headers={"WWW-Authenticate": "Bearer"})
    now = datetime.now(timezone.utc)
    last = aware(tok.last_used_at)
    if last is None or last < now - timedelta(minutes=1):
        tok.last_used_at = now
        db.commit()
    return tok


def get_current_user(tok: Annotated[ApiToken, Depends(current_token)]) -> User:
    return tok.user


CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentToken = Annotated[ApiToken, Depends(current_token)]

# --- Password-reset codes --------------------------------------------------------------------

RESET_CODE_TTL = timedelta(minutes=15)
RESET_RESEND_AFTER = timedelta(seconds=60)
RESET_MAX_ATTEMPTS = 5


def new_reset_code() -> str:
    return f"{secrets.randbelow(10**6):06d}"


def hmac_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def hash_reset_code(user_id: int, code: str) -> str:
    key = get_settings().secret_key.encode()
    return hmac.new(key, f"reset:{user_id}:{code}".encode(), hashlib.sha256).hexdigest()

# --- Signed, expiring OAuth state ------------------------------------------------------------


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign_state(payload: dict, ttl_seconds: int = 600) -> str:
    body = _b64(json.dumps({**payload, "exp": int(time.time()) + ttl_seconds, "n": secrets.token_hex(8)}).encode())
    sig = _b64(hmac.new(get_settings().secret_key.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def verify_state(state: str) -> dict:
    try:
        body, sig = state.split(".", 1)
        expected = _b64(hmac.new(get_settings().secret_key.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            raise ValueError("bad signature")
        payload = json.loads(_unb64(body))
        if payload["exp"] < time.time():
            raise ValueError("expired")
        return payload
    except (ValueError, KeyError, json.JSONDecodeError) as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid OAuth state: {e}") from e


# --- Token encryption at rest ----------------------------------------------------------------


def _fernet() -> Fernet:
    key = hashlib.sha256(("fernet:" + get_settings().secret_key).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt(value: str | None) -> str | None:
    return _fernet().encrypt(value.encode()).decode() if value else None


def decrypt(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        return None  # SECRET_KEY changed: treat as disconnected
