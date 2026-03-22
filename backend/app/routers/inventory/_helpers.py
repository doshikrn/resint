import hashlib
import json
import logging
from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from email.utils import format_datetime, parsedate_to_datetime

from fastapi import HTTPException
from sqlalchemy import func, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.clock import utc_now as _utc_now
from app.core.metrics import (
    observe_idempotency_cleanup,
    observe_idempotency_conflict,
    observe_idempotency_replay,
)
from app.core.roles import (
    can_access_all_warehouses,
    can_export,
    can_manage_revision,
    can_view_audit,
)
from app.models.enums import (
    AuditAction,
    EntryAction,
    SessionEventAction,
    SessionStatus,
)
from app.models.idempotency_key import IdempotencyKey
from app.models.inventory_entry import InventoryEntry
from app.models.inventory_entry_event import InventoryEntryEvent
from app.models.inventory_session import InventorySession
from app.models.inventory_session_event import InventorySessionEvent
from app.models.inventory_session_total import InventorySessionTotal
from app.models.inventory_zone_progress import InventoryZoneProgress
from app.models.item import Item
from app.models.item_usage_stat import ItemUsageStat
from app.models.station import Station, StationDepartment
from app.models.user import User
from app.models.warehouse import Warehouse
from app.models.zone import Zone

log = logging.getLogger("app")


def _raise_api_error(status_code: int, code: str, message: str, details=None) -> None:
    payload = {"code": code, "message": message}
    if details is not None:
        payload["details"] = details
    raise HTTPException(status_code=status_code, detail=payload)



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



