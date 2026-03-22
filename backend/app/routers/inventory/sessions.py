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
    _build_catalog_etag,
    _build_user_display_name,
    _create_draft_session,
    _create_session_event,
    _get_session_or_404,
    _is_active_session_unique_violation,
    _is_session_closed,
    _normalize_etag,
    _normalize_qty_for_api,
    _normalize_reason,
    _raise_api_error,
    _require_revision_manage_role,
    _require_user_warehouse_id,
    _require_warehouse_param_access,
    _snapshot_session_totals,
)

router = APIRouter()

log = logging.getLogger("app")


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


