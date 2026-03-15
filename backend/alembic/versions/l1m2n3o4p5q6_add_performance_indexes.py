"""add performance indexes

Revision ID: l1m2n3o4p5q6
Revises: k2l3m4n5o6p7
Create Date: 2026-03-11
"""

from alembic import op

revision = "l1m2n3o4p5q6"
down_revision = "k2l3m4n5o6p7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # items: FK index for warehouse filtering
    op.create_index("ix_items_warehouse_id", "items", ["warehouse_id"])

    # inventory_sessions: status for filtering draft/closed
    op.create_index("ix_inventory_sessions_status", "inventory_sessions", ["status"])

    # inventory_entry_events: composite for per-entry audit lookups
    op.create_index("ix_entry_events_session_item", "inventory_entry_events", ["session_id", "item_id"])

    # inventory_entry_events: time-range queries on event log
    op.create_index("ix_inventory_entry_events_created_at", "inventory_entry_events", ["created_at"])

    # inventory_session_events: time-range queries
    op.create_index("ix_inventory_session_events_created_at", "inventory_session_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_inventory_session_events_created_at", table_name="inventory_session_events")
    op.drop_index("ix_inventory_entry_events_created_at", table_name="inventory_entry_events")
    op.drop_index("ix_entry_events_session_item", table_name="inventory_entry_events")
    op.drop_index("ix_inventory_sessions_status", table_name="inventory_sessions")
    op.drop_index("ix_items_warehouse_id", table_name="items")
