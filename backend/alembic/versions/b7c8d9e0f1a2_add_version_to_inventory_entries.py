"""add version to inventory entries

Revision ID: b7c8d9e0f1a2
Revises: a6b7c8d9e0f1
Create Date: 2026-02-23 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b7c8d9e0f1a2"
down_revision = "a6b7c8d9e0f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("inventory_entries", sa.Column("version", sa.Integer(), nullable=True))
    op.execute("UPDATE inventory_entries SET version = 1 WHERE version IS NULL")
    op.alter_column("inventory_entries", "version", nullable=False)


def downgrade() -> None:
    op.drop_column("inventory_entries", "version")
