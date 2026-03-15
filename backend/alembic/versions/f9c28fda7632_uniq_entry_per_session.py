"""uniq_entry_per_session

Revision ID: f9c28fda7632
Revises: 5b07aa0c1dc4
Create Date: 2026-02-22 07:46:45.235464

"""
from typing import Sequence, Union

from alembic import op

revision: str = "f9c28fda7632"
down_revision: str = "5b07aa0c1dc4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ux_inventory_entries_session_item",
        "inventory_entries",
        ["session_id", "item_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ux_inventory_entries_session_item",
        table_name="inventory_entries",
    )
