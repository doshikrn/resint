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

from app.routers.inventory._helpers import (
    _aggregate_window,
    _build_user_display_name,
    _collect_session_rows,
    _ensure_aware,
    _get_session_or_404,
    _is_session_closed,
    _normalize_qty_for_api,
    _require_access_to_warehouse,
    _require_warehouse_param_access,
)

router = APIRouter()

log = logging.getLogger("app")


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
