from datetime import datetime, timedelta, timezone
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, and_
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.roles import (
    CANONICAL_ROLES,
    can_manage_users,
    is_manager_role,
    resolve_registration_role,
    role_label_ru,
)
from app.core.security import hash_password, verify_password
from app.db.session import get_db
from app.models.station import Station
from app.models.user import User
from app.models.warehouse import Warehouse
from app.services.audit import log_audit

log = logging.getLogger("app")

router = APIRouter(prefix="/users", tags=["users"])


class ProfileOut(BaseModel):
    id: int | None = None
    username: str
    full_name: str | None = None
    role: str
    role_label: str
    is_active: bool
    department: str | None = None
    warehouse_id: int | None = None
    default_station_id: int | None = None
    default_warehouse_id: int | None = None
    preferred_language: str | None = None


class MyProfileUpdate(BaseModel):
    full_name: str | None = None
    preferred_language: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, max_length=128)


class UserAdminPatch(BaseModel):
    full_name: str | None = None
    role: str | None = None
    department: Literal["kitchen", "bar"] | None = None
    warehouse_id: int | None = None
    default_station_id: int | None = None
    default_warehouse_id: int | None = None
    is_active: bool | None = None


class AdminCreateUser(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str | None = None
    role: str = "cook"
    warehouse_id: int | None = None


class AdminResetPassword(BaseModel):
    password: str = Field(..., min_length=8, max_length=128)


class UserListItem(BaseModel):
    id: int
    username: str
    full_name: str | None = None
    role: str
    role_label: str
    is_active: bool
    department: str | None = None
    warehouse_id: int | None = None
    default_warehouse_id: int | None = None
    last_seen_at: str | None = None


def _profile_from_user(user: User) -> ProfileOut:
    department = getattr(user, "department", None)
    department_value = department.value if hasattr(department, "value") else department
    return ProfileOut(
        id=user.id,
        username=user.username,
        full_name=getattr(user, "full_name", None),
        role=user.role,
        role_label=role_label_ru(user.role),
        is_active=user.is_active,
        department=department_value,
        warehouse_id=getattr(user, "warehouse_id", None)
        or getattr(user, "default_warehouse_id", None),
        default_station_id=getattr(user, "default_station_id", None),
        default_warehouse_id=getattr(user, "default_warehouse_id", None),
        preferred_language=getattr(user, "preferred_language", None),
    )


def _require_user_manage_role(current_user: User) -> None:
    if not can_manage_users(current_user.role):
        raise HTTPException(status_code=403, detail="Only manager can manage users")


@router.get("/me", response_model=ProfileOut)
def me(current_user: User = Depends(get_current_user)):
    return _profile_from_user(current_user)


@router.patch("/me", response_model=ProfileOut)
def update_my_profile(
    payload: MyProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    updates = payload.model_dump(exclude_unset=True)
    if "full_name" in updates:
        current_user.full_name = updates["full_name"]
    if "preferred_language" in updates:
        lang = updates["preferred_language"]
        if lang is not None and lang not in ("ru", "kk"):
            raise HTTPException(status_code=422, detail="Invalid language")
        current_user.preferred_language = lang
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return _profile_from_user(current_user)


@router.post("/me/password", status_code=204)
def change_my_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Wrong current password")
    current_user.password_hash = hash_password(payload.new_password)
    db.add(current_user)
    db.commit()


@router.patch("/{user_id}", response_model=ProfileOut)
def patch_user(
    user_id: int,
    payload: UserAdminPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_user_manage_role(current_user)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    updates = payload.model_dump(exclude_unset=True)

    if "full_name" in updates:
        user.full_name = updates["full_name"]

    if "role" in updates:
        new_role = updates["role"]
        if new_role not in CANONICAL_ROLES and new_role != "admin":
            raise HTTPException(status_code=422, detail="Invalid role")
        # Prevent removing the last manager
        if can_manage_users(user.role) and not can_manage_users(new_role):
            manager_count = (
                db.query(func.count(User.id))
                .filter(User.role.in_(["manager", "admin"]), User.is_active.is_(True), User.deleted_at.is_(None))
                .scalar()
            )
            if manager_count <= 1:
                raise HTTPException(
                    status_code=409,
                    detail="Cannot remove the last manager",
                )
        user.role = new_role

    if "is_active" in updates:
        new_active = updates["is_active"]
        # Prevent deactivating the last manager
        if not new_active and can_manage_users(user.role):
            manager_count = (
                db.query(func.count(User.id))
                .filter(User.role.in_(["manager", "admin"]), User.is_active.is_(True), User.deleted_at.is_(None))
                .scalar()
            )
            if manager_count <= 1:
                raise HTTPException(
                    status_code=409,
                    detail="Cannot deactivate the last manager",
                )
        user.is_active = new_active

    if "department" in updates:
        user.department = updates["department"]

    if "default_station_id" in updates:
        station_id = updates["default_station_id"]
        if station_id is not None:
            station = db.query(Station).filter(Station.id == station_id).first()
            if not station:
                raise HTTPException(status_code=404, detail="Station not found")
        user.default_station_id = station_id

    if "warehouse_id" in updates:
        warehouse_id = updates["warehouse_id"]
        if warehouse_id is not None:
            warehouse = db.query(Warehouse).filter(Warehouse.id == warehouse_id).first()
            if not warehouse:
                raise HTTPException(status_code=404, detail="Warehouse not found")
        user.warehouse_id = warehouse_id

    if "default_warehouse_id" in updates:
        warehouse_id = updates["default_warehouse_id"]
        if warehouse_id is not None:
            warehouse = db.query(Warehouse).filter(Warehouse.id == warehouse_id).first()
            if not warehouse:
                raise HTTPException(status_code=404, detail="Warehouse not found")
        user.default_warehouse_id = warehouse_id
        if user.warehouse_id is None:
            user.warehouse_id = warehouse_id

    db.add(user)
    log_audit(
        db,
        actor_id=current_user.id,
        action="user_updated",
        entity_type="user",
        entity_id=user.id,
        metadata={"fields": list(updates.keys())},
    )
    db.commit()
    db.refresh(user)
    return _profile_from_user(user)


# ---------- admin: list / create / password-reset ----------


def _user_list_item(user: User) -> UserListItem:
    department = getattr(user, "department", None)
    department_value = department.value if hasattr(department, "value") else department
    last_seen = None
    if user.last_seen_at:
        last_seen = user.last_seen_at.isoformat()
    return UserListItem(
        id=user.id,
        username=user.username,
        full_name=getattr(user, "full_name", None),
        role=user.role,
        role_label=role_label_ru(user.role),
        is_active=user.is_active,
        department=department_value,
        warehouse_id=getattr(user, "warehouse_id", None),
        default_warehouse_id=getattr(user, "default_warehouse_id", None),
        last_seen_at=last_seen,
    )


@router.get("", response_model=list[UserListItem])
def list_users(
    search: str | None = Query(None),
    role: str | None = Query(None),
    warehouse_id: int | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_user_manage_role(current_user)

    q = db.query(User).filter(User.deleted_at.is_(None))

    if search:
        pattern = f"%{search}%"
        q = q.filter(
            (User.username.ilike(pattern)) | (User.full_name.ilike(pattern))
        )

    if role:
        q = q.filter(User.role == role)

    if warehouse_id is not None:
        q = q.filter(
            (User.warehouse_id == warehouse_id)
            | (User.default_warehouse_id == warehouse_id)
        )

    users = q.order_by(User.full_name.asc(), User.username.asc()).all()
    return [_user_list_item(u) for u in users]


@router.post("", response_model=ProfileOut, status_code=201)
def admin_create_user(
    data: AdminCreateUser,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_user_manage_role(current_user)

    existing = db.query(User).filter(User.username == data.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")

    try:
        validated_role = resolve_registration_role(data.role)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    warehouse_id = data.warehouse_id
    if warehouse_id is not None:
        wh = db.query(Warehouse).filter(Warehouse.id == warehouse_id).first()
        if not wh:
            raise HTTPException(status_code=404, detail="Warehouse not found")

    user = User(
        username=data.username,
        full_name=data.full_name,
        password_hash=hash_password(data.password),
        role=validated_role,
        warehouse_id=warehouse_id,
        default_warehouse_id=warehouse_id,
    )
    db.add(user)
    db.flush()
    db.refresh(user)
    log_audit(
        db,
        actor_id=current_user.id,
        action="user_created",
        entity_type="user",
        entity_id=user.id,
        metadata={"username": user.username, "role": user.role},
    )
    db.commit()
    return _profile_from_user(user)


@router.post("/{user_id}/reset-password", status_code=204)
def admin_reset_password(
    user_id: int,
    data: AdminResetPassword,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_user_manage_role(current_user)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.password_hash = hash_password(data.password)
    log_audit(
        db,
        actor_id=current_user.id,
        action="user_password_reset",
        entity_type="user",
        entity_id=user.id,
    )
    db.add(user)
    db.commit()


@router.delete("/{user_id}", status_code=204)
def admin_delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_user_manage_role(current_user)

    if current_user.id == user_id:
        raise HTTPException(status_code=409, detail="Cannot delete yourself")

    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Prevent deleting the last manager
    if can_manage_users(user.role):
        manager_count = (
            db.query(func.count(User.id))
            .filter(
                User.role.in_(["manager", "admin"]),
                User.is_active.is_(True),
                User.deleted_at.is_(None),
            )
            .scalar()
        )
        if manager_count <= 1:
            raise HTTPException(
                status_code=409,
                detail="Cannot delete the last manager",
            )

    user.deleted_at = datetime.now(timezone.utc)
    log_audit(
        db,
        actor_id=current_user.id,
        action="user_deleted",
        entity_type="user",
        entity_id=user.id,
        metadata={"username": user.username},
    )
    db.add(user)
    db.commit()


# ---------- heartbeat / online presence ----------

ONLINE_THRESHOLD_SECONDS = 60


class OnlineUser(BaseModel):
    id: int
    username: str
    full_name: str | None = None
    role: str
    role_label: str


@router.post("/heartbeat", status_code=204)
def heartbeat(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.last_seen_at = datetime.now(timezone.utc)
    db.add(current_user)
    db.commit()


@router.get("/online", response_model=list[OnlineUser])
def online_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    warehouse_id = current_user.warehouse_id
    if warehouse_id is None:
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(seconds=ONLINE_THRESHOLD_SECONDS)
    users = (
        db.query(User)
        .filter(
            User.warehouse_id == warehouse_id,
            User.is_active.is_(True),
            User.deleted_at.is_(None),
            User.last_seen_at >= cutoff,
        )
        .order_by(User.full_name.asc(), User.username.asc())
        .all()
    )
    return [
        OnlineUser(
            id=u.id,
            username=u.username,
            full_name=getattr(u, "full_name", None),
            role=u.role,
            role_label=role_label_ru(u.role),
        )
        for u in users
    ]
