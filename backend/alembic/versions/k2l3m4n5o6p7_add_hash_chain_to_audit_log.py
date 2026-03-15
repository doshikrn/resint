"""add hash chain to audit_log

Revision ID: k2l3m4n5o6p7
Revises: j1k2l3m4n5o6
Create Date: 2026-03-10 14:00:00.000000

"""
import hashlib
from datetime import timezone

from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session as SaSession


revision = "k2l3m4n5o6p7"
down_revision = "j1k2l3m4n5o6"
branch_labels = None
depends_on = None

GENESIS_HASH = "0" * 64


def _compute_hash(
    created_at: str,
    actor_id: int,
    action: str,
    entity_type: str,
    entity_id: int | None,
    metadata_json: str | None,
    previous_hash: str,
) -> str:
    payload = "|".join([
        created_at,
        str(actor_id),
        action,
        entity_type,
        str(entity_id) if entity_id is not None else "",
        metadata_json or "",
        previous_hash,
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def upgrade() -> None:
    op.add_column("audit_log", sa.Column("previous_hash", sa.String(64), nullable=True))
    op.add_column("audit_log", sa.Column("hash", sa.String(64), nullable=True))

    # Back-fill existing rows with a valid hash chain
    bind = op.get_bind()
    session = SaSession(bind=bind)

    audit_log = sa.table(
        "audit_log",
        sa.column("id", sa.Integer),
        sa.column("actor_id", sa.Integer),
        sa.column("action", sa.String),
        sa.column("entity_type", sa.String),
        sa.column("entity_id", sa.Integer),
        sa.column("metadata_json", sa.Text),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("previous_hash", sa.String),
        sa.column("hash", sa.String),
    )

    rows = session.execute(
        sa.select(
            audit_log.c.id,
            audit_log.c.actor_id,
            audit_log.c.action,
            audit_log.c.entity_type,
            audit_log.c.entity_id,
            audit_log.c.metadata_json,
            audit_log.c.created_at,
        ).order_by(audit_log.c.id.asc())
    ).fetchall()

    prev_hash = GENESIS_HASH
    for row in rows:
        ts = row.created_at
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        ts_str = ts.isoformat()

        h = _compute_hash(
            created_at=ts_str,
            actor_id=row.actor_id,
            action=row.action,
            entity_type=row.entity_type,
            entity_id=row.entity_id,
            metadata_json=row.metadata_json,
            previous_hash=prev_hash,
        )
        session.execute(
            audit_log.update()
            .where(audit_log.c.id == row.id)
            .values(previous_hash=prev_hash, hash=h)
        )
        prev_hash = h

    session.commit()

    op.alter_column("audit_log", "previous_hash", nullable=False)
    op.alter_column("audit_log", "hash", nullable=False)


def downgrade() -> None:
    op.drop_column("audit_log", "hash")
    op.drop_column("audit_log", "previous_hash")
