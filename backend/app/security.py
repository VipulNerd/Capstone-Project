"""API tokens, signed OAuth state, and encryption of stored calendar tokens."""
import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Annotated

from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User

# --- API tokens ------------------------------------------------------------------------------


def new_api_token() -> tuple[str, str]:
    """Returns (token shown once to the user, sha256 hash stored in the DB)."""
    token = "mom_" + secrets.token_urlsafe(32)
    return token, hash_token(token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token",
                            headers={"WWW-Authenticate": "Bearer"})
    user = db.scalar(select(User).where(User.token_hash == hash_token(creds.credentials)))
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token", headers={"WWW-Authenticate": "Bearer"})
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]

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
