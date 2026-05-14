"""Inventory revision analytics API (closed sessions, snapshot totals)."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.roles import can_view_inventory_analytics
from app.db.session import get_db
from app.models.user import User
from app.routers.inventory._auth import _require_warehouse_param_access
from app.schemas.analytics import (
    InventoryAnalyticsSummaryOut,
    InventoryDiffOut,
    InventoryProblemItemsOut,
    InventoryTrendsOut,
)
from app.services.analytics import (
    build_diff,
    build_problem_items,
    build_summary,
    build_trends,
)

router = APIRouter(prefix="/analytics/inventory", tags=["analytics-inventory"])


def _require_analytics_role(current_user: User = Depends(get_current_user)) -> User:
    if not can_view_inventory_analytics(current_user.role):
        raise HTTPException(status_code=403, detail="Insufficient role for inventory analytics")
    return current_user


def _parse_iso_dt(value: str | None) -> datetime | None:
    if not value or not value.strip():
        return None
    raw = value.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid datetime: {value}") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


@router.get("/summary", response_model=InventoryAnalyticsSummaryOut)
def inventory_summary(
    warehouse_id: int = Query(..., ge=1),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_analytics_role),
):
    _require_warehouse_param_access(warehouse_id, current_user)
    df = _parse_iso_dt(date_from)
    dt = _parse_iso_dt(date_to)
    return build_summary(db, warehouse_id, df, dt)


@router.get("/diff", response_model=InventoryDiffOut)
def inventory_diff(
    warehouse_id: int = Query(..., ge=1),
    session_previous_id: int = Query(..., ge=1),
    session_current_id: int = Query(..., ge=1),
    category_id: int | None = Query(default=None, ge=1),
    only_pf: bool = Query(default=False),
    min_abs_delta: float | None = Query(default=None, ge=0),
    search: str | None = Query(default=None, max_length=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_analytics_role),
):
    _require_warehouse_param_access(warehouse_id, current_user)
    return build_diff(
        db,
        warehouse_id,
        session_previous_id,
        session_current_id,
        category_id=category_id,
        only_pf=only_pf,
        min_abs_delta=min_abs_delta,
        search=search,
    )


@router.get("/trends", response_model=InventoryTrendsOut)
def inventory_trends(
    warehouse_id: int = Query(..., ge=1),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_analytics_role),
):
    _require_warehouse_param_access(warehouse_id, current_user)
    df = _parse_iso_dt(date_from)
    dt = _parse_iso_dt(date_to)
    return build_trends(db, warehouse_id, df, dt)


@router.get("/problem-items", response_model=InventoryProblemItemsOut)
def inventory_problem_items(
    warehouse_id: int = Query(..., ge=1),
    session_previous_id: int = Query(..., ge=1),
    session_current_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_analytics_role),
):
    _require_warehouse_param_access(warehouse_id, current_user)
    return build_problem_items(
        db,
        warehouse_id,
        session_previous_id,
        session_current_id,
    )
