"""add inventory entry events

Revision ID: a6b7c8d9e0f1
Revises: f6a7b8c9d0e1
Create Date: 2026-02-23 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a6b7c8d9e0f1"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inventory_entry_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("request_id", sa.String(length=100), nullable=True),
        sa.Column("before_quantity", sa.Float(), nullable=True),
        sa.Column("after_quantity", sa.Float(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["session_id"], ["inventory_sessions.id"]),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"]),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
    )
    op.create_index("ix_inventory_entry_events_id", "inventory_entry_events", ["id"], unique=False)
    op.create_index("ix_inventory_entry_events_session_id", "inventory_entry_events", ["session_id"], unique=False)
    op.create_index("ix_inventory_entry_events_item_id", "inventory_entry_events", ["item_id"], unique=False)
    op.create_index("ix_inventory_entry_events_actor_user_id", "inventory_entry_events", ["actor_user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_inventory_entry_events_actor_user_id", table_name="inventory_entry_events")
    op.drop_index("ix_inventory_entry_events_item_id", table_name="inventory_entry_events")
    op.drop_index("ix_inventory_entry_events_session_id", table_name="inventory_entry_events")
    op.drop_index("ix_inventory_entry_events_id", table_name="inventory_entry_events")
    op.drop_table("inventory_entry_events")
