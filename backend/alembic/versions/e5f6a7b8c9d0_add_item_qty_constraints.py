"""add item quantity constraints

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-02-23 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("items", sa.Column("step", sa.Float(), nullable=True))
    op.add_column("items", sa.Column("min_qty", sa.Float(), nullable=True))
    op.add_column("items", sa.Column("max_qty", sa.Float(), nullable=True))

    op.execute("UPDATE items SET step = 1.0 WHERE step IS NULL")
    op.alter_column("items", "step", nullable=False)


def downgrade() -> None:
    op.drop_column("items", "max_qty")
    op.drop_column("items", "min_qty")
    op.drop_column("items", "step")
