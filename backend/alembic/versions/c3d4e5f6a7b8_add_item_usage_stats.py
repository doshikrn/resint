"""add item usage stats

Revision ID: c3d4e5f6a7b8
Revises: merge_a1b2c3_a7b8c9
Create Date: 2026-02-23 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c3d4e5f6a7b8"
down_revision = "merge_a1b2c3_a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "item_usage_stats",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("use_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "last_used_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"]),
        sa.UniqueConstraint("warehouse_id", "item_id", name="uq_item_usage_stats_wh_item"),
    )
    op.create_index("ix_item_usage_stats_id", "item_usage_stats", ["id"], unique=False)
    op.create_index("ix_item_usage_stats_warehouse_id", "item_usage_stats", ["warehouse_id"], unique=False)
    op.create_index("ix_item_usage_stats_item_id", "item_usage_stats", ["item_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_item_usage_stats_item_id", table_name="item_usage_stats")
    op.drop_index("ix_item_usage_stats_warehouse_id", table_name="item_usage_stats")
    op.drop_index("ix_item_usage_stats_id", table_name="item_usage_stats")
    op.drop_table("item_usage_stats")
