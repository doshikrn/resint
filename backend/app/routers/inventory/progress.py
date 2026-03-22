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
    _count_session_entered_items,
    _count_session_entered_items_by_user,
    _create_session_event,
    _ensure_zone_progress,
    _get_session_or_404,
    _is_session_closed,
    _load_zone_progress_snapshot,
    _normalize_zone_progress_state,
    _raise_api_error,
    _require_revision_manage_role,
    _require_user_warehouse_id,
    _zone_progress_to_out,
)

router = APIRouter()

log = logging.getLogger("app")


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


