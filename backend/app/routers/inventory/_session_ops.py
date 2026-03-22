"""Session state, CRUD, snapshot, and station-resolution helpers."""

import logging
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import func, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.enums import SessionStatus
from app.models.inventory_entry import InventoryEntry
from app.models.inventory_session import InventorySession
from app.models.inventory_session_total import InventorySessionTotal
from app.models.item import Item
from app.models.item_usage_stat import ItemUsageStat
from app.models.station import Station, StationDepartment
from app.models.warehouse import Warehouse

from app.routers.inventory._auth import _require_access_to_warehouse
from app.routers.inventory._validation import _normalize_qty_for_api

log = logging.getLogger("app")


def _is_active_session_unique_violation(exc: IntegrityError) -> bool:
    text = str(getattr(exc, "orig", exc)).lower()
    return (
        "uq_inventory_sessions_warehouse_draft" in text
        or "ux_active_session_per_warehouse" in text
        or (
            "duplicate key value violates unique constraint" in text
            and "inventory_sessions" in text
        )
        or "unique constraint failed: inventory_sessions.warehouse_id" in text
    )


def _entry_to_out(
    entry: InventoryEntry,
) -> dict:
    unit = entry.item.unit
    return {
        "session_id": entry.session_id,
        "id": entry.id,
        "item_id": entry.item_id,
        "item_name": entry.item.name,
        "unit": unit,
        "quantity": _normalize_qty_for_api(entry.quantity, unit=unit),
        "version": int(entry.version),
        "updated_at": entry.updated_at,
        "station_id": entry.station_id,
        "station_name": entry.station.name if getattr(entry, "station", None) else None,
        "station_department": (
            str(entry.station.department.value)
            if getattr(entry, "station", None)
            and hasattr(entry.station.department, "value")
            else (
                str(entry.station.department)
                if getattr(entry, "station", None) and entry.station.department
                else None
            )
        ),
        "counted_outside_zone": bool(entry.counted_outside_zone),
        "counted_by_zone_id": entry.counted_by_zone_id
        if entry.counted_outside_zone
        else None,
        "counted_by_zone": (
            entry.counted_by_zone.name
            if entry.counted_outside_zone and getattr(entry, "counted_by_zone", None)
            else None
        ),
        "outside_zone_note": entry.outside_zone_note
        if entry.counted_outside_zone
        else None,
        "contributors_count": 1,
        "contributors_preview": [],
    }


def _resolve_counted_by_zone_id(
    db: Session, warehouse_id: int, counted_outside_zone: bool
) -> int | None:
    if not counted_outside_zone:
        return None
    row = db.query(Warehouse.zone_id).filter(Warehouse.id == warehouse_id).first()
    if not row:
        return None
    return int(row[0]) if row[0] is not None else None


def _get_or_create_unknown_station(db: Session) -> Station:
    station = (
        db.query(Station)
        .filter(func.lower(Station.name) == "unknown")
        .order_by(Station.id.asc())
        .first()
    )
    if station:
        return station

    station = Station(
        name="Unknown",
        department=StationDepartment.kitchen,
        is_active=True,
        sort_order=9999,
    )
    db.add(station)
    db.flush()
    return station


def _resolve_station_id(
    db: Session, current_user, requested_station_id: int | None
) -> int:
    if requested_station_id is not None:
        station = db.query(Station).filter(Station.id == requested_station_id).first()
        if not station:
            raise HTTPException(status_code=404, detail="Station not found")
        return int(station.id)

    default_station_id = getattr(current_user, "default_station_id", None)
    if default_station_id is not None:
        station = db.query(Station).filter(Station.id == default_station_id).first()
        if station:
            return int(station.id)

    unknown_station = _get_or_create_unknown_station(db)
    return int(unknown_station.id)


