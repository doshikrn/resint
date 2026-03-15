"""add_product_code_to_items

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-02-27
"""

from alembic import op
import sqlalchemy as sa


revision = "d2e3f4a5b6c7"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("items", sa.Column("product_code", sa.String(length=64), nullable=True))

    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT id FROM items ORDER BY id ASC")).fetchall()
    for row in rows:
        item_id = int(row[0])
        connection.execute(
            sa.text("UPDATE items SET product_code = :code WHERE id = :item_id"),
            {"code": f"PRD{item_id:06d}", "item_id": item_id},
        )

    op.alter_column("items", "product_code", existing_type=sa.String(length=64), nullable=False)
    op.create_unique_constraint("uq_items_product_code", "items", ["product_code"])


def downgrade() -> None:
    op.drop_constraint("uq_items_product_code", "items", type_="unique")
    op.drop_column("items", "product_code")
