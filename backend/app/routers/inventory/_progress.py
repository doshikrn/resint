"""Zone-progress helpers for the inventory router."""

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.enums import SessionStatus
from app.models.inventory_session import InventorySession
from app.models.inventory_zone_progress import InventoryZoneProgress
from app.models.user import User
from app.models.warehouse import Warehouse
from app.models.zone import Zone

from app.routers.inventory._session_ops import (
    _count_session_entered_items,
    _count_session_entered_items_by_user,
)


def _normalize_zone_progress_state(progress: InventoryZoneProgress) -> bool:
    entered_count = int(progress.entered_items_count or 0)
    if entered_count > 0:
        return False
    if not bool(progress.is_completed):
        return False
    progress.is_completed = False
    progress.completed_at = None
    progress.completed_by_user_id = None
    return True


def _ensure_zone_progress(
    db: Session, session: InventorySession
) -> InventoryZoneProgress:
    warehouse = db.query(Warehouse).filter(Warehouse.id == session.warehouse_id).first()
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    if warehouse.zone_id is None:
        raise HTTPException(status_code=409, detail="Warehouse is not linked to a zone")

    progress = (
        db.query(InventoryZoneProgress)
        .filter(
            InventoryZoneProgress.session_id == session.id,
            InventoryZoneProgress.zone_id == warehouse.zone_id,
        )
        .with_for_update()
        .first()
    )
    if progress:
        if progress.warehouse_id != session.warehouse_id:
            progress.warehouse_id = session.warehouse_id
            db.add(progress)
        return progress

    progress = InventoryZoneProgress(
        session_id=session.id,
        zone_id=int(warehouse.zone_id),
        warehouse_id=session.warehouse_id,
        entered_items_count=_count_session_entered_items(db, session.id),
    )
    db.add(progress)
    db.flush()
    return progress


def _touch_zone_progress_activity(
    db: Session, session: InventorySession, when: datetime
) -> None:
    db.flush()
    progress = _ensure_zone_progress(db, session)
    progress.entered_items_count = _count_session_entered_items(db, session.id)
    _normalize_zone_progress_state(progress)
    progress.last_activity_at = when
    db.add(progress)


def _zone_progress_to_out(
    progress: InventoryZoneProgress,
    session_status: str,
    warehouse_name: str,
    zone_name: str,
    completed_by_username: str | None,
    entered_items_by_user_count: int,
) -> dict:
    return {
        "session_id": progress.session_id,
        "warehouse_id": progress.warehouse_id,
        "warehouse_name": warehouse_name,
        "zone_id": progress.zone_id,
        "zone_name": zone_name,
        "session_status": session_status,
        "is_session_closed": str(session_status).lower() == SessionStatus.CLOSED,
        "entered_items_count": int(progress.entered_items_count),
        "entered_items_by_user_count": int(entered_items_by_user_count),
        "last_activity_at": progress.last_activity_at,
        "is_completed": bool(progress.is_completed),
        "completed_at": progress.completed_at,
        "completed_by_user_id": progress.completed_by_user_id,
        "completed_by_username": completed_by_username,
    }


def _load_zone_progress_snapshot(
    db: Session, session_id: int, user_id: int
) -> dict | None:
    row = (
        db.query(
            InventoryZoneProgress,
            InventorySession.status,
            Warehouse.name,
            Zone.name,
            User.username,
        )
        .join(InventorySession, InventorySession.id == InventoryZoneProgress.session_id)
        .join(Warehouse, Warehouse.id == InventoryZoneProgress.warehouse_id)
        .join(Zone, Zone.id == InventoryZoneProgress.zone_id)
        .outerjoin(User, User.id == InventoryZoneProgress.completed_by_user_id)
        .filter(InventoryZoneProgress.session_id == session_id)
        .first()
    )
    if not row:
        return None

    progress, session_status, warehouse_name, zone_name, completed_by_username = row
    _normalize_zone_progress_state(progress)
    entered_items_by_user_count = _count_session_entered_items_by_user(
        db, session_id, user_id
    )
    return _zone_progress_to_out(
        progress=progress,
        session_status=str(session_status),
        warehouse_name=str(warehouse_name),
        zone_name=str(zone_name),
        completed_by_username=str(completed_by_username)
        if completed_by_username
        else None,
        entered_items_by_user_count=entered_items_by_user_count,
    )