def _next_revision_no(db: Session, warehouse_id: int) -> int:
    """Return the smallest positive integer not used by any non-deleted
    session in this warehouse.  This allows soft-deleted revision numbers
    to be reused."""
    used = {
        row[0]
        for row in db.query(InventorySession.revision_no)
        .filter(
            InventorySession.warehouse_id == warehouse_id,
            InventorySession.deleted_at.is_(None),
        )
        .all()
    }
    n = 1
    while n in used:
        n += 1
    return n


def _create_draft_session(
    db: Session, warehouse_id: int, user_id: int
) -> InventorySession:
    for _ in range(3):
        session = InventorySession(
            warehouse_id=warehouse_id,
            created_by_user_id=user_id,
            revision_no=_next_revision_no(db, warehouse_id),
            status=SessionStatus.DRAFT,
        )
        db.add(session)
        try:
            db.commit()
            db.refresh(session)
            return session
        except IntegrityError as exc:
            db.rollback()
            if _is_active_session_unique_violation(exc):
                raise
            err_text = str(getattr(exc, "orig", exc)).lower()
            if "uq_inventory_sessions_revision_no" in err_text:
                continue
            raise

    raise HTTPException(
        status_code=409, detail="Failed to assign revision number. Retry request"
    )


def _get_session_or_404(
    db: Session,
    session_id: int,
    current_user,
    include_deleted: bool = False,
) -> InventorySession:
    query = db.query(InventorySession).filter(InventorySession.id == session_id)
    if not include_deleted:
        query = query.filter(InventorySession.deleted_at.is_(None))
    session = query.first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_access_to_warehouse(session, current_user)
    return session


def _has_table(db: Session, table_name: str) -> bool:
    try:
        conn = db.connection()
        return bool(inspect(conn).has_table(table_name))
    except Exception:
        return False


def _snapshot_session_totals(db: Session, session_id: int) -> None:
    if not _has_table(db, InventorySessionTotal.__tablename__):
        log.warning(
            "snapshot_totals_skipped_missing_table",
            extra={
                "event": "snapshot_totals_skipped_missing_table",
                "session_id": session_id,
            },
        )
        return

    db.query(InventorySessionTotal).filter(
        InventorySessionTotal.session_id == session_id
    ).delete(synchronize_session=False)

    rows = (
        db.query(InventoryEntry, Item)
        .join(Item, Item.id == InventoryEntry.item_id)
        .filter(InventoryEntry.session_id == session_id)
        .order_by(
            InventoryEntry.item_id.asc(),
            InventoryEntry.updated_at.desc(),
            InventoryEntry.id.desc(),
        )
        .all()
    )

    seen_item_ids: set[int] = set()
    for entry, item in rows:
        item_id = int(entry.item_id)
        if item_id in seen_item_ids:
            continue
        seen_item_ids.add(item_id)
        db.add(
            InventorySessionTotal(
                session_id=session_id,
                item_id=item_id,
                qty_final=float(entry.quantity),
                unit=item.unit,
            )
        )


def _touch_item_usage_stats(
    db: Session, warehouse_id: int, item_id: int, when: datetime
) -> None:
    stats = (
        db.query(ItemUsageStat)
        .filter(
            ItemUsageStat.warehouse_id == warehouse_id,
            ItemUsageStat.item_id == item_id,
        )
        .with_for_update()
        .first()
    )
    if not stats:
        stats = ItemUsageStat(
            warehouse_id=warehouse_id,
            item_id=item_id,
            use_count=1,
            last_used_at=when,
        )
        db.add(stats)
        return

    stats.use_count = int(stats.use_count) + 1
    stats.last_used_at = when
    db.add(stats)


def _count_session_entered_items(db: Session, session_id: int) -> int:
    value = (
        db.query(func.count(InventoryEntry.id))
        .filter(InventoryEntry.session_id == session_id)
        .scalar()
    )
    return int(value or 0)


def _count_session_entered_items_by_user(
    db: Session, session_id: int, user_id: int
) -> int:
    value = (
        db.query(func.count(InventoryEntry.id))
        .filter(
            InventoryEntry.session_id == session_id,
            InventoryEntry.updated_by_user_id == user_id,
        )
        .scalar()
    )
    return int(value or 0)