def _normalize_qty_for_api(
    value: float | Decimal | None, unit: str | None = None, max_decimals: int = 3
) -> float:
    if value is None:
        return 0.0

    normalized_unit = (unit or "").strip().lower()
    decimals = 0 if normalized_unit in {"pcs", "шт"} else max_decimals
    quantum = Decimal("1") if decimals == 0 else Decimal("1").scaleb(-decimals)

    try:
        decimal_value = Decimal(str(value)).quantize(quantum, rounding=ROUND_HALF_UP)
    except Exception:
        decimal_value = Decimal("0")

    text = format(decimal_value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    if text in {"", "-0"}:
        text = "0"
    return float(text)



def _normalize_reason(reason: str | None) -> str | None:
    if reason is None:
        return None
    value = reason.strip()
    return value or None



def _normalize_outside_zone_note(note: str | None) -> str | None:
    if note is None:
        return None
    value = note.strip()
    return value or None



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



def _require_audit_view_role(current_user) -> None:
    if not can_view_audit(current_user.role):
        raise HTTPException(status_code=403, detail="Insufficient role to view audit")



def _require_revision_manage_role(current_user) -> None:
    if not can_manage_revision(current_user.role):
        raise HTTPException(
            status_code=403, detail="Only chef or souschef can manage revision"
        )



def _can_edit_closed_revision(current_user) -> bool:
    return can_manage_revision(current_user.role)



def _resolve_user_warehouse_id(current_user) -> int | None:
    warehouse_id = getattr(current_user, "warehouse_id", None)
    if warehouse_id is None:
        warehouse_id = getattr(current_user, "default_warehouse_id", None)
    if warehouse_id is None:
        return None
    return int(warehouse_id)



def _require_user_warehouse_id(current_user) -> int:
    warehouse_id = _resolve_user_warehouse_id(current_user)
    if warehouse_id is None:
        raise HTTPException(
            status_code=403,
            detail="User is not bound to a warehouse",
        )
    return warehouse_id



def _require_access_to_warehouse(session: InventorySession, current_user) -> None:
    if can_access_all_warehouses(current_user.role):
        return
    user_warehouse_id = _require_user_warehouse_id(current_user)
    if int(session.warehouse_id) != user_warehouse_id:
        raise HTTPException(status_code=403, detail="Forbidden for this warehouse")



def _require_warehouse_param_access(requested_warehouse_id: int, current_user) -> None:
    if can_access_all_warehouses(current_user.role):
        return
    user_warehouse_id = _require_user_warehouse_id(current_user)
    if int(requested_warehouse_id) != user_warehouse_id:
        raise HTTPException(status_code=403, detail="Forbidden for this warehouse")



def _is_session_closed(session: InventorySession) -> bool:
    """Check both legacy `is_closed` flag and canonical `status` column."""
    return bool(
        getattr(session, "is_closed", False)
        or getattr(session, "status", None) == SessionStatus.CLOSED
    )



def _require_active_session_owner(session: InventorySession, current_user) -> None:
    is_active = not _is_session_closed(session)
    if is_active and session.created_by_user_id != current_user.id:
        _raise_api_error(
            403, "SESSION_READ_ONLY", "Active session is owned by another user"
        )



def _parse_if_match_version(raw_if_match: str | None) -> int | None:
    if raw_if_match is None:
        return None
    value = raw_if_match.strip()
    if not value:
        return None
    if value.startswith("W/"):
        value = value[2:]
    value = value.strip().strip('"')
    try:
        parsed = int(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail="If-Match must contain an integer version"
        ) from exc
    if parsed < 1:
        raise HTTPException(status_code=422, detail="If-Match version must be >= 1")
    return parsed



def _event_to_out(
    event: InventoryEntryEvent,
    item_name: str,
    actor_username: str | None,
    actor_display_name: str | None,
) -> dict:
    return {
        "id": event.id,
        "session_id": event.session_id,
        "item_id": event.item_id,
        "item_name": item_name,
        "actor_user_id": event.actor_user_id,
        "actor_username": actor_username,
        "actor_display_name": actor_display_name or actor_username or "—",
        "action": event.action,
        "reason": event.reason,
        "station_id": event.station_id,
        "counted_outside_zone": bool(event.counted_outside_zone),
        "counted_by_zone_id": event.counted_by_zone_id
        if event.counted_outside_zone
        else None,
        "outside_zone_note": event.outside_zone_note
        if event.counted_outside_zone
        else None,
        "request_id": event.request_id,
        "before_quantity": None
        if event.before_quantity is None
        else _normalize_qty_for_api(event.before_quantity),
        "after_quantity": _normalize_qty_for_api(event.after_quantity),
        "created_at": event.created_at,
    }



def _recent_event_to_out(
    event: InventoryEntryEvent,
    item_name: str,
    unit: str,
    actor_username: str | None,
    actor_display_name: str | None,
    counted_by_zone: str | None,
    station_name: str | None,
    station_department: str | None,
) -> dict:
    before_qty = (
        None
        if event.before_quantity is None
        else _normalize_qty_for_api(event.before_quantity, unit=unit)
    )
    after_qty = _normalize_qty_for_api(event.after_quantity, unit=unit)
    mode = str(event.action)
    base_before = before_qty if before_qty is not None else 0.0
    if mode == EntryAction.ADD:
        qty_input = after_qty - base_before
        qty_delta = qty_input
    elif mode == EntryAction.SET:
        qty_input = after_qty
        qty_delta = after_qty - base_before
    else:
        qty_input = after_qty
        qty_delta = after_qty - base_before

    return {
        "id": event.id,
        "session_id": event.session_id,
        "item_id": event.item_id,
        "item_name": item_name,
        "unit": unit,
        "mode": mode,
        "qty_input": qty_input,
        "qty_delta": qty_delta,
        "actor_user_id": event.actor_user_id,
        "actor_username": actor_username,
        "actor_display_name": actor_display_name,
        "station_id": event.station_id,
        "station_name": station_name,
        "station_department": station_department,
        "counted_outside_zone": bool(event.counted_outside_zone),
        "counted_by_zone_id": event.counted_by_zone_id
        if event.counted_outside_zone
        else None,
        "counted_by_zone": counted_by_zone if event.counted_outside_zone else None,
        "outside_zone_note": event.outside_zone_note
        if event.counted_outside_zone
        else None,
        "request_id": event.request_id,
        "before_quantity": before_qty,
        "after_quantity": after_qty,
        "created_at": event.created_at,
    }



def _create_entry_event(
    db: Session,
    session_id: int,
    item_id: int,
    actor_user_id: int,
    action: str,
    reason: str | None,
    station_id: int | None,
    counted_outside_zone: bool,
    counted_by_zone_id: int | None,
    outside_zone_note: str | None,
    request_id: str | None,
    before_quantity: float | None,
    after_quantity: float,
    created_at: datetime,
) -> None:
    db.add(
        InventoryEntryEvent(
            session_id=session_id,
            item_id=item_id,
            actor_user_id=actor_user_id,
            action=action,
            reason=reason,
            station_id=station_id,
            counted_outside_zone=counted_outside_zone,
            counted_by_zone_id=counted_by_zone_id if counted_outside_zone else None,
            outside_zone_note=outside_zone_note if counted_outside_zone else None,
            request_id=request_id,
            before_quantity=before_quantity,
            after_quantity=after_quantity,
            created_at=created_at,
        )
    )



def _create_session_event(
    db: Session,
    session_id: int,
    actor_user_id: int,
    action: str,
    request_id: str | None,
    reason: str | None,
    created_at: datetime,
) -> None:
    if not _has_table(db, InventorySessionEvent.__tablename__):
        log.warning(
            "session_event_skipped_missing_table",
            extra={
                "event": "session_event_skipped_missing_table",
                "session_id": session_id,
                "action": action,
            },
        )
        return

    db.add(
        InventorySessionEvent(
            session_id=session_id,
            actor_user_id=actor_user_id,
            action=action,
            request_id=request_id,
            reason=reason,
            created_at=created_at,
        )
    )



def _build_user_display_name(full_name: str | None, username: str | None) -> str | None:
    if full_name:
        value = str(full_name).strip()
        if value:
            return value
    if username:
        value = str(username).strip()
        if value:
            return value
    return None



def _build_entry_contributors_map(
    db: Session, session_id: int, item_ids: list[int]
) -> dict[int, dict[str, object]]:
    if not item_ids:
        return {}

    rows = (
        db.query(
            InventoryEntryEvent.item_id.label("item_id"),
            InventoryEntryEvent.actor_user_id.label("actor_user_id"),
            func.max(InventoryEntryEvent.created_at).label("last_activity_at"),
            User.full_name.label("full_name"),
            User.username.label("username"),
        )
        .join(User, User.id == InventoryEntryEvent.actor_user_id)
        .filter(
            InventoryEntryEvent.session_id == session_id,
            InventoryEntryEvent.item_id.in_(item_ids),
        )
        .group_by(
            InventoryEntryEvent.item_id,
            InventoryEntryEvent.actor_user_id,
            User.full_name,
            User.username,
            User.full_name,
        )
        .all()
    )

    grouped: dict[int, list[dict[str, object]]] = {}
    for row in rows:
        display_name = _build_user_display_name(
            full_name=str(row.full_name) if row.full_name else None,
            username=str(row.username) if row.username else None,
        )
        if not display_name:
            continue
        item_group = grouped.setdefault(int(row.item_id), [])
        item_group.append(
            {
                "display_name": display_name,
                "last_activity_at": row.last_activity_at,
            }
        )

    min_dt = datetime.min.replace(tzinfo=timezone.utc)
    result: dict[int, dict[str, object]] = {}
    for item_id in item_ids:
        contributors = grouped.get(int(item_id), [])
        if not contributors:
            continue

        contributors.sort(key=lambda value: str(value["display_name"]).lower())
        contributors.sort(
            key=lambda value: (
                value["last_activity_at"]
                if isinstance(value["last_activity_at"], datetime)
                else min_dt
            ),
            reverse=True,
        )

        preview = [str(value["display_name"]) for value in contributors[:2]]
        result[int(item_id)] = {
            "contributors_count": len(contributors),
            "contributors_preview": preview,
        }

    return result



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



def _is_step_aligned(quantity: float, step: float) -> bool:
    q = Decimal(str(quantity))
    s = Decimal(str(step))
    if s <= 0:
        return False
    return (q % s) == 0



def _validate_item_quantity(item: Item, quantity: float) -> None:
    min_qty_floor = 0.01
    if quantity <= min_qty_floor:
        _raise_api_error(422, "VALIDATION_ERROR", "Quantity must be greater than 0.01")
    unit = (item.unit or "").strip().lower()
    if unit not in ("kg", "l") and not _is_step_aligned(quantity, float(item.step)):
        _raise_api_error(
            422, "VALIDATION_STEP_MISMATCH", f"Quantity must match step {item.step}"
        )
    if item.min_qty is not None and quantity < float(item.min_qty):
        _raise_api_error(422, "VALIDATION_ERROR", f"Quantity must be >= {item.min_qty}")
    if item.max_qty is not None and quantity > float(item.max_qty):
        _raise_api_error(422, "VALIDATION_ERROR", f"Quantity must be <= {item.max_qty}")



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



def _build_entries_request_hash(
    session_id: int,
    item_id: int,
    quantity: float,
    mode: str,
    station_id: int | None,
    counted_outside_zone: bool,
) -> str:
    payload = {
        "session_id": session_id,
        "item_id": item_id,
        "quantity": float(quantity),
        "mode": mode.strip().lower(),
        "station_id": station_id,
        "counted_outside_zone": bool(counted_outside_zone),
    }
    serialized = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()



def _ensure_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)



