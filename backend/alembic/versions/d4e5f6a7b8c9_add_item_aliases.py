"""add item aliases

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-02-23 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "item_aliases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("alias_text", sa.String(length=200), nullable=False),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"]),
        sa.UniqueConstraint("item_id", "alias_text", name="uq_item_aliases_item_alias"),
    )
    op.create_index("ix_item_aliases_id", "item_aliases", ["id"], unique=False)
    op.create_index("ix_item_aliases_item_id", "item_aliases", ["item_id"], unique=False)
    op.create_index("ix_item_aliases_alias_text", "item_aliases", ["alias_text"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_item_aliases_alias_text", table_name="item_aliases")
    op.drop_index("ix_item_aliases_item_id", table_name="item_aliases")
    op.drop_index("ix_item_aliases_id", table_name="item_aliases")
    op.drop_table("item_aliases")
