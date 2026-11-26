from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User
from app.schemas import PasswordChange, UserCreate, UserCreated, UserOut
from app.security import CurrentToken, CurrentUser, hash_password, issue_token, revoke_all_tokens, verify_password

router = APIRouter(prefix="/users", tags=["users"])


def user_created(user: User, token: str) -> UserCreated:
    return UserCreated(id=user.id, name=user.name, email=user.email, has_password=user.has_password, api_token=token)


@router.post("", response_model=UserCreated, status_code=status.HTTP_201_CREATED)
def register(body: UserCreate, db: Annotated[Session, Depends(get_db)]):
    """Create an account and sign in (returns a session token)."""
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(name=body.name.strip(), email=email, password_hash=hash_password(body.password))
    db.add(user)
    db.flush()
    token = issue_token(db, user)
    db.commit()
    return user_created(user, token)


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser):
    return user


@router.put("/me/password", response_model=UserOut)
def change_password(body: PasswordChange, tok: CurrentToken, db: Annotated[Session, Depends(get_db)]):
    """Change (or, for accounts created before passwords, set) the password.
    Other browsers are signed out; this one stays signed in."""
    user = tok.user
    if user.has_password and not verify_password(body.current_password or "", user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    for other in [t for t in user.tokens if t.id != tok.id]:
        db.delete(other)
    db.commit()
    return user


@router.post("/me/rotate-token", response_model=UserCreated)
def rotate_token(user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    """New API token; every existing token (all browsers, scripts) stops working."""
    revoke_all_tokens(db, user)
    token = issue_token(db, user)
    db.commit()
    return user_created(user, token)
