"""add session closure snapshot and events

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-02-23 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c8d9e0f1a2b3"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("inventory_sessions", sa.Column("is_closed", sa.Boolean(), nullable=True))
    op.execute("UPDATE inventory_sessions SET is_closed = CASE WHEN status = 'closed' THEN TRUE ELSE FALSE END")
    op.alter_column("inventory_sessions", "is_closed", nullable=False)

    op.create_table(
        "inventory_session_totals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("qty_final", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["inventory_sessions.id"]),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"]),
        sa.UniqueConstraint("session_id", "item_id", name="uq_inventory_session_totals_session_item"),
    )
    op.create_index("ix_inventory_session_totals_id", "inventory_session_totals", ["id"], unique=False)
    op.create_index("ix_inventory_session_totals_session_id", "inventory_session_totals", ["session_id"], unique=False)
    op.create_index("ix_inventory_session_totals_item_id", "inventory_session_totals", ["item_id"], unique=False)

    op.create_table(
        "inventory_session_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("request_id", sa.String(length=100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["session_id"], ["inventory_sessions.id"]),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
    )
    op.create_index("ix_inventory_session_events_id", "inventory_session_events", ["id"], unique=False)
    op.create_index("ix_inventory_session_events_session_id", "inventory_session_events", ["session_id"], unique=False)
    op.create_index("ix_inventory_session_events_actor_user_id", "inventory_session_events", ["actor_user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_inventory_session_events_actor_user_id", table_name="inventory_session_events")
    op.drop_index("ix_inventory_session_events_session_id", table_name="inventory_session_events")
    op.drop_index("ix_inventory_session_events_id", table_name="inventory_session_events")
    op.drop_table("inventory_session_events")

    op.drop_index("ix_inventory_session_totals_item_id", table_name="inventory_session_totals")
    op.drop_index("ix_inventory_session_totals_session_id", table_name="inventory_session_totals")
    op.drop_index("ix_inventory_session_totals_id", table_name="inventory_session_totals")
    op.drop_table("inventory_session_totals")

    op.drop_column("inventory_sessions", "is_closed")