def _collect_session_rows(
    db: Session,
    session_id: int,
    prefer_snapshot: bool,
) -> list[tuple[int, str, str, float]]:
    if prefer_snapshot:
        if not _has_table(db, InventorySessionTotal.__tablename__):
            prefer_snapshot = False

    if prefer_snapshot:
        snapshot_rows = (
            db.query(InventorySessionTotal, Item)
            .join(Item, Item.id == InventorySessionTotal.item_id)
            .filter(InventorySessionTotal.session_id == session_id)
            .all()
        )
        if snapshot_rows:
            return [
                (total.item_id, item.name, total.unit, float(total.qty_final))
                for total, item in snapshot_rows
            ]

    live_rows = (
        db.query(InventoryEntry, Item)
        .join(Item, Item.id == InventoryEntry.item_id)
        .filter(InventoryEntry.session_id == session_id)
        .all()
    )
    return [
        (entry.item_id, item.name, item.unit, float(entry.quantity))
        for entry, item in live_rows
    ]



def _aggregate_window(
    db: Session,
    warehouse_id: int,
    from_dt: datetime,
    to_dt: datetime,
) -> dict[int, dict[str, float | str | int]]:
    sessions = (
        db.query(InventorySession)
        .filter(
            InventorySession.warehouse_id == warehouse_id,
            InventorySession.created_at >= from_dt,
            InventorySession.created_at < to_dt,
        )
        .all()
    )

    aggregated: dict[int, dict[str, float | str | int]] = {}
    for session in sessions:
        is_closed = _is_session_closed(session)
        rows = _collect_session_rows(
            db=db, session_id=session.id, prefer_snapshot=is_closed
        )
        for item_id, item_name, unit, quantity in rows:
            entry = aggregated.get(item_id)
            if not entry:
                aggregated[item_id] = {
                    "item_id": item_id,
                    "item_name": item_name,
                    "unit": unit,
                    "quantity": quantity,
                }
            else:
                entry["quantity"] = float(entry["quantity"]) + quantity
    return aggregated



