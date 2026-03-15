"""make warehouses.zone_id not null

Revision ID: b8c9d0e1f2a3
Revises: e6f7a8b9c0d1
Create Date: 2026-03-02

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "b8c9d0e1f2a3"
down_revision = "e6f7a8b9c0d1"
branch_labels = None
depends_on = None


def _ensure_default_zone(conn: sa.engine.Connection) -> int:
    default_zone_id = conn.execute(
        sa.text("SELECT id FROM zones WHERE name = :name"),
        {"name": "Default"},
    ).scalar()

    if default_zone_id is None:
        conn.execute(
            sa.text("INSERT INTO zones (name, description) VALUES (:name, :desc)"),
            {"name": "Default", "desc": "Auto-created during migration"},
        )
        default_zone_id = conn.execute(
            sa.text("SELECT id FROM zones WHERE name = :name"),
            {"name": "Default"},
        ).scalar()

    return int(default_zone_id)


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    # If schema is unexpectedly old, don't crash migrations.
    if "warehouses" not in tables or "zones" not in tables:
        return

    warehouses_cols = {col["name"]: col for col in inspector.get_columns("warehouses")}
    if "zone_id" not in warehouses_cols:
        return

    default_zone_id = _ensure_default_zone(conn)

    # Backfill any NULL zone_id to keep API response validation happy
    conn.execute(
        sa.text("UPDATE warehouses SET zone_id = :zone_id WHERE zone_id IS NULL"),
        {"zone_id": default_zone_id},
    )

    # Enforce NOT NULL to prevent future NULL rows.
    zone_id_col = warehouses_cols["zone_id"]
    if zone_id_col.get("nullable", True):
        if conn.dialect.name == "sqlite":
            with op.batch_alter_table("warehouses") as batch_op:
                batch_op.alter_column("zone_id", existing_type=sa.Integer(), nullable=False)
        else:
            op.alter_column("warehouses", "zone_id", existing_type=sa.Integer(), nullable=False)


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if "warehouses" not in tables:
        return

    warehouses_cols = {col["name"]: col for col in inspector.get_columns("warehouses")}
    zone_id_col = warehouses_cols.get("zone_id")
    if not zone_id_col:
        return

    if not zone_id_col.get("nullable", True):
        if conn.dialect.name == "sqlite":
            with op.batch_alter_table("warehouses") as batch_op:
                batch_op.alter_column("zone_id", existing_type=sa.Integer(), nullable=True)
        else:
            op.alter_column("warehouses", "zone_id", existing_type=sa.Integer(), nullable=True)
