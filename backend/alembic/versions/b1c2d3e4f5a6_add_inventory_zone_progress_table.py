"""add inventory zone progress table

Revision ID: b1c2d3e4f5a6
Revises: a9b8c7d6e5f4
Create Date: 2026-02-26 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "b1c2d3e4f5a6"
down_revision = "a9b8c7d6e5f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inventory_zone_progress",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("zone_id", sa.Integer(), nullable=False),
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("entered_items_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["inventory_sessions.id"]),
        sa.ForeignKeyConstraint(["zone_id"], ["zones.id"]),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.ForeignKeyConstraint(["completed_by_user_id"], ["users.id"]),
        sa.UniqueConstraint("session_id", "zone_id", name="uq_inventory_zone_progress_session_zone"),
    )

    op.create_index("ix_inventory_zone_progress_id", "inventory_zone_progress", ["id"], unique=False)
    op.create_index("ix_inventory_zone_progress_session_id", "inventory_zone_progress", ["session_id"], unique=False)
    op.create_index("ix_inventory_zone_progress_zone_id", "inventory_zone_progress", ["zone_id"], unique=False)
    op.create_index("ix_inventory_zone_progress_warehouse_id", "inventory_zone_progress", ["warehouse_id"], unique=False)
    op.create_index(
        "ix_inventory_zone_progress_completed_by_user_id",
        "inventory_zone_progress",
        ["completed_by_user_id"],
        unique=False,
    )

    op.execute("""
        INSERT INTO inventory_zone_progress (
            session_id,
            zone_id,
            warehouse_id,
            entered_items_count,
            last_activity_at,
            is_completed,
            completed_at,
            completed_by_user_id,
            created_at,
            updated_at
        )
        SELECT
            s.id,
            w.zone_id,
            s.warehouse_id,
            COALESCE(COUNT(e.id), 0) AS entered_items_count,
            MAX(e.updated_at) AS last_activity_at,
            false,
            NULL,
            NULL,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        FROM inventory_sessions s
        JOIN warehouses w ON w.id = s.warehouse_id
        LEFT JOIN inventory_entries e ON e.session_id = s.id
        WHERE w.zone_id IS NOT NULL
        GROUP BY s.id, w.zone_id, s.warehouse_id
    """)

    op.alter_column("inventory_zone_progress", "entered_items_count", server_default=None)
    op.alter_column("inventory_zone_progress", "is_completed", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_inventory_zone_progress_completed_by_user_id", table_name="inventory_zone_progress")
    op.drop_index("ix_inventory_zone_progress_warehouse_id", table_name="inventory_zone_progress")
    op.drop_index("ix_inventory_zone_progress_zone_id", table_name="inventory_zone_progress")
    op.drop_index("ix_inventory_zone_progress_session_id", table_name="inventory_zone_progress")
    op.drop_index("ix_inventory_zone_progress_id", table_name="inventory_zone_progress")
    op.drop_table("inventory_zone_progress")
