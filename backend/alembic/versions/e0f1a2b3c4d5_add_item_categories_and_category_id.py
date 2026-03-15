"""add item categories and category_id to items

Revision ID: e0f1a2b3c4d5
Revises: d9e0f1a2b3c4
Create Date: 2026-02-23 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e0f1a2b3c4d5"
down_revision = "d9e0f1a2b3c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "item_categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.UniqueConstraint("name", name="uq_item_categories_name"),
    )
    op.create_index("ix_item_categories_id", "item_categories", ["id"], unique=False)
    op.create_index("ix_item_categories_name", "item_categories", ["name"], unique=True)

    op.add_column("items", sa.Column("category_id", sa.Integer(), nullable=True))
    op.create_index("ix_items_category_id", "items", ["category_id"], unique=False)
    op.create_foreign_key("fk_items_category_id_item_categories", "items", "item_categories", ["category_id"], ["id"])


def downgrade() -> None:
    op.drop_constraint("fk_items_category_id_item_categories", "items", type_="foreignkey")
    op.drop_index("ix_items_category_id", table_name="items")
    op.drop_column("items", "category_id")

    op.drop_index("ix_item_categories_name", table_name="item_categories")
    op.drop_index("ix_item_categories_id", table_name="item_categories")
    op.drop_table("item_categories")
