from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.roles import role_label_ru
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_refresh_token,
    refresh_token_expires_at,
    verify_password,
)
from app.db.session import get_db
from app.models.refresh_token import RefreshToken
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])

from app.core.clock import utc_now as _utc_now


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _issue_tokens(db: Session, user: User, old_refresh: RefreshToken | None = None) -> dict:
    raw_refresh = create_refresh_token()
    stored = RefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(raw_refresh),
        expires_at=refresh_token_expires_at(),
        created_at=_utc_now(),
    )
    db.add(stored)
    db.flush()

    if old_refresh is not None:
        old_refresh.revoked_at = _utc_now()
        old_refresh.replaced_by_token_id = stored.id
        db.add(old_refresh)

    access = create_access_token(user.username, user.role)
    return {
        "access_token": access,
        "refresh_token": raw_refresh,
        "token_type": "bearer",
    }


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthTokensOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class LogoutOut(BaseModel):
    status: str = "ok"
    model_config = ConfigDict(from_attributes=True)


@router.post("/login", response_model=AuthTokensOut)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    payload = _issue_tokens(db, user)
    db.commit()
    return payload


@router.post("/refresh", response_model=AuthTokensOut)
def refresh_tokens(data: RefreshRequest, db: Session = Depends(get_db)):
    token_hash = hash_refresh_token(data.refresh_token)
    token = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()
    if not token:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    now = _utc_now()
    expires_at = _as_utc(token.expires_at)
    if token.revoked_at is not None or expires_at <= now:
        raise HTTPException(status_code=401, detail="Refresh token expired or revoked")

    user = db.query(User).filter(User.id == token.user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    payload = _issue_tokens(db, user, old_refresh=token)
    db.commit()
    return payload


@router.post("/logout", response_model=LogoutOut)
def logout(data: LogoutRequest, db: Session = Depends(get_db)):
    token_hash = hash_refresh_token(data.refresh_token)
    token = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()
    if token and token.revoked_at is None:
        token.revoked_at = _utc_now()
        db.add(token)
        db.commit()
    return {"status": "ok"}


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    department = getattr(current_user, "department", None)
    return {
        "username": current_user.username,
        "full_name": getattr(current_user, "full_name", None),
        "role": current_user.role,
        "role_label": role_label_ru(current_user.role),
        "department": department.value if hasattr(department, "value") else department,
        "warehouse_id": getattr(current_user, "warehouse_id", None)
        or getattr(current_user, "default_warehouse_id", None),
        "default_station_id": getattr(current_user, "default_station_id", None),
        "default_warehouse_id": getattr(current_user, "default_warehouse_id", None),
        "preferred_language": getattr(current_user, "preferred_language", None),
    }
