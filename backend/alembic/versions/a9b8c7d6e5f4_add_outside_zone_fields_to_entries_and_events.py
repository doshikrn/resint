"""add outside-zone fields to entries and events

Revision ID: a9b8c7d6e5f4
Revises: f0a1b2c3d4e5
Create Date: 2026-02-25 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a9b8c7d6e5f4"
down_revision = "f0a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "inventory_entries",
        sa.Column("counted_outside_zone", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "inventory_entries",
        sa.Column("counted_by_zone_id", sa.Integer(), sa.ForeignKey("zones.id"), nullable=True),
    )
    op.add_column("inventory_entries", sa.Column("outside_zone_note", sa.String(length=500), nullable=True))
    op.create_index("ix_inventory_entries_counted_by_zone_id", "inventory_entries", ["counted_by_zone_id"], unique=False)
    op.alter_column("inventory_entries", "counted_outside_zone", server_default=None)

    op.add_column(
        "inventory_entry_events",
        sa.Column("counted_outside_zone", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "inventory_entry_events",
        sa.Column("counted_by_zone_id", sa.Integer(), sa.ForeignKey("zones.id"), nullable=True),
    )
    op.add_column("inventory_entry_events", sa.Column("outside_zone_note", sa.String(length=500), nullable=True))
    op.create_index(
        "ix_inventory_entry_events_counted_by_zone_id",
        "inventory_entry_events",
        ["counted_by_zone_id"],
        unique=False,
    )
    op.alter_column("inventory_entry_events", "counted_outside_zone", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_inventory_entry_events_counted_by_zone_id", table_name="inventory_entry_events")
    op.drop_column("inventory_entry_events", "outside_zone_note")
    op.drop_column("inventory_entry_events", "counted_by_zone_id")
    op.drop_column("inventory_entry_events", "counted_outside_zone")

    op.drop_index("ix_inventory_entries_counted_by_zone_id", table_name="inventory_entries")
    op.drop_column("inventory_entries", "outside_zone_note")
    op.drop_column("inventory_entries", "counted_by_zone_id")
    op.drop_column("inventory_entries", "counted_outside_zone")
