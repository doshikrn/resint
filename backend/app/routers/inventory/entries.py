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
    _build_entries_request_hash,
    _build_entry_contributors_map,
    _build_user_display_name,
    _can_edit_closed_revision,
    _cleanup_expired_idempotency_keys,
    _create_entry_event,
    _entry_to_out,
    _event_to_out,
    _get_session_or_404,
    _get_stored_idempotent_response,
    _is_session_closed,
    _normalize_outside_zone_note,
    _normalize_reason,
    _parse_if_match_version,
    _raise_api_error,
    _recent_event_to_out,
    _resolve_counted_by_zone_id,
    _resolve_station_id,
    _touch_item_usage_stats,
    _validate_item_quantity,
)

router = APIRouter()

log = logging.getLogger("app")


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

    if is_closed:
        raw_reason = (payload.reason or "").strip() if payload.reason else ""
        if not raw_reason:
            _raise_api_error(
                422,
                "REASON_REQUIRED",
                "Reason is required for corrections after close",
            )

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


