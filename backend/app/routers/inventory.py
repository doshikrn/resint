import hashlib
import json
import logging
from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from email.utils import format_datetime, parsedate_to_datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import func, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.deps import get_current_user
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
from app.db.session import get_db
from app.models.audit_log import AuditLog
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
from app.models.item_alias import ItemAlias
from app.models.item_usage_stat import ItemUsageStat
from app.models.station import Station, StationDepartment
from app.models.user import User
from app.models.warehouse import Warehouse
from app.models.zone import Zone
from app.schemas.inventory import (
    ActiveSessionRequest,
    AuditLogOut,
    InventoryAddEntry,
    InventoryCatalogItemOut,
    InventoryDiffReportOut,
    InventoryEntryEventOut,
    InventoryEntryOut,
    InventoryEntryPatch,
    InventoryEntrySnapshotOut,
    InventoryItemContributorsOut,
    InventoryParticipantsSummaryOut,
    InventoryRecentEventOut,
    InventorySessionCreate,
    InventorySessionEventOut,
    InventorySessionListItemOut,
    InventorySessionOut,
    InventorySessionProgressOut,
    InventorySessionReportOut,
    InventoryZoneProgressOut,
)
from app.services.audit import log_audit, verify_audit_chain
from app.services.export import (
    build_csv_export,
    build_export_filename,
    build_xlsx_accounting_template_export,
)
from app.services.export_repository import (
    fetch_session_catalog_export_rows,
    fetch_session_export_rows,
)

router = APIRouter(prefix="/inventory", tags=["inventory"])

log = logging.getLogger("app")

from app.core.clock import utc_now as _utc_now


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
    current = (
        db.query(func.max(InventorySession.revision_no))
        .filter(InventorySession.warehouse_id == warehouse_id)
        .scalar()
    )
    if current is None:
        return 1
    return int(current) + 1


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


