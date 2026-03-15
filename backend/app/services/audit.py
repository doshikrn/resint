import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog

log = logging.getLogger("app")

GENESIS_HASH = "0" * 64


def compute_entry_hash(
    created_at: datetime,
    actor_id: int,
    action: str,
    entity_type: str,
    entity_id: int | None,
    metadata_json: str | None,
    previous_hash: str,
) -> str:
    ts = created_at
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    payload = "|".join([
        ts.isoformat(),
        str(actor_id),
        action,
        entity_type,
        str(entity_id) if entity_id is not None else "",
        metadata_json or "",
        previous_hash,
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _get_last_hash(db: Session) -> str:
    row = db.execute(
        select(AuditLog.hash)
        .order_by(AuditLog.id.desc())
        .limit(1)
    ).scalar()
    return row if row else GENESIS_HASH


def log_audit(
    db: Session,
    *,
    actor_id: int,
    action: str,
    entity_type: str,
    entity_id: int | None = None,
    warehouse_id: int | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Write a single row to audit_log with hash-chain integrity.

    Designed to be called inside an existing transaction — the caller
    is responsible for ``db.commit()`` / ``db.rollback()``.
    """
    metadata_json: str | None = None
    if metadata:
        try:
            metadata_json = json.dumps(metadata, ensure_ascii=False, default=str)
        except Exception:
            metadata_json = str(metadata)

    now = datetime.now(timezone.utc)
    prev_hash = _get_last_hash(db)
    entry_hash = compute_entry_hash(
        created_at=now,
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        metadata_json=metadata_json,
        previous_hash=prev_hash,
    )

    entry = AuditLog(
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        warehouse_id=warehouse_id,
        metadata_json=metadata_json,
        created_at=now,
        previous_hash=prev_hash,
        hash=entry_hash,
    )
    try:
        db.add(entry)
    except Exception:
        log.exception(
            "audit_log_write_failed",
            extra={
                "event": "audit_log_write_failed",
                "action": action,
                "entity_type": entity_type,
                "entity_id": entity_id,
            },
        )


def verify_audit_chain(
    db: Session,
    *,
    limit: int | None = None,
) -> dict:
    """Verify the hash-chain integrity of the audit log.

    Returns a dict with ``valid`` (bool), ``checked`` (int), and
    optionally ``broken_at_id`` (int) with ``detail`` (str) when
    the chain is broken.
    """
    query = select(
        AuditLog.id,
        AuditLog.actor_id,
        AuditLog.action,
        AuditLog.entity_type,
        AuditLog.entity_id,
        AuditLog.metadata_json,
        AuditLog.created_at,
        AuditLog.previous_hash,
        AuditLog.hash,
    ).order_by(AuditLog.id.asc())

    if limit is not None:
        query = query.limit(limit)

    rows = db.execute(query).all()

    expected_prev = GENESIS_HASH
    checked = 0

    for row in rows:
        checked += 1

        if row.previous_hash != expected_prev:
            return {
                "valid": False,
                "checked": checked,
                "broken_at_id": row.id,
                "detail": f"previous_hash mismatch at id={row.id}",
            }

        expected_hash = compute_entry_hash(
            created_at=row.created_at,
            actor_id=row.actor_id,
            action=row.action,
            entity_type=row.entity_type,
            entity_id=row.entity_id,
            metadata_json=row.metadata_json,
            previous_hash=row.previous_hash,
        )

        if row.hash != expected_hash:
            return {
                "valid": False,
                "checked": checked,
                "broken_at_id": row.id,
                "detail": f"hash mismatch at id={row.id}",
            }

        expected_prev = row.hash

    return {"valid": True, "checked": checked}
