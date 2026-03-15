"""add is_favorite to items

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-02-23 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d9e0f1a2b3c4"
down_revision = "c8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("items", sa.Column("is_favorite", sa.Boolean(), nullable=True))
    op.execute("UPDATE items SET is_favorite = FALSE")
    op.alter_column("items", "is_favorite", nullable=False)


def downgrade() -> None:
    op.drop_column("items", "is_favorite")