@router.get("/sessions", response_model=list[InventorySessionListItemOut])
def list_sessions(
    warehouse_id: int | None = None,
    include_deleted: bool = False,
    limit: int = Query(default=50, ge=1, le=300),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if can_access_all_warehouses(current_user.role):
        effective_warehouse_id = warehouse_id
    else:
        effective_warehouse_id = _require_user_warehouse_id(current_user)
        if warehouse_id is not None and int(warehouse_id) != effective_warehouse_id:
            raise HTTPException(status_code=403, detail="Forbidden for this warehouse")

    query = (
        db.query(
            InventorySession,
            func.count(InventoryEntry.id).label("items_count"),
        )
        .outerjoin(
            InventoryEntry,
            InventoryEntry.session_id == InventorySession.id,
        )
        .group_by(InventorySession.id)
    )
    if effective_warehouse_id is not None:
        query = query.filter(InventorySession.warehouse_id == effective_warehouse_id)

    if not include_deleted:
        query = query.filter(InventorySession.deleted_at.is_(None))

    rows = (
        query.order_by(InventorySession.revision_no.desc(), InventorySession.id.desc())
        .limit(limit)
        .all()
    )

    payload: list[dict] = []
    for session, items_count in rows:
        payload.append(
            {
                "id": session.id,
                "warehouse_id": session.warehouse_id,
                "revision_no": session.revision_no,
                "status": session.status,
                "is_closed": bool(getattr(session, "is_closed", False)),
                "created_at": session.created_at,
                "updated_at": session.updated_at,
                "items_count": int(items_count or 0),
                "deleted_at": session.deleted_at,
            }
        )
    return payload


@router.get(
    "/sessions/{session_id}/events", response_model=list[InventorySessionEventOut]
)
def get_session_events(
    session_id: int,
    limit: int = Query(default=100, ge=1, le=300),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _get_session_or_404(
        db=db, session_id=session_id, current_user=current_user
    )

    rows = (
        db.query(
            InventorySessionEvent,
            User.username,
            User.full_name,
        )
        .outerjoin(User, User.id == InventorySessionEvent.actor_user_id)
        .filter(InventorySessionEvent.session_id == session_id)
        .order_by(
            InventorySessionEvent.created_at.desc(), InventorySessionEvent.id.desc()
        )
        .limit(limit)
        .all()
    )

    payload: list[dict] = []
    for event, username, full_name in rows:
        actor_username = str(username) if username else None
        payload.append(
            {
                "id": event.id,
                "session_id": event.session_id,
                "actor_user_id": event.actor_user_id,
                "actor_username": actor_username,
                "actor_display_name": _build_user_display_name(
                    full_name=str(full_name) if full_name else None,
                    username=actor_username,
                ),
                "action": event.action,
                "reason": event.reason,
                "request_id": event.request_id,
                "created_at": event.created_at,
            }
        )
    return payload


@router.post("/sessions", response_model=InventorySessionOut)
def create_session(
    payload: InventorySessionCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_revision_manage_role(current_user)
    _require_warehouse_param_access(payload.warehouse_id, current_user)
    try:
        session = _create_draft_session(
            db=db, warehouse_id=payload.warehouse_id, user_id=current_user.id
        )
    except IntegrityError as exc:
        if _is_active_session_unique_violation(exc):
            raise HTTPException(
                status_code=409,
                detail="Active session already exists for this warehouse",
            )
        raise
    log_audit(
        db,
        actor_id=current_user.id,
        action=AuditAction.REVISION_CREATED,
        entity_type="session",
        entity_id=session.id,
        warehouse_id=session.warehouse_id,
        metadata={"revision_no": session.revision_no},
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        log.warning("audit_commit_failed_create_session", extra={"session_id": session.id})
    return session


@router.get("/sessions/{session_id}", response_model=InventorySessionOut)
def get_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return _get_session_or_404(db=db, session_id=session_id, current_user=current_user)


@router.get(
    "/sessions/{session_id}/progress", response_model=InventorySessionProgressOut
)
def get_session_progress(
    session_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    session = _get_session_or_404(
        db=db, session_id=session_id, current_user=current_user
    )
    is_closed = _is_session_closed(session)
    total_counted = _count_session_entered_items(db, session.id)
    my_counted = _count_session_entered_items_by_user(db, session.id, current_user.id)
    last_activity = (
        db.query(func.max(InventoryEntry.updated_at))
        .filter(InventoryEntry.session_id == session.id)
        .scalar()
    )

    return {
        "session_id": session.id,
        "warehouse_id": session.warehouse_id,
        "status": str(session.status),
        "is_session_closed": is_closed,
        "total_counted_items": int(total_counted),
        "my_counted_items": int(my_counted),
        "last_activity_at": last_activity,
    }


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


@router.get(
    "/sessions/{session_id}/catalog", response_model=list[InventoryCatalogItemOut]
)
def get_session_catalog(
    session_id: int,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
    if_modified_since: str | None = Header(default=None, alias="If-Modified-Since"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    session = _get_session_or_404(
        db=db, session_id=session_id, current_user=current_user
    )

    if _is_session_closed(session):
        _raise_api_error(409, "SESSION_CLOSED", "Session is closed")

    warehouse_id = int(session.warehouse_id)

    max_item_updated_at = (
        db.query(func.max(Item.updated_at))
        .filter(Item.warehouse_id == warehouse_id)
        .scalar()
    )
    items_count = int(
        db.query(func.count(Item.id)).filter(Item.warehouse_id == warehouse_id).scalar()
        or 0
    )
    active_count = int(
        db.query(func.count(Item.id))
        .filter(Item.warehouse_id == warehouse_id, Item.is_active == True)  # noqa: E712
        .scalar()
        or 0
    )

    alias_stats = (
        db.query(func.count(ItemAlias.id), func.max(ItemAlias.id))
        .join(Item, ItemAlias.item_id == Item.id)
        .filter(Item.warehouse_id == warehouse_id)
        .first()
    )
    aliases_count = int(alias_stats[0] or 0) if alias_stats else 0
    max_alias_id = (
        int(alias_stats[1]) if alias_stats and alias_stats[1] is not None else None
    )

    etag_value = _build_catalog_etag(
        warehouse_id=warehouse_id,
        items_count=items_count,
        active_count=active_count,
        max_item_updated_at=max_item_updated_at,
        aliases_count=aliases_count,
        max_alias_id=max_alias_id,
    )
    etag_header = f'"{etag_value}"'

    last_modified = max_item_updated_at or _utc_now()
    if last_modified.tzinfo is None:
        last_modified = last_modified.replace(tzinfo=timezone.utc)
    else:
        # Python 3.14's email.utils.format_datetime(usegmt=True) requires a true
        # UTC tzinfo (datetime.timezone.utc), not just an offset of +00:00.
        last_modified = last_modified.astimezone(timezone.utc)
    last_modified_header = format_datetime(last_modified, usegmt=True)

    # Conditional requests
    if if_none_match:
        raw_tags = [tag.strip() for tag in if_none_match.split(",") if tag.strip()]
        if any(_normalize_etag(tag) == etag_value for tag in raw_tags):
            return Response(
                status_code=304,
                headers={
                    "ETag": etag_header,
                    "Last-Modified": last_modified_header,
                    "Cache-Control": "private, max-age=0",
                },
            )

    if if_modified_since:
        try:
            since_dt = parsedate_to_datetime(if_modified_since)
            if since_dt.tzinfo is None:
                since_dt = since_dt.replace(tzinfo=timezone.utc)
            else:
                since_dt = since_dt.astimezone(timezone.utc)
            if last_modified <= since_dt:
                return Response(
                    status_code=304,
                    headers={
                        "ETag": etag_header,
                        "Last-Modified": last_modified_header,
                        "Cache-Control": "private, max-age=0",
                    },
                )
        except Exception:
            # Ignore invalid If-Modified-Since values
            pass

    items = (
        db.query(Item)
        .filter(Item.warehouse_id == warehouse_id)
        .order_by(
            Item.is_active.desc(),
            Item.product_code.asc(),
            Item.name.asc(),
            Item.id.asc(),
        )
        .all()
    )

    alias_rows = (
        db.query(ItemAlias.item_id, ItemAlias.alias_text)
        .join(Item, ItemAlias.item_id == Item.id)
        .filter(Item.warehouse_id == warehouse_id)
        .order_by(ItemAlias.id.asc())
        .all()
    )
    aliases_by_item: dict[int, list[str]] = {}
    for item_id, alias_text in alias_rows:
        key = int(item_id)
        aliases_by_item.setdefault(key, []).append(str(alias_text))

    payload = []
    for item in items:
        payload.append(
            {
                "id": int(item.id),
                "product_code": str(item.product_code),
                "name": str(item.name),
                "unit": str(item.unit),
                "step": float(item.step),
                "min_qty": None if item.min_qty is None else float(item.min_qty),
                "max_qty": None if item.max_qty is None else float(item.max_qty),
                "is_favorite": bool(item.is_favorite),
                "is_active": bool(item.is_active),
                "warehouse_id": int(item.warehouse_id),
                "station_id": None if item.station_id is None else int(item.station_id),
                "updated_at": item.updated_at,
                "aliases": aliases_by_item.get(int(item.id), []),
            }
        )

    return JSONResponse(
        status_code=200,
        content=jsonable_encoder(payload),
        headers={
            "ETag": etag_header,
            "Last-Modified": last_modified_header,
            "Cache-Control": "private, max-age=0",
        },
    )


@router.get(
    "/sessions/{session_id}/entries-snapshot",
    response_model=list[InventoryEntrySnapshotOut],
)
def get_entries_snapshot(
    session_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    session = _get_session_or_404(
        db=db, session_id=session_id, current_user=current_user
    )

    if _is_session_closed(session):
        _raise_api_error(409, "SESSION_CLOSED", "Session is closed")

    rows = (
        db.query(
            InventoryEntry.item_id,
            InventoryEntry.quantity,
            Item.unit,
            InventoryEntry.updated_at,
            User.id,
            User.username,
            User.full_name,
        )
        .join(Item, Item.id == InventoryEntry.item_id)
        .join(User, User.id == InventoryEntry.updated_by_user_id)
        .filter(InventoryEntry.session_id == session_id)
        .order_by(InventoryEntry.updated_at.desc(), InventoryEntry.id.desc())
        .all()
    )

    payload = []
    for item_id, qty, unit, updated_at, user_id, username, full_name in rows:
        display_name = _build_user_display_name(
            full_name=str(full_name) if full_name else None,
            username=str(username) if username else None,
        )
        payload.append(
            {
                "item_id": int(item_id),
                "qty": _normalize_qty_for_api(qty, unit=str(unit)),
                "unit": str(unit),
                "updated_at": updated_at,
                "updated_by_user": {
                    "id": int(user_id),
                    "username": str(username),
                    "display_name": display_name or str(username),
                },
            }
        )

    return payload


@router.post(
    "/sessions/{session_id}/zone-complete", response_model=InventoryZoneProgressOut
)
def complete_zone(
    session_id: int,
    request_id: str | None = Header(default=None, alias="x-request-id"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    session = _get_session_or_404(
        db=db, session_id=session_id, current_user=current_user
    )

    _require_revision_manage_role(current_user)
    if _is_session_closed(session):
        _raise_api_error(409, "SESSION_CLOSED", "Session is closed")

    progress = _ensure_zone_progress(db, session)
    progress.entered_items_count = _count_session_entered_items(db, session.id)
    normalized_state_changed = _normalize_zone_progress_state(progress)
    now = _utc_now()

    if int(progress.entered_items_count or 0) <= 0:
        if normalized_state_changed:
            db.add(progress)
            db.commit()
        raise HTTPException(
            status_code=409,
            detail="Cannot complete zone before any positions are entered",
        )

    if not progress.is_completed:
        progress.is_completed = True
        progress.completed_at = now
        progress.completed_by_user_id = current_user.id
        progress.last_activity_at = progress.last_activity_at or now
        db.add(progress)
        _create_session_event(
            db=db,
            session_id=session_id,
            actor_user_id=current_user.id,
            action=SessionEventAction.ZONE_COMPLETED,
            request_id=request_id,
            reason=f"zone_id={progress.zone_id}",
            created_at=now,
        )
        db.commit()
    else:
        db.commit()

    payload = _load_zone_progress_snapshot(db, session_id, current_user.id)
    if not payload:
        raise HTTPException(status_code=404, detail="Session progress not found")
    return payload


@router.get("/progress", response_model=list[InventoryZoneProgressOut])
def get_progress(
    zone_id: int | None = None,
    warehouse_id: int | None = None,
    include_closed: bool = False,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    user_warehouse_id = _require_user_warehouse_id(current_user)
    if warehouse_id is not None and int(warehouse_id) != user_warehouse_id:
        raise HTTPException(status_code=403, detail="Forbidden for this warehouse")

    sessions_query = db.query(InventorySession)
    if not include_closed:
        sessions_query = sessions_query.filter(InventorySession.status == SessionStatus.DRAFT)
    sessions_query = sessions_query.filter(
        InventorySession.warehouse_id == user_warehouse_id
    )

    sessions = sessions_query.order_by(
        InventorySession.updated_at.desc(), InventorySession.id.desc()
    ).all()
    for session in sessions:
        try:
            _ensure_zone_progress(db, session)
        except HTTPException as exc:
            if exc.status_code in {404, 409}:
                continue
            raise
    db.commit()

    query = (
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
    )

    if not include_closed:
        query = query.filter(InventorySession.status == SessionStatus.DRAFT)
    if zone_id is not None:
        query = query.filter(InventoryZoneProgress.zone_id == zone_id)
    query = query.filter(InventoryZoneProgress.warehouse_id == user_warehouse_id)

    rows = query.order_by(
        Zone.name.asc(), Warehouse.name.asc(), InventoryZoneProgress.session_id.desc()
    ).all()
    payload = []
    for (
        progress,
        session_status,
        warehouse_name,
        zone_name,
        completed_by_username,
    ) in rows:
        _normalize_zone_progress_state(progress)
        entered_items_by_user_count = _count_session_entered_items_by_user(
            db, progress.session_id, current_user.id
        )
        payload.append(
            _zone_progress_to_out(
                progress=progress,
                session_status=str(session_status),
                warehouse_name=str(warehouse_name),
                zone_name=str(zone_name),
                completed_by_username=str(completed_by_username)
                if completed_by_username
                else None,
                entered_items_by_user_count=entered_items_by_user_count,
            )
        )
    db.commit()
    return payload


@router.get("/sessions/{session_id}/entries", response_model=list[InventoryEntryOut])
def get_session_entries(
    session_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _get_session_or_404(
        db=db, session_id=session_id, current_user=current_user
    )

    entries = (
        db.query(InventoryEntry)
        .options(
            joinedload(InventoryEntry.item),
            joinedload(InventoryEntry.counted_by_zone),
            joinedload(InventoryEntry.station),
        )
        .filter(InventoryEntry.session_id == session_id)
        .order_by(InventoryEntry.updated_at.desc(), InventoryEntry.id.desc())
        .all()
    )
    payload = [_entry_to_out(e) for e in entries]

    item_ids = [int(row["item_id"]) for row in payload]
    contributors_map = _build_entry_contributors_map(
        db=db, session_id=session_id, item_ids=item_ids
    )

    for row in payload:
        contributors = contributors_map.get(int(row["item_id"]))
        if contributors is None:
            continue
        row["contributors_count"] = int(contributors["contributors_count"])
        row["contributors_preview"] = [
            str(name) for name in contributors["contributors_preview"]
        ]

    return payload


@router.post("/sessions/{session_id}/entries", response_model=InventoryEntryOut)
def add_or_update_entry(
    session_id: int,
    payload: InventoryAddEntry,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    request_id: str | None = Header(default=None, alias="x-request-id"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    endpoint = "POST /inventory/sessions/{session_id}/entries"
    request_hash = _build_entries_request_hash(
        session_id=session_id,
        item_id=payload.item_id,
        quantity=payload.quantity,
        mode=payload.mode,
        station_id=payload.station_id,
        counted_outside_zone=payload.counted_outside_zone,
    )

    if idempotency_key:
        key_value = idempotency_key.strip()
        if not key_value:
            raise HTTPException(
                status_code=422, detail="Idempotency-Key cannot be empty"
            )

        deleted = _cleanup_expired_idempotency_keys(db=db, endpoint=endpoint)
        if deleted > 0:
            observe_idempotency_cleanup(endpoint=endpoint, deleted=deleted)
            log.info(
                "idempotency_cleanup",
                extra={
                    "event": "idempotency_cleanup",
                    "endpoint": endpoint,
                    "deleted": deleted,
                    "user_id": current_user.id,
                },
            )
        db.commit()

        stored = _get_stored_idempotent_response(
            db=db,
            user_id=current_user.id,
            endpoint=endpoint,
            idempotency_key=key_value,
        )
        if stored:
            if stored.request_hash != request_hash:
                observe_idempotency_conflict(endpoint=endpoint)
                log.warning(
                    "idempotency_conflict",
                    extra={
                        "event": "idempotency_conflict",
                        "endpoint": endpoint,
                        "idempotency_key": key_value,
                        "user_id": current_user.id,
                    },
                )
                raise HTTPException(
                    status_code=409,
                    detail="Idempotency-Key reused with different payload",
                )
            observe_idempotency_replay(endpoint=endpoint)
            log.info(
                "idempotency_replay",
                extra={
                    "event": "idempotency_replay",
                    "endpoint": endpoint,
                    "idempotency_key": key_value,
                    "user_id": current_user.id,
                },
            )
            replay_response = JSONResponse(
                status_code=stored.response_status,
                content=json.loads(stored.response_body),
            )
            replay_response.headers["x-idempotency-replay"] = "true"
            replay_response.headers["x-idempotency-code"] = "IDEMPOTENCY_REPLAY"
            return replay_response

    # 0) защита: нельзя писать в закрытую (если уже сделал — ок)
    session = _get_session_or_404(
        db=db, session_id=session_id, current_user=current_user
    )
    is_closed = _is_session_closed(session)
    if is_closed and not _can_edit_closed_revision(current_user):
        _raise_api_error(409, "SESSION_CLOSED", "Session is closed")

    item = db.query(Item).filter(Item.id == payload.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if not item.is_active:
        _raise_api_error(409, "ITEM_INACTIVE", "Item is inactive")
    if item.warehouse_id != session.warehouse_id:
        raise HTTPException(
            status_code=400,
            detail="Item does not belong to session warehouse",
        )

    mode = payload.mode.lower().strip()
    normalized_reason = _normalize_reason(payload.reason)
    counted_outside_zone = bool(payload.counted_outside_zone)
    counted_by_zone_id = _resolve_counted_by_zone_id(
        db=db,
        warehouse_id=session.warehouse_id,
        counted_outside_zone=counted_outside_zone,
    )
    station_id = _resolve_station_id(
        db=db,
        current_user=current_user,
        requested_station_id=payload.station_id,
    )
    outside_zone_note = _normalize_outside_zone_note(payload.outside_zone_note)

    # Use the Idempotency-Key as the event's request_id so the frontend
    # can correlate server events with offline-queue items for dedup.
    # Fall back to the x-request-id header if no idempotency key was sent.
    effective_request_id = (
        idempotency_key.strip() if idempotency_key else request_id
    )

    if mode not in (EntryAction.ADD, EntryAction.SET):
        raise HTTPException(status_code=400, detail="mode must be 'add' or 'set'")

    # 1) попытка вставки
    quantity_value = float(payload.quantity)
    _validate_item_quantity(item, quantity_value)
    if mode == EntryAction.ADD:
        initial_quantity = quantity_value
    else:
        initial_quantity = quantity_value

    entry = InventoryEntry(
        session_id=session_id,
        item_id=payload.item_id,
        quantity=initial_quantity,
        version=1,
        counted_outside_zone=counted_outside_zone,
        counted_by_zone_id=counted_by_zone_id if counted_outside_zone else None,
        station_id=station_id,
        outside_zone_note=outside_zone_note if counted_outside_zone else None,
        updated_by_user_id=current_user.id,
        updated_at=_utc_now(),
    )

    try:
        db.add(entry)
        now = _utc_now()
        session.updated_at = now
        _touch_item_usage_stats(db, session.warehouse_id, payload.item_id, now)
        _create_entry_event(
            db=db,
            session_id=session_id,
            item_id=payload.item_id,
            actor_user_id=current_user.id,
            action=mode,
            reason=normalized_reason,
            station_id=station_id,
            counted_outside_zone=counted_outside_zone,
            counted_by_zone_id=counted_by_zone_id,
            outside_zone_note=outside_zone_note,
            request_id=effective_request_id,
            before_quantity=None,
            after_quantity=initial_quantity,
            created_at=now,
        )
        db.commit()
        db.refresh(entry)
        entry = (
            db.query(InventoryEntry)
            .options(
                joinedload(InventoryEntry.item),
                joinedload(InventoryEntry.counted_by_zone),
                joinedload(InventoryEntry.station),
            )
            .filter(InventoryEntry.id == entry.id)
            .first()
        )
        response_payload = _entry_to_out(entry)
        if idempotency_key:
            serializable_payload = jsonable_encoder(response_payload)
            db.add(
                IdempotencyKey(
                    user_id=current_user.id,
                    endpoint=endpoint,
                    idempotency_key=idempotency_key.strip(),
                    request_hash=request_hash,
                    response_status=200,
                    response_body=json.dumps(serializable_payload, ensure_ascii=False),
                )
            )
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
        return response_payload

    except IntegrityError:
        db.rollback()

        # 2) конфликт: значит запись уже есть → обновляем
        existing = (
            db.query(InventoryEntry)
            .filter(
                InventoryEntry.session_id == session_id,
                InventoryEntry.item_id == payload.item_id,
            )
            .with_for_update()
            .first()
        )
        if not existing:
            raise HTTPException(status_code=409, detail="Entry conflict")

        # Version conflict check for set mode with expected_version
        if (
            mode == EntryAction.SET
            and payload.expected_version is not None
            and int(existing.version) != payload.expected_version
        ):
            _raise_api_error(
                409,
                "VERSION_CONFLICT",
                "Version conflict. Refresh and retry",
            )

        if mode == EntryAction.ADD:
            new_quantity = float(existing.quantity) + quantity_value
        else:
            new_quantity = quantity_value

        _validate_item_quantity(item, new_quantity)
        before_quantity = float(existing.quantity)
        existing.quantity = new_quantity
        existing.version = int(existing.version) + 1
        existing.counted_outside_zone = counted_outside_zone
        existing.counted_by_zone_id = (
            counted_by_zone_id if counted_outside_zone else None
        )
        existing.station_id = station_id
        existing.outside_zone_note = outside_zone_note if counted_outside_zone else None

        existing.updated_by_user_id = current_user.id
        now = _utc_now()
        existing.updated_at = now
        session.updated_at = now
        _touch_item_usage_stats(db, session.warehouse_id, payload.item_id, now)
        _create_entry_event(
            db=db,
            session_id=session_id,
            item_id=payload.item_id,
            actor_user_id=current_user.id,
            action=mode,
            reason=normalized_reason,
            station_id=station_id,
            counted_outside_zone=counted_outside_zone,
            counted_by_zone_id=counted_by_zone_id,
            outside_zone_note=outside_zone_note,
            request_id=effective_request_id,
            before_quantity=before_quantity,
            after_quantity=new_quantity,
            created_at=now,
        )
        db.add(existing)
        db.commit()

        db.refresh(existing)
        entry = (
            db.query(InventoryEntry)
            .options(
                joinedload(InventoryEntry.item),
                joinedload(InventoryEntry.counted_by_zone),
                joinedload(InventoryEntry.station),
            )
            .filter(InventoryEntry.id == existing.id)
            .first()
        )
        response_payload = _entry_to_out(entry)
        if idempotency_key:
            serializable_payload = jsonable_encoder(response_payload)
            db.add(
                IdempotencyKey(
                    user_id=current_user.id,
                    endpoint=endpoint,
                    idempotency_key=idempotency_key.strip(),
                    request_hash=request_hash,
                    response_status=200,
                    response_body=json.dumps(serializable_payload, ensure_ascii=False),
                )
            )
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
        return response_payload


@router.patch(
    "/sessions/{session_id}/entries/{item_id}", response_model=InventoryEntryOut
)
def patch_entry(
    session_id: int,
    item_id: int,
    payload: InventoryEntryPatch,
    if_match: str | None = Header(default=None, alias="If-Match"),
    request_id: str | None = Header(default=None, alias="x-request-id"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    session = _get_session_or_404(
        db=db, session_id=session_id, current_user=current_user
    )
    is_closed = _is_session_closed(session)
    if is_closed and not _can_edit_closed_revision(current_user):
        _raise_api_error(409, "SESSION_CLOSED", "Session is closed")

    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if not item.is_active:
        _raise_api_error(409, "ITEM_INACTIVE", "Item is inactive")
    if item.warehouse_id != session.warehouse_id:
        raise HTTPException(
            status_code=400, detail="Item does not belong to session warehouse"
        )

    expected_from_header = _parse_if_match_version(if_match)
    expected_from_body = payload.version
    if expected_from_header is None and expected_from_body is None:
        raise HTTPException(
            status_code=422, detail="Provide If-Match header or version in request body"
        )
    if (
        expected_from_header is not None
        and expected_from_body is not None
        and expected_from_header != expected_from_body
    ):
        raise HTTPException(
            status_code=409, detail="If-Match and body version mismatch"
        )
    expected_version = (
        expected_from_header if expected_from_header is not None else expected_from_body
    )

    existing = (
        db.query(InventoryEntry)
        .filter(
            InventoryEntry.session_id == session_id,
            InventoryEntry.item_id == item_id,
        )
        .with_for_update()
        .first()
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Entry not found")

    current_version = int(existing.version)
    if current_version != int(expected_version):
        _raise_api_error(409, "VERSION_CONFLICT", "Version conflict. Refresh and retry")

    new_quantity = float(payload.quantity)
    _validate_item_quantity(item, new_quantity)

    before_quantity = float(existing.quantity)
    now = _utc_now()
    normalized_reason = _normalize_reason(payload.reason)
    counted_outside_zone = bool(payload.counted_outside_zone)
    counted_by_zone_id = _resolve_counted_by_zone_id(
        db=db,
        warehouse_id=session.warehouse_id,
        counted_outside_zone=counted_outside_zone,
    )
    station_id = _resolve_station_id(
        db=db,
        current_user=current_user,
        requested_station_id=payload.station_id,
    )
    outside_zone_note = _normalize_outside_zone_note(payload.outside_zone_note)
    action = EntryAction.CORRECT_AFTER_CLOSE if is_closed else EntryAction.PATCH
    existing.quantity = new_quantity
    existing.version = current_version + 1
    existing.counted_outside_zone = counted_outside_zone
    existing.counted_by_zone_id = counted_by_zone_id if counted_outside_zone else None
    existing.station_id = station_id
    existing.outside_zone_note = outside_zone_note if counted_outside_zone else None
    existing.updated_by_user_id = current_user.id
    existing.updated_at = now
    session.updated_at = now
    _touch_item_usage_stats(db, session.warehouse_id, item_id, now)
    _create_entry_event(
        db=db,
        session_id=session_id,
        item_id=item_id,
        actor_user_id=current_user.id,
        action=action,
        reason=normalized_reason,
        station_id=station_id,
        counted_outside_zone=counted_outside_zone,
        counted_by_zone_id=counted_by_zone_id,
        outside_zone_note=outside_zone_note,
        request_id=request_id,
        before_quantity=before_quantity,
        after_quantity=new_quantity,
        created_at=now,
    )
    log_audit(
        db,
        actor_id=current_user.id,
        action=AuditAction.ENTRY_CORRECTED if is_closed else AuditAction.ENTRY_UPDATED,
        entity_type="entry",
        entity_id=existing.id,
        warehouse_id=session.warehouse_id,
        metadata={
            "session_id": session_id,
            "item_id": item_id,
            "item_name": item.name,
            "before_qty": before_quantity,
            "after_qty": new_quantity,
        },
    )
    db.add(existing)
    db.commit()

    db.refresh(existing)
    entry = (
        db.query(InventoryEntry)
        .options(
            joinedload(InventoryEntry.item),
            joinedload(InventoryEntry.counted_by_zone),
            joinedload(InventoryEntry.station),
        )
        .filter(InventoryEntry.id == existing.id)
        .first()
    )
    return _entry_to_out(entry)


@router.delete(
    "/sessions/{session_id}/entries/{item_id}", status_code=204
)
def delete_entry(
    session_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    session = _get_session_or_404(
        db=db, session_id=session_id, current_user=current_user
    )
    is_closed = _is_session_closed(session)
    if is_closed and not _can_edit_closed_revision(current_user):
        _raise_api_error(409, "SESSION_CLOSED", "Session is closed")

    existing = (
        db.query(InventoryEntry)
        .filter(
            InventoryEntry.session_id == session_id,
            InventoryEntry.item_id == item_id,
        )
        .with_for_update()
        .first()
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Entry not found")

    before_quantity = float(existing.quantity)
    now = _utc_now()
    _create_entry_event(
        db=db,
        session_id=session_id,
        item_id=item_id,
        actor_user_id=current_user.id,
        action=EntryAction.DELETE,
        reason=None,
        station_id=existing.station_id,
        counted_outside_zone=bool(existing.counted_outside_zone),
        counted_by_zone_id=existing.counted_by_zone_id,
        outside_zone_note=existing.outside_zone_note,
        request_id=None,
        before_quantity=before_quantity,
        after_quantity=0,
        created_at=now,
    )
    item_name = db.query(Item.name).filter(Item.id == item_id).scalar()
    log_audit(
        db,
        actor_id=current_user.id,
        action=AuditAction.ENTRY_DELETED,
        entity_type="entry",
        entity_id=existing.id,
        warehouse_id=session.warehouse_id,
        metadata={
            "session_id": session_id,
            "item_id": item_id,
            "item_name": item_name,
            "before_qty": before_quantity,
        },
    )
    db.delete(existing)
    session.updated_at = now
    db.commit()
    return Response(status_code=204)


@router.get("/sessions/{session_id}/audit", response_model=list[InventoryEntryEventOut])
def session_audit(
    session_id: int,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_audit_view_role(current_user)
    _get_session_or_404(db=db, session_id=session_id, current_user=current_user)

    rows = (
        db.query(InventoryEntryEvent, Item.name, User.username, User.full_name)
        .join(Item, Item.id == InventoryEntryEvent.item_id)
        .join(User, User.id == InventoryEntryEvent.actor_user_id)
        .filter(InventoryEntryEvent.session_id == session_id)
        .order_by(InventoryEntryEvent.created_at.desc(), InventoryEntryEvent.id.desc())
        .limit(min(max(limit, 1), 1000))
        .all()
    )

    return [
        _event_to_out(
            event,
            item_name,
            actor_username,
            _build_user_display_name(
                full_name=str(actor_full_name) if actor_full_name else None,
                username=str(actor_username) if actor_username else None,
            ),
        )
        for event, item_name, actor_username, actor_full_name in rows
    ]


@router.get(
    "/entries/{session_id}/{item_id}/audit", response_model=list[InventoryEntryEventOut]
)
def entry_audit(
    session_id: int,
    item_id: int,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_audit_view_role(current_user)
    _get_session_or_404(db=db, session_id=session_id, current_user=current_user)

    rows = (
        db.query(InventoryEntryEvent, Item.name, User.username, User.full_name)
        .join(Item, Item.id == InventoryEntryEvent.item_id)
        .join(User, User.id == InventoryEntryEvent.actor_user_id)
        .filter(
            InventoryEntryEvent.session_id == session_id,
            InventoryEntryEvent.item_id == item_id,
        )
        .order_by(InventoryEntryEvent.created_at.desc(), InventoryEntryEvent.id.desc())
        .limit(min(max(limit, 1), 1000))
        .all()
    )

    return [
        _event_to_out(
            event,
            item_name,
            actor_username,
            _build_user_display_name(
                full_name=str(actor_full_name) if actor_full_name else None,
                username=str(actor_username) if actor_username else None,
            ),
        )
        for event, item_name, actor_username, actor_full_name in rows
    ]


@router.get("/sessions/{session_id}/audit-log", response_model=list[AuditLogOut])
def session_audit_log(
    session_id: int,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Centralized audit log for a session (all entity types)."""
    _require_audit_view_role(current_user)
    session = _get_session_or_404(db=db, session_id=session_id, current_user=current_user)

    rows = (
        db.query(AuditLog, User.username, User.full_name)
        .join(User, User.id == AuditLog.actor_id)
        .filter(
            (
                (AuditLog.entity_type == "session")
                & (AuditLog.entity_id == session_id)
            )
            | (
                (AuditLog.entity_type == "entry")
                & (AuditLog.warehouse_id == session.warehouse_id)
            )
        )
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(min(max(limit, 1), 1000))
        .all()
    )

    results: list[AuditLogOut] = []
    for audit, username, full_name in rows:
        display = _build_user_display_name(
            full_name=str(full_name) if full_name else None,
            username=str(username) if username else None,
        )
        results.append(
            AuditLogOut(
                id=audit.id,
                actor_id=audit.actor_id,
                actor_username=username,
                actor_display_name=display,
                action=audit.action,
                entity_type=audit.entity_type,
                entity_id=audit.entity_id,
                warehouse_id=audit.warehouse_id,
                metadata_json=audit.metadata_json,
                created_at=audit.created_at,
                previous_hash=audit.previous_hash,
                hash=audit.hash,
            )
        )
    return results


@router.get("/audit-log/verify")
def verify_audit_log(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Verify the hash-chain integrity of the entire audit log."""
    _require_audit_view_role(current_user)
    return verify_audit_chain(db)


@router.get("/audit", response_model=list[InventoryEntryEventOut])
def audit_events(
    warehouse_id: int | None = None,
    session_id: int | None = None,
    item_id: int | None = None,
    actor_user_id: int | None = None,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_audit_view_role(current_user)
    user_warehouse_id = _require_user_warehouse_id(current_user)

    if warehouse_id is not None and int(warehouse_id) != user_warehouse_id:
        raise HTTPException(status_code=403, detail="Forbidden for this warehouse")

    query = (
        db.query(InventoryEntryEvent, Item.name, User.username, User.full_name)
        .join(Item, Item.id == InventoryEntryEvent.item_id)
        .join(User, User.id == InventoryEntryEvent.actor_user_id)
        .join(InventorySession, InventorySession.id == InventoryEntryEvent.session_id)
    )

    if warehouse_id is not None:
        query = query.filter(InventorySession.warehouse_id == warehouse_id)
    else:
        query = query.filter(InventorySession.warehouse_id == user_warehouse_id)
    if session_id is not None:
        query = query.filter(InventoryEntryEvent.session_id == session_id)
    if item_id is not None:
        query = query.filter(InventoryEntryEvent.item_id == item_id)
    if actor_user_id is not None:
        query = query.filter(InventoryEntryEvent.actor_user_id == actor_user_id)

    rows = (
        query.order_by(
            InventoryEntryEvent.created_at.desc(), InventoryEntryEvent.id.desc()
        )
        .limit(min(max(limit, 1), 1000))
        .all()
    )

    return [
        _event_to_out(
            event,
            item_name,
            actor_username,
            _build_user_display_name(
                full_name=str(actor_full_name) if actor_full_name else None,
                username=str(actor_username) if actor_username else None,
            ),
        )
        for event, item_name, actor_username, actor_full_name in rows
    ]


@router.get(
    "/sessions/{session_id}/entries/recent", response_model=list[InventoryEntryOut]
)
def recent_entries(
    session_id: int,
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    session = _get_session_or_404(
        db=db, session_id=session_id, current_user=current_user
    )

    if _is_session_closed(session):
        _raise_api_error(409, "SESSION_CLOSED", "Session is closed")

    entries = (
        db.query(InventoryEntry)
        .options(
            joinedload(InventoryEntry.item),
            joinedload(InventoryEntry.counted_by_zone),
            joinedload(InventoryEntry.station),
        )
        .filter(InventoryEntry.session_id == session_id)
        .order_by(InventoryEntry.updated_at.desc(), InventoryEntry.id.desc())
        .limit(min(max(limit, 1), 50))
        .all()
    )

    return [_entry_to_out(e) for e in entries]


@router.get(
    "/sessions/{session_id}/entries/recent-events",
    response_model=list[InventoryRecentEventOut],
)
def recent_entry_events(
    session_id: int,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    session = _get_session_or_404(
        db=db, session_id=session_id, current_user=current_user
    )

    if _is_session_closed(session):
        _raise_api_error(409, "SESSION_CLOSED", "Session is closed")

    rows = (
        db.query(
            InventoryEntryEvent,
            Item.name,
            Item.unit,
            User.username,
            User.full_name,
            Zone.name,
            Station.name,
            Station.department,
        )
        .join(Item, Item.id == InventoryEntryEvent.item_id)
        .join(User, User.id == InventoryEntryEvent.actor_user_id)
        .outerjoin(Zone, Zone.id == InventoryEntryEvent.counted_by_zone_id)
        .outerjoin(Station, Station.id == InventoryEntryEvent.station_id)
        .filter(InventoryEntryEvent.session_id == session_id)
        .order_by(InventoryEntryEvent.created_at.desc(), InventoryEntryEvent.id.desc())
        .limit(min(max(limit, 1), 200))
        .all()
    )

    payload = []
    for (
        event,
        item_name,
        unit,
        actor_username,
        actor_full_name,
        zone_name,
        station_name,
        station_department,
    ) in rows:
        payload.append(
            _recent_event_to_out(
                event=event,
                item_name=str(item_name),
                unit=str(unit),
                actor_username=str(actor_username) if actor_username else None,
                actor_display_name=_build_user_display_name(
                    full_name=str(actor_full_name) if actor_full_name else None,
                    username=str(actor_username) if actor_username else None,
                ),
                counted_by_zone=str(zone_name) if zone_name else None,
                station_name=str(station_name) if station_name else None,
                station_department=(
                    str(station_department.value)
                    if station_department is not None
                    and hasattr(station_department, "value")
                    else (
                        str(station_department)
                        if station_department is not None
                        else None
                    )
                ),
            )
        )

    return payload


@router.post("/sessions/{session_id}/close", response_model=InventorySessionOut)
def close_session(
    session_id: int,
    request_id: str | None = Header(default=None, alias="x-request-id"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    session = _get_session_or_404(
        db=db, session_id=session_id, current_user=current_user
    )
    _require_revision_manage_role(current_user)
    if session.status != SessionStatus.DRAFT or getattr(session, "is_closed", False):
        return session

    now = _utc_now()
    session.status = SessionStatus.CLOSED
    session.is_closed = True
    session.updated_at = now

    try:
        _snapshot_session_totals(db, session_id)
        _create_session_event(
            db=db,
            session_id=session_id,
            actor_user_id=current_user.id,
            action=SessionEventAction.SESSION_CLOSED,
            request_id=request_id,
            reason=None,
            created_at=now,
        )
        log_audit(
            db,
            actor_id=current_user.id,
            action=AuditAction.REVISION_CLOSED,
            entity_type="session",
            entity_id=session_id,
            warehouse_id=session.warehouse_id,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        log.warning(
            "session_close_integrity_error",
            extra={
                "event": "session_close_integrity_error",
                "session_id": session_id,
                "request_id": request_id,
                "error": str(getattr(exc, "orig", exc)),
            },
        )
        _raise_api_error(
            409, "SESSION_CLOSE_CONFLICT", "Cannot close session due to data conflict"
        )
    except Exception:
        db.rollback()
        log.exception(
            "session_close_failed",
            extra={
                "event": "session_close_failed",
                "session_id": session_id,
                "request_id": request_id,
            },
        )
        _raise_api_error(
            500,
            "SESSION_CLOSE_FAILED",
            "Failed to close session",
            details={"request_id": request_id},
        )

    db.refresh(session)
    log.info(
        "session_closed",
        extra={
            "session_id": session.id,
            "warehouse_id": session.warehouse_id,
            "user_id": current_user.id,
        },
    )

    return session


@router.post("/sessions/{session_id}/reopen", response_model=InventorySessionOut)
def reopen_session(
    session_id: int,
    request_id: str | None = Header(default=None, alias="x-request-id"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    session = _get_session_or_404(
        db=db, session_id=session_id, current_user=current_user
    )
    _require_revision_manage_role(current_user)

    is_closed = _is_session_closed(session)
    if not is_closed:
        _raise_api_error(
            409, "SESSION_NOT_CLOSED", "Only closed revision can be reopened"
        )

    # Check no other draft session exists for this warehouse
    existing_draft = (
        db.query(InventorySession.id)
        .filter(
            InventorySession.warehouse_id == session.warehouse_id,
            InventorySession.status == SessionStatus.DRAFT,
            InventorySession.deleted_at.is_(None),
            InventorySession.id != session_id,
        )
        .first()
    )
    if existing_draft:
        _raise_api_error(
            409,
            "ACTIVE_SESSION_EXISTS",
            "Cannot reopen: another active session already exists for this warehouse",
        )

    now = _utc_now()
    session.status = SessionStatus.DRAFT
    session.is_closed = False
    session.updated_at = now

    try:
        _create_session_event(
            db=db,
            session_id=session_id,
            actor_user_id=current_user.id,
            action=SessionEventAction.REVISION_REOPENED,
            request_id=request_id,
            reason=None,
            created_at=now,
        )
        log_audit(
            db,
            actor_id=current_user.id,
            action=AuditAction.REVISION_REOPENED,
            entity_type="session",
            entity_id=session_id,
            warehouse_id=session.warehouse_id,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        log.warning(
            "session_reopen_integrity_error",
            extra={
                "event": "session_reopen_integrity_error",
                "session_id": session_id,
                "request_id": request_id,
                "error": str(getattr(exc, "orig", exc)),
            },
        )
        _raise_api_error(
            409,
            "SESSION_REOPEN_CONFLICT",
            "Cannot reopen session due to data conflict",
        )
    except Exception:
        db.rollback()
        log.exception(
            "session_reopen_failed",
            extra={
                "event": "session_reopen_failed",
                "session_id": session_id,
                "request_id": request_id,
            },
        )
        _raise_api_error(
            500,
            "SESSION_REOPEN_FAILED",
            "Failed to reopen session",
            details={"request_id": request_id},
        )

    db.refresh(session)
    log.info(
        "session_reopened",
        extra={
            "session_id": session.id,
            "warehouse_id": session.warehouse_id,
            "user_id": current_user.id,
        },
    )
    return session


@router.delete("/sessions/{session_id}", status_code=204)
def soft_delete_session(
    session_id: int,
    reason: str | None = Query(default=None, max_length=500),
    request_id: str | None = Header(default=None, alias="x-request-id"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_revision_manage_role(current_user)
    session = _get_session_or_404(
        db=db, session_id=session_id, current_user=current_user
    )

    is_closed = _is_session_closed(session)
    if not is_closed:
        _raise_api_error(
            409, "SESSION_NOT_CLOSED", "Only closed revision can be deleted"
        )

    now = _utc_now()
    session.deleted_at = now
    session.updated_at = now
    _create_session_event(
        db=db,
        session_id=session.id,
        actor_user_id=current_user.id,
        action=SessionEventAction.SESSION_DELETED,
        request_id=request_id,
        reason=_normalize_reason(reason),
        created_at=now,
    )
    log_audit(
        db,
        actor_id=current_user.id,
        action=AuditAction.REVISION_DELETED,
        entity_type="session",
        entity_id=session.id,
        warehouse_id=session.warehouse_id,
        metadata={"reason": reason} if reason else None,
    )

    db.commit()
    return Response(status_code=204)


@router.post("/sessions/active", response_model=InventorySessionOut)
def get_or_create_active_session(
    payload: ActiveSessionRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_warehouse_param_access(payload.warehouse_id, current_user)

    # 1) проверяем что склад существует
    warehouse = db.query(Warehouse).filter(Warehouse.id == payload.warehouse_id).first()
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    # 2) ищем активную draft-сессию
    active = (
        db.query(InventorySession)
        .filter(
            InventorySession.warehouse_id == payload.warehouse_id,
            InventorySession.status == SessionStatus.DRAFT,
            InventorySession.deleted_at.is_(None),
        )
        .order_by(InventorySession.id.desc())
        .first()
    )

    if active:
        return active

    if not payload.create_if_missing:
        raise HTTPException(status_code=404, detail="Active session not found")

    _require_revision_manage_role(current_user)

    try:
        return _create_draft_session(
            db=db, warehouse_id=payload.warehouse_id, user_id=current_user.id
        )
    except IntegrityError as exc:
        if _is_active_session_unique_violation(exc):
            active = (
                db.query(InventorySession)
                .filter(
                    InventorySession.warehouse_id == payload.warehouse_id,
                    InventorySession.status == SessionStatus.DRAFT,
                    InventorySession.deleted_at.is_(None),
                )
                .order_by(InventorySession.id.desc())
                .first()
            )
            if active:
                return active
            raise HTTPException(
                status_code=409,
                detail="Active session already exists for this warehouse",
            )
        raise


@router.get("/reports/session/{session_id}", response_model=InventorySessionReportOut)
def session_report(
    session_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    session = _get_session_or_404(
        db=db, session_id=session_id, current_user=current_user
    )

    is_closed = _is_session_closed(session)
    rows = _collect_session_rows(
        db=db, session_id=session_id, prefer_snapshot=is_closed
    )

    items = [
        {
            "item_id": item_id,
            "item_name": item_name,
            "unit": unit,
            "quantity": quantity,
        }
        for item_id, item_name, unit, quantity in sorted(
            rows, key=lambda row: row[1].lower()
        )
    ]

    return {
        "session_id": session.id,
        "warehouse_id": session.warehouse_id,
        "status": session.status,
        "is_closed": is_closed,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "items": items,
    }


@router.get(
    "/sessions/{session_id}/items/{item_id}/contributors",
    response_model=InventoryItemContributorsOut,
)
def session_item_contributors(
    session_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _get_session_or_404(db=db, session_id=session_id, current_user=current_user)

    entry_row = (
        db.query(InventoryEntry, Item)
        .join(Item, Item.id == InventoryEntry.item_id)
        .filter(
            InventoryEntry.session_id == session_id,
            InventoryEntry.item_id == item_id,
        )
        .first()
    )
    if not entry_row:
        raise HTTPException(status_code=404, detail="Item not found in session")

    entry, item = entry_row
    contributors_rows = (
        db.query(
            InventoryEntryEvent.actor_user_id,
            User.username,
            User.full_name,
            func.sum(
                InventoryEntryEvent.after_quantity
                - func.coalesce(InventoryEntryEvent.before_quantity, 0.0)
            ).label("qty"),
            func.count(InventoryEntryEvent.id).label("actions_count"),
            func.max(InventoryEntryEvent.created_at).label("last_activity_at"),
        )
        .join(User, User.id == InventoryEntryEvent.actor_user_id)
        .filter(
            InventoryEntryEvent.session_id == session_id,
            InventoryEntryEvent.item_id == item_id,
            InventoryEntryEvent.action == EntryAction.ADD,
        )
        .group_by(InventoryEntryEvent.actor_user_id, User.username, User.full_name)
        .order_by(func.max(InventoryEntryEvent.created_at).desc())
        .all()
    )

    contributors: list[dict] = []
    for (
        actor_user_id,
        actor_username,
        actor_full_name,
        qty,
        actions_count,
        _last_activity_at,
    ) in contributors_rows:
        display_name = _build_user_display_name(
            full_name=str(actor_full_name) if actor_full_name else None,
            username=str(actor_username) if actor_username else None,
        )
        if not display_name:
            continue
        contributors.append(
            {
                "actor_user_id": int(actor_user_id),
                "actor_username": str(actor_username) if actor_username else None,
                "actor_display_name": display_name,
                "qty": _normalize_qty_for_api(qty, unit=str(item.unit)),
                "actions_count": int(actions_count or 0),
            }
        )

    correction_rows = (
        db.query(
            InventoryEntryEvent.actor_user_id,
            User.username,
            User.full_name,
            func.sum(
                InventoryEntryEvent.after_quantity
                - func.coalesce(InventoryEntryEvent.before_quantity, 0.0)
            ).label("quantity_delta"),
            func.count(InventoryEntryEvent.id).label("events_count"),
            func.max(InventoryEntryEvent.created_at).label("last_activity_at"),
        )
        .join(User, User.id == InventoryEntryEvent.actor_user_id)
        .filter(
            InventoryEntryEvent.session_id == session_id,
            InventoryEntryEvent.item_id == item_id,
            InventoryEntryEvent.action != EntryAction.ADD,
        )
        .group_by(InventoryEntryEvent.actor_user_id, User.username, User.full_name)
        .order_by(func.max(InventoryEntryEvent.created_at).desc())
        .all()
    )

    corrections: list[dict] = []
    for (
        actor_user_id,
        actor_username,
        actor_full_name,
        quantity_delta,
        events_count,
        _last_activity_at,
    ) in correction_rows:
        display_name = _build_user_display_name(
            full_name=str(actor_full_name) if actor_full_name else None,
            username=str(actor_username) if actor_username else None,
        )
        if not display_name:
            continue
        corrections.append(
            {
                "actor_user_id": int(actor_user_id),
                "actor_username": str(actor_username) if actor_username else None,
                "actor_display_name": display_name,
                "quantity_delta": _normalize_qty_for_api(
                    quantity_delta, unit=str(item.unit)
                ),
                "events_count": int(events_count or 0),
            }
        )

    return {
        "session_id": int(session_id),
        "item_id": int(item_id),
        "item_name": str(item.name),
        "unit": str(item.unit),
        "total_quantity": _normalize_qty_for_api(entry.quantity, unit=str(item.unit)),
        "contributors_count": len(contributors),
        "contributors": contributors,
        "corrections_total_delta": _normalize_qty_for_api(
            sum(row["quantity_delta"] for row in corrections), unit=str(item.unit)
        ),
        "corrections": corrections,
    }


@router.get(
    "/sessions/{session_id}/participants",
    response_model=InventoryParticipantsSummaryOut,
)
def session_participants_summary(
    session_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _get_session_or_404(db=db, session_id=session_id, current_user=current_user)

    add_unit_rows = (
        db.query(
            InventoryEntryEvent.actor_user_id,
            User.username,
            User.full_name,
            Item.unit,
            func.sum(
                InventoryEntryEvent.after_quantity
                - func.coalesce(InventoryEntryEvent.before_quantity, 0.0)
            ).label("quantity_added"),
            func.count(InventoryEntryEvent.id).label("events_count"),
        )
        .join(User, User.id == InventoryEntryEvent.actor_user_id)
        .join(Item, Item.id == InventoryEntryEvent.item_id)
        .filter(
            InventoryEntryEvent.session_id == session_id,
            InventoryEntryEvent.action == EntryAction.ADD,
        )
        .group_by(
            InventoryEntryEvent.actor_user_id, User.username, User.full_name, Item.unit
        )
        .all()
    )

    add_actor_rows = (
        db.query(
            InventoryEntryEvent.actor_user_id,
            User.username,
            User.full_name,
            func.count(func.distinct(InventoryEntryEvent.item_id)).label(
                "touched_items_count"
            ),
            func.count(InventoryEntryEvent.id).label("actions_count"),
            func.max(InventoryEntryEvent.created_at).label("last_activity_at"),
        )
        .join(User, User.id == InventoryEntryEvent.actor_user_id)
        .filter(
            InventoryEntryEvent.session_id == session_id,
            InventoryEntryEvent.action == EntryAction.ADD,
        )
        .group_by(InventoryEntryEvent.actor_user_id, User.username, User.full_name)
        .all()
    )

    corrections_rows = (
        db.query(
            InventoryEntryEvent.actor_user_id,
            User.username,
            User.full_name,
            func.sum(
                InventoryEntryEvent.after_quantity
                - func.coalesce(InventoryEntryEvent.before_quantity, 0.0)
            ).label("quantity_delta"),
            func.count(InventoryEntryEvent.id).label("events_count"),
        )
        .join(User, User.id == InventoryEntryEvent.actor_user_id)
        .filter(
            InventoryEntryEvent.session_id == session_id,
            InventoryEntryEvent.action != EntryAction.ADD,
        )
        .group_by(InventoryEntryEvent.actor_user_id, User.username, User.full_name)
        .all()
    )

    summary_by_actor: dict[int, dict] = {}

    def ensure_actor(
        actor_user_id: int, actor_username: str | None, actor_full_name: str | None
    ) -> dict:
        actor_key = int(actor_user_id)
        existing = summary_by_actor.get(actor_key)
        if existing is not None:
            return existing
        display_name = (
            _build_user_display_name(
                full_name=str(actor_full_name) if actor_full_name else None,
                username=str(actor_username) if actor_username else None,
            )
            or "—"
        )
        payload = {
            "actor_user_id": actor_key,
            "actor_username": str(actor_username) if actor_username else None,
            "actor_display_name": display_name,
            "touched_items_count": 0,
            "actions_count": 0,
            "last_activity_at": None,
            "kg": 0.0,
            "l": 0.0,
            "pcs": 0.0,
            "corrections_total_delta": 0.0,
            "corrections_events_count": 0,
        }
        summary_by_actor[actor_key] = payload
        return payload

    for (
        actor_user_id,
        actor_username,
        actor_full_name,
        touched_items_count,
        actions_count,
        last_activity_at,
    ) in add_actor_rows:
        actor_payload = ensure_actor(actor_user_id, actor_username, actor_full_name)
        actor_payload["touched_items_count"] = int(touched_items_count or 0)
        actor_payload["actions_count"] = int(actions_count or 0)
        actor_payload["last_activity_at"] = last_activity_at

    for (
        actor_user_id,
        actor_username,
        actor_full_name,
        unit,
        quantity_added,
        _events_count,
    ) in add_unit_rows:
        actor_payload = ensure_actor(actor_user_id, actor_username, actor_full_name)
        normalized_unit = str(unit or "").strip().lower()
        qty_value = float(quantity_added or 0.0)
        if normalized_unit == "kg":
            actor_payload["kg"] = _normalize_qty_for_api(
                actor_payload["kg"] + qty_value, unit="kg"
            )
        elif normalized_unit == "l":
            actor_payload["l"] = _normalize_qty_for_api(
                actor_payload["l"] + qty_value, unit="l"
            )
        elif normalized_unit == "pcs":
            actor_payload["pcs"] = _normalize_qty_for_api(
                actor_payload["pcs"] + qty_value, unit="pcs"
            )

    for (
        actor_user_id,
        actor_username,
        actor_full_name,
        quantity_delta,
        events_count,
    ) in corrections_rows:
        actor_payload = ensure_actor(actor_user_id, actor_username, actor_full_name)
        actor_payload["corrections_total_delta"] = _normalize_qty_for_api(
            actor_payload["corrections_total_delta"] + float(quantity_delta or 0.0)
        )
        actor_payload["corrections_events_count"] += int(events_count or 0)

    participants = sorted(
        summary_by_actor.values(),
        key=lambda row: (
            str(row["actor_display_name"]).lower(),
            int(row["actor_user_id"]),
        ),
    )

    return {
        "session_id": int(session_id),
        "participants": participants,
    }


@router.get("/sessions/{session_id}/export")
def export_session_report(
    session_id: int,
    format: str = Query(default="xlsx", pattern="^(xlsx|csv)$"),
    template: str = Query(default="accounting_v1"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    template_to_version = {
        "accounting_v1": "v1",
    }
    report_version = template_to_version.get(template)
    if report_version is None:
        raise HTTPException(status_code=422, detail="Unsupported export template")

    session = _get_session_or_404(
        db=db, session_id=session_id, current_user=current_user
    )
    if not can_export(current_user.role):
        raise HTTPException(status_code=403, detail="Insufficient role to export")
    if not can_access_all_warehouses(current_user.role):
        _require_access_to_warehouse(session, current_user)

    if format == "xlsx":
        export_meta, catalog_rows = fetch_session_catalog_export_rows(
            db=db, session_id=session_id
        )
    else:
        export_meta, export_rows = fetch_session_export_rows(
            db=db, session_id=session_id
        )
    if not export_meta:
        raise HTTPException(status_code=404, detail="Session not found")

    status_label = (
        "CLOSED" if str(export_meta.session_status).lower() == "closed" else "DRAFT"
    )

    if format == "xlsx":
        template_rows: list[dict] = [
            {
                "ProductCode": row.product_code,
                "Item": row.name,
                "Unit": row.unit,
                "Qty": (None if row.qty is None else Decimal(str(row.qty))),
            }
            for row in catalog_rows
        ]
    else:
        entries_data: list[dict] = [
            {
                "ProductCode": row.product_code,
                "Zone": row.zone,
                "Warehouse": row.warehouse,
                "SessionId": row.session_id,
                "SessionStatus": status_label,
                "Item": row.item,
                "Unit": row.unit,
                "Qty": Decimal(str(row.qty)),
                "Category": (str(row.category).strip() or "Uncategorized"),
                "CountedOutsideZone": "⚠ outside zone"
                if row.counted_outside_zone
                else "",
                "CountedByZone": row.counted_by_zone_name
                if row.counted_outside_zone
                else "",
                "UpdatedAt": row.updated_at,
                "UpdatedBy": row.updated_by,
                "Station": row.station_name,
                "Department": row.station_department,
            }
            for row in export_rows
        ]

        entries_data.sort(
            key=lambda row: (str(row["Category"]).lower(), str(row["Item"]).lower())
        )

    session_closed_event = (
        db.query(InventorySessionEvent)
        .filter(
            InventorySessionEvent.session_id == session_id,
            InventorySessionEvent.action == SessionEventAction.SESSION_CLOSED,
        )
        .order_by(InventorySessionEvent.created_at.desc())
        .first()
    )
    _session_closed_at = (
        session_closed_event.created_at if session_closed_event else None
    )

    if format != "xlsx":
        total_qty_by_unit: dict[str, Decimal] = {}
        totals_by_category: dict[str, dict[str, Decimal | int]] = {}
        for row in entries_data:
            unit = str(row["Unit"])
            qty = Decimal(str(row["Qty"]))
            total_qty_by_unit[unit] = total_qty_by_unit.get(unit, Decimal("0")) + qty

            category = str(row["Category"] or "").strip()
            if category:
                if category not in totals_by_category:
                    totals_by_category[category] = {"lines": 0, "sum_qty": Decimal("0")}
                totals_by_category[category]["lines"] = (
                    int(totals_by_category[category]["lines"]) + 1
                )
                totals_by_category[category]["sum_qty"] = (
                    Decimal(str(totals_by_category[category]["sum_qty"])) + qty
                )

    status_value = str(export_meta.session_status)
    filename = build_export_filename(
        warehouse_name=export_meta.warehouse_name,
        session_created_at=export_meta.session_started_at,
        status=status_value,
        file_ext=format,
    )

    if format == "csv":
        payload = build_csv_export(entries_data)
        media_type = "text/csv; charset=utf-8"
    else:
        try:
            payload = build_xlsx_accounting_template_export(template_rows)
        except ValueError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
    }
    log_audit(
        db,
        actor_id=current_user.id,
        action=AuditAction.REVISION_EXPORTED,
        entity_type="session",
        entity_id=session_id,
        warehouse_id=session.warehouse_id,
        metadata={"format": format, "template": template},
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        log.warning("audit_commit_failed_export", extra={"session_id": session_id})
    return StreamingResponse(iter([payload]), media_type=media_type, headers=headers)


@router.get("/reports/diff", response_model=InventoryDiffReportOut)
def inventory_diff_report(
    warehouse_id: int,
    from_dt: datetime | None = Query(default=None, alias="from"),
    to_dt: datetime | None = Query(default=None, alias="to"),
    mode: str = Query(default="range", pattern="^(range|day_to_day)$"),
    day_local: date | None = Query(default=None),
    tz_offset_minutes: int = Query(default=0, ge=-720, le=840),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_warehouse_param_access(warehouse_id, current_user)

    warehouse_exists = (
        db.query(Warehouse.id).filter(Warehouse.id == warehouse_id).first()
    )
    if not warehouse_exists:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    resolved_day_local: str | None = None
    if mode == "range":
        if from_dt is None or to_dt is None:
            raise HTTPException(
                status_code=422, detail="'from' and 'to' are required for range mode"
            )
        current_from = _ensure_aware(from_dt)
        current_to = _ensure_aware(to_dt)
        if current_to <= current_from:
            raise HTTPException(
                status_code=422, detail="'to' must be greater than 'from'"
            )
    else:
        tz = timezone(timedelta(minutes=tz_offset_minutes))
        local_day = day_local or datetime.now(tz).date()
        local_start = datetime.combine(local_day, time.min, tzinfo=tz)
        local_end = local_start + timedelta(days=1)
        current_from = local_start.astimezone(timezone.utc)
        current_to = local_end.astimezone(timezone.utc)
        resolved_day_local = local_day.isoformat()

    window = current_to - current_from
    previous_to = current_from
    previous_from = current_from - window

    previous = _aggregate_window(
        db=db, warehouse_id=warehouse_id, from_dt=previous_from, to_dt=previous_to
    )
    current = _aggregate_window(
        db=db, warehouse_id=warehouse_id, from_dt=current_from, to_dt=current_to
    )

    all_item_ids = sorted(set(previous.keys()) | set(current.keys()))
    items: list[dict] = []
    for item_id in all_item_ids:
        prev_entry = previous.get(item_id)
        cur_entry = current.get(item_id)
        item_name = (cur_entry or prev_entry)["item_name"]
        unit = (cur_entry or prev_entry)["unit"]
        prev_qty = float(prev_entry["quantity"]) if prev_entry else 0.0
        cur_qty = float(cur_entry["quantity"]) if cur_entry else 0.0
        items.append(
            {
                "item_id": item_id,
                "item_name": item_name,
                "unit": unit,
                "previous_quantity": prev_qty,
                "current_quantity": cur_qty,
                "diff_quantity": cur_qty - prev_qty,
            }
        )

    items.sort(key=lambda row: abs(float(row["diff_quantity"])), reverse=True)

    total_previous = sum(float(row["previous_quantity"]) for row in items)
    total_current = sum(float(row["current_quantity"]) for row in items)
    return {
        "warehouse_id": warehouse_id,
        "from": current_from,
        "to": current_to,
        "previous_from": previous_from,
        "previous_to": previous_to,
        "mode": mode,
        "tz_offset_minutes": tz_offset_minutes if mode == "day_to_day" else None,
        "day_local": resolved_day_local,
        "items": items,
        "totals": {
            "previous_quantity": total_previous,
            "current_quantity": total_current,
            "diff_quantity": total_current - total_previous,
        },
    }


@router.get("/reports/diff/today", response_model=InventoryDiffReportOut)
def inventory_diff_today_report(
    warehouse_id: int,
    day_local: date | None = Query(default=None),
    tz_offset_minutes: int = Query(default=0, ge=-720, le=840),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return inventory_diff_report(
        warehouse_id=warehouse_id,
        from_dt=None,
        to_dt=None,
        mode="day_to_day",
        day_local=day_local,
        tz_offset_minutes=tz_offset_minutes,
        db=db,
        current_user=current_user,
    )
