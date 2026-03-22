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
    _build_user_display_name,
    _event_to_out,
    _get_session_or_404,
    _require_audit_view_role,
    _require_user_warehouse_id,
)

router = APIRouter()

log = logging.getLogger("app")


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


