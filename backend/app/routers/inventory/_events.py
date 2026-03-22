"""Event / audit-log builder helpers for the inventory router."""

import logging
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.enums import EntryAction
from app.models.inventory_entry_event import InventoryEntryEvent
from app.models.inventory_session_event import InventorySessionEvent
from app.models.user import User

from app.routers.inventory._validation import _normalize_qty_for_api
from app.routers.inventory._session_ops import _has_table

log = logging.getLogger("app")


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
