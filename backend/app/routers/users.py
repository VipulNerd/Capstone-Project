from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User
from app.schemas import UserCreate, UserCreated, UserOut
from app.security import CurrentUser, new_api_token

router = APIRouter(prefix="/users", tags=["users"])


@router.post("", response_model=UserCreated, status_code=status.HTTP_201_CREATED)
def register(body: UserCreate, db: Annotated[Session, Depends(get_db)]):
    """Register the overlay-agent user. The API token is returned only once."""
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    token, token_hash = new_api_token()
    user = User(name=body.name.strip(), email=email, token_hash=token_hash)
    db.add(user)
    db.commit()
    return UserCreated(id=user.id, name=user.name, email=user.email, api_token=token)


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser):
    return user


@router.post("/me/rotate-token", response_model=UserCreated)
def rotate_token(user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    token, token_hash = new_api_token()
    db_user = db.merge(user)
    db_user.token_hash = token_hash
    db.commit()
    return UserCreated(id=db_user.id, name=db_user.name, email=db_user.email, api_token=token)
