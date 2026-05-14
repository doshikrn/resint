"""Pydantic schemas for inventory revision analytics (MVP)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ClosedSessionRef(BaseModel):
    id: int
    revision_no: int
    warehouse_id: int
    updated_at: datetime | None = None


class ProblemItemOut(BaseModel):
    item_id: int
    item_name: str
    unit: str
    abs_delta_qty: float


class InventoryAnalyticsSummaryOut(BaseModel):
    warehouse_id: int
    date_from: datetime | None = None
    date_to: datetime | None = None
    closed_sessions_count: int = 0
    last_session: ClosedSessionRef | None = None
    previous_session: ClosedSessionRef | None = None
    last_session_items_count: int = 0
    total_abs_delta_qty: float = 0.0
    unchanged_items_count: int = 0
    sharp_change_items_count: int = 0
    stagnant_items_count: int = 0
    top_problem_items: list[ProblemItemOut] = Field(default_factory=list)
    recent_closed_sessions: list[ClosedSessionRef] = Field(default_factory=list)


DiffClassification = Literal["increased", "decreased", "unchanged", "new", "disappeared"]


class InventoryDiffRowOut(BaseModel):
    item_id: int
    product_code: str | None = None
    item_name: str
    unit: str
    category: str | None = None
    is_pf: bool = False
    previous_qty: float | None = None
    current_qty: float | None = None
    delta_qty: float
    delta_percent: float | None = None
    classification: DiffClassification


class InventoryDiffOut(BaseModel):
    warehouse_id: int
    session_previous_id: int
    session_current_id: int
    rows: list[InventoryDiffRowOut] = Field(default_factory=list)


class TrendSessionPoint(BaseModel):
    session_id: int
    revision_no: int
    updated_at: datetime | None = None
    items_count: int = 0
    total_qty_sum: float = 0.0
    by_category: dict[str, float] = Field(default_factory=dict)


class InventoryTrendsOut(BaseModel):
    warehouse_id: int
    date_from: datetime | None = None
    date_to: datetime | None = None
    sessions: list[TrendSessionPoint] = Field(default_factory=list)


class InventoryProblemItemsOut(BaseModel):
    warehouse_id: int
    session_previous_id: int
    session_current_id: int
    top_abs_delta: list[ProblemItemOut] = Field(default_factory=list)
    top_increase: list[ProblemItemOut] = Field(default_factory=list)
    top_decrease: list[ProblemItemOut] = Field(default_factory=list)
