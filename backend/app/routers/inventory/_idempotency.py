"""Idempotency, report aggregation, and catalog-ETag helpers."""

import hashlib
import json
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.clock import utc_now as _utc_now
from app.core.config import settings
from app.core.metrics import (
    observe_idempotency_cleanup,
    observe_idempotency_conflict,
    observe_idempotency_replay,
)
from app.models.idempotency_key import IdempotencyKey
from app.models.inventory_entry import InventoryEntry
from app.models.inventory_session import InventorySession
from app.models.inventory_session_total import InventorySessionTotal
from app.models.item import Item

from app.routers.inventory._auth import _is_session_closed
from app.routers.inventory._session_ops import _has_table


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