def _get_stored_idempotent_response(
    db: Session,
    user_id: int,
    endpoint: str,
    idempotency_key: str,
) -> IdempotencyKey | None:
    return (
        db.query(IdempotencyKey)
        .filter(
            IdempotencyKey.user_id == user_id,
            IdempotencyKey.endpoint == endpoint,
            IdempotencyKey.idempotency_key == idempotency_key,
        )
        .first()
    )



def _cleanup_expired_idempotency_keys(db: Session, endpoint: str) -> int:
    ttl_hours = max(int(settings.idempotency_key_ttl_hours), 1)
    cutoff = _utc_now() - timedelta(hours=ttl_hours)
    deleted = (
        db.query(IdempotencyKey)
        .filter(
            IdempotencyKey.endpoint == endpoint,
            IdempotencyKey.created_at < cutoff,
        )
        .delete(synchronize_session=False)
    )
    return int(deleted or 0)



def _normalize_etag(raw: str) -> str:
    value = raw.strip()
    if value.startswith("W/"):
        value = value[2:].strip()
    if value.startswith('"') and value.endswith('"') and len(value) >= 2:
        value = value[1:-1]
    return value



def _build_catalog_etag(
    warehouse_id: int,
    items_count: int,
    active_count: int,
    max_item_updated_at: datetime | None,
    aliases_count: int,
    max_alias_id: int | None,
) -> str:
    updated_part = max_item_updated_at.isoformat() if max_item_updated_at else "0"
    payload = f"wh={warehouse_id};items={items_count};active={active_count};aliases={aliases_count};maxAlias={max_alias_id or 0};updated={updated_part}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


