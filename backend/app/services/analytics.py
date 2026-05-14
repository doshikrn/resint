"""Inventory revision analytics — closed-session snapshots via ``inventory_session_totals``."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import func, inspect
from sqlalchemy.orm import Session

from app.models.enums import SessionStatus
from app.models.inventory_session import InventorySession
from app.models.inventory_session_total import InventorySessionTotal
from app.models.item import Item
from app.models.item_category import ItemCategory
from app.schemas.analytics import (
    ClosedSessionRef,
    InventoryAnalyticsSummaryOut,
    InventoryDiffOut,
    InventoryDiffRowOut,
    InventoryProblemItemsOut,
    InventoryTrendsOut,
    ProblemItemOut,
    TrendSessionPoint,
)
from app.services.export import is_semifinished_item

log = logging.getLogger(__name__)

SHARP_DELTA_PCT = 50.0


def _has_totals_table(db: Session) -> bool:
    try:
        conn = db.connection()
        return bool(inspect(conn).has_table(InventorySessionTotal.__tablename__))
    except Exception:
        return False


def session_is_closed(s: InventorySession) -> bool:
    return bool(s.is_closed) or str(s.status) == str(SessionStatus.CLOSED)


@dataclass
class Snap:
    item_id: int
    name: str
    product_code: str | None
    unit: str
    category: str | None
    category_id: int | None
    qty: float


def load_snapshot_map(db: Session, session_id: int) -> dict[int, Snap]:
    if not _has_totals_table(db):
        log.warning(
            "analytics_snapshot_skipped_missing_totals_table",
            extra={"event": "analytics_totals_missing", "session_id": session_id},
        )
        return {}
    rows = (
        db.query(
            Item.id,
            Item.name,
            Item.product_code,
            Item.unit,
            ItemCategory.name,
            Item.category_id,
            InventorySessionTotal.qty_final,
        )
        .join(InventorySessionTotal, InventorySessionTotal.item_id == Item.id)
        .outerjoin(ItemCategory, ItemCategory.id == Item.category_id)
        .filter(InventorySessionTotal.session_id == session_id)
        .all()
    )
    out: dict[int, Snap] = {}
    for item_id, name, pc, unit, cat_name, cat_id, qty in rows:
        out[int(item_id)] = Snap(
            item_id=int(item_id),
            name=str(name),
            product_code=str(pc) if pc is not None else None,
            unit=str(unit),
            category=str(cat_name) if cat_name is not None else None,
            category_id=int(cat_id) if cat_id is not None else None,
            qty=float(qty or 0),
        )
    return out


def get_session_strict(db: Session, session_id: int) -> InventorySession | None:
    return (
        db.query(InventorySession)
        .filter(InventorySession.id == session_id, InventorySession.deleted_at.is_(None))
        .first()
    )


def list_closed_sessions(
    db: Session,
    warehouse_id: int,
    date_from: datetime | None,
    date_to: datetime | None,
    limit: int = 80,
) -> list[InventorySession]:
    q = db.query(InventorySession).filter(
        InventorySession.warehouse_id == warehouse_id,
        InventorySession.deleted_at.is_(None),
        InventorySession.status == SessionStatus.CLOSED,
    )
    if date_from is not None:
        q = q.filter(InventorySession.updated_at >= date_from)
    if date_to is not None:
        q = q.filter(InventorySession.updated_at <= date_to)
    return (
        q.order_by(InventorySession.revision_no.desc(), InventorySession.id.desc())
        .limit(limit)
        .all()
    )


def _session_ref(s: InventorySession) -> ClosedSessionRef:
    return ClosedSessionRef(
        id=s.id,
        revision_no=int(s.revision_no),
        warehouse_id=int(s.warehouse_id),
        updated_at=s.updated_at,
    )


def _compute_row(p: Snap | None, c: Snap | None) -> dict[str, Any] | None:
    if p is None and c is None:
        return None
    meta = c or p
    assert meta is not None

    is_pf = is_semifinished_item({"Item": meta.name})

    if p is None and c is not None:
        cq = float(c.qty)
        classification: Literal["new", "disappeared", "increased", "decreased", "unchanged"] = "new"
        return {
            "item_id": meta.item_id,
            "product_code": meta.product_code,
            "item_name": meta.name,
            "unit": meta.unit,
            "category": meta.category,
            "is_pf": is_pf,
            "previous_qty": None,
            "current_qty": cq,
            "delta_qty": cq,
            "delta_percent": None,
            "classification": classification,
        }

    if p is not None and c is None:
        pq = float(p.qty)
        classification = "disappeared"
        return {
            "item_id": meta.item_id,
            "product_code": meta.product_code,
            "item_name": meta.name,
            "unit": meta.unit,
            "category": meta.category,
            "is_pf": is_pf,
            "previous_qty": pq,
            "current_qty": 0.0,
            "delta_qty": -pq,
            "delta_percent": None,
            "classification": classification,
        }

    assert p is not None and c is not None
    pq = float(p.qty)
    cq = float(c.qty)
    delta = cq - pq
    if delta == 0:
        classification = "unchanged"
    elif delta > 0:
        classification = "increased"
    else:
        classification = "decreased"

    dp: float | None
    if pq > 0:
        dp = (delta / pq) * 100.0
    elif pq == 0 and cq > 0:
        dp = None
    else:
        dp = 0.0 if delta == 0 else None

    return {
        "item_id": meta.item_id,
        "product_code": meta.product_code,
        "item_name": meta.name,
        "unit": c.unit,
        "category": c.category,
        "is_pf": is_pf,
        "previous_qty": pq,
        "current_qty": cq,
        "delta_qty": delta,
        "delta_percent": dp,
        "classification": classification,
    }


def build_diff_rows(
    prev_map: dict[int, Snap],
    curr_map: dict[int, Snap],
    *,
    category_id: int | None = None,
    only_pf: bool = False,
    min_abs_delta: float | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    needle = (search or "").strip().casefold()
    min_ad = float(min_abs_delta) if min_abs_delta is not None and min_abs_delta > 0 else None

    rows: list[dict[str, Any]] = []
    for iid in sorted(set(prev_map) | set(curr_map)):
        raw = _compute_row(prev_map.get(iid), curr_map.get(iid))
        if raw is None:
            continue
        if category_id is not None:
            snap = curr_map.get(iid) or prev_map.get(iid)
            if snap is None or snap.category_id != category_id:
                continue
        if only_pf and not raw["is_pf"]:
            continue
        if min_ad is not None and abs(float(raw["delta_qty"])) < min_ad:
            continue
        if needle:
            blob = f"{raw['item_name']} {raw.get('product_code') or ''}".casefold()
            if needle not in blob:
                continue
        rows.append(raw)
    rows.sort(key=lambda r: abs(float(r["delta_qty"])), reverse=True)
    return rows


def _trend_point(db: Session, session_id: int) -> TrendSessionPoint:
    s = db.query(InventorySession).filter(InventorySession.id == session_id).first()
    rev = int(s.revision_no) if s else 0
    upd = s.updated_at if s else None

    if not _has_totals_table(db):
        return TrendSessionPoint(
            session_id=session_id,
            revision_no=rev,
            updated_at=upd,
            items_count=0,
            total_qty_sum=0.0,
            by_category={},
        )

    rows = (
        db.query(ItemCategory.name, func.sum(InventorySessionTotal.qty_final))
        .join(Item, Item.id == InventorySessionTotal.item_id)
        .outerjoin(ItemCategory, ItemCategory.id == Item.category_id)
        .filter(InventorySessionTotal.session_id == session_id)
        .group_by(ItemCategory.name)
        .all()
    )
    by_cat: dict[str, float] = {}
    total = 0.0
    count = 0
    for cat_name, qty_sum in rows:
        label = str(cat_name) if cat_name is not None else "—"
        v = float(qty_sum or 0)
        by_cat[label] = v
        total += v
    count = (
        db.query(func.count(InventorySessionTotal.id))
        .filter(InventorySessionTotal.session_id == session_id)
        .scalar()
        or 0
    )
    return TrendSessionPoint(
        session_id=session_id,
        revision_no=rev,
        updated_at=upd,
        items_count=int(count),
        total_qty_sum=total,
        by_category=by_cat,
    )


def build_summary(
    db: Session,
    warehouse_id: int,
    date_from: datetime | None,
    date_to: datetime | None,
) -> InventoryAnalyticsSummaryOut:
    sessions = list_closed_sessions(db, warehouse_id, date_from, date_to, limit=80)
    refs = [_session_ref(s) for s in sessions]

    last = sessions[0] if sessions else None
    prev = sessions[1] if len(sessions) > 1 else None

    top_problems: list[ProblemItemOut] = []
    unchanged = 0
    sharp = 0
    stagnant = 0
    total_abs = 0.0
    last_items = 0

    if last is not None and prev is not None:
        pm = load_snapshot_map(db, prev.id)
        cm = load_snapshot_map(db, last.id)
        diff_raw = build_diff_rows(pm, cm)
        for r in diff_raw:
            d = float(r["delta_qty"])
            total_abs += abs(d)
            cls = r["classification"]
            if cls == "unchanged":
                unchanged += 1
                stagnant += 1
            dp = r.get("delta_percent")
            if dp is not None and abs(float(dp)) >= SHARP_DELTA_PCT:
                sharp += 1
            elif cls in ("increased", "decreased") and r.get("previous_qty") is not None:
                pq = float(r["previous_qty"])
                if pq > 0 and abs(d) >= 1 and abs(d) >= 0.25 * pq:
                    sharp += 1

        scored = sorted(diff_raw, key=lambda x: abs(float(x["delta_qty"])), reverse=True)[:5]
        top_problems = [
            ProblemItemOut(
                item_id=int(x["item_id"]),
                item_name=str(x["item_name"]),
                unit=str(x["unit"]),
                abs_delta_qty=abs(float(x["delta_qty"])),
            )
            for x in scored
        ]
    if last is not None:
        last_items = len(load_snapshot_map(db, last.id))

    return InventoryAnalyticsSummaryOut(
        warehouse_id=warehouse_id,
        date_from=date_from,
        date_to=date_to,
        closed_sessions_count=len(sessions),
        last_session=_session_ref(last) if last else None,
        previous_session=_session_ref(prev) if prev else None,
        last_session_items_count=last_items,
        total_abs_delta_qty=round(total_abs, 6),
        unchanged_items_count=unchanged,
        sharp_change_items_count=sharp,
        stagnant_items_count=stagnant,
        top_problem_items=top_problems,
        recent_closed_sessions=refs[:20],
    )


def build_diff(
    db: Session,
    warehouse_id: int,
    session_previous_id: int,
    session_current_id: int,
    *,
    category_id: int | None = None,
    only_pf: bool = False,
    min_abs_delta: float | None = None,
    search: str | None = None,
) -> InventoryDiffOut:
    sp = get_session_strict(db, session_previous_id)
    sc = get_session_strict(db, session_current_id)
    if not sp or not sc:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Session not found")
    if int(sp.warehouse_id) != warehouse_id or int(sc.warehouse_id) != warehouse_id:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Session warehouse mismatch")
    if not session_is_closed(sp) or not session_is_closed(sc):
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Analytics diff requires closed sessions")
    if int(sp.revision_no) >= int(sc.revision_no):
        from fastapi import HTTPException

        raise HTTPException(
            status_code=400,
            detail="session_previous_id must be an older revision than session_current_id",
        )

    pm = load_snapshot_map(db, sp.id)
    cm = load_snapshot_map(db, sc.id)
    raw = build_diff_rows(
        pm,
        cm,
        category_id=category_id,
        only_pf=only_pf,
        min_abs_delta=min_abs_delta,
        search=search,
    )
    rows = [InventoryDiffRowOut.model_validate(r) for r in raw]
    return InventoryDiffOut(
        warehouse_id=warehouse_id,
        session_previous_id=sp.id,
        session_current_id=sc.id,
        rows=rows,
    )


def build_trends(
    db: Session,
    warehouse_id: int,
    date_from: datetime | None,
    date_to: datetime | None,
) -> InventoryTrendsOut:
    sessions = list_closed_sessions(db, warehouse_id, date_from, date_to, limit=40)
    sessions_asc = list(reversed(sessions))
    points = [_trend_point(db, s.id) for s in sessions_asc]
    return InventoryTrendsOut(
        warehouse_id=warehouse_id,
        date_from=date_from,
        date_to=date_to,
        sessions=points,
    )


def build_problem_items(
    db: Session,
    warehouse_id: int,
    session_previous_id: int,
    session_current_id: int,
) -> InventoryProblemItemsOut:
    diff = build_diff(
        db,
        warehouse_id,
        session_previous_id,
        session_current_id,
    )
    by_abs = sorted(diff.rows, key=lambda r: abs(r.delta_qty), reverse=True)[:10]
    inc = sorted(
        [r for r in diff.rows if r.classification == "increased"],
        key=lambda r: r.delta_qty,
        reverse=True,
    )[:10]
    dec = sorted(
        [r for r in diff.rows if r.classification == "decreased"],
        key=lambda r: r.delta_qty,
    )[:10]

    def to_problem(r: InventoryDiffRowOut) -> ProblemItemOut:
        return ProblemItemOut(
            item_id=r.item_id,
            item_name=r.item_name,
            unit=r.unit,
            abs_delta_qty=abs(float(r.delta_qty)),
        )

    return InventoryProblemItemsOut(
        warehouse_id=warehouse_id,
        session_previous_id=session_previous_id,
        session_current_id=session_current_id,
        top_abs_delta=[to_problem(r) for r in by_abs],
        top_increase=[to_problem(r) for r in inc],
        top_decrease=[to_problem(r) for r in dec],
    )
