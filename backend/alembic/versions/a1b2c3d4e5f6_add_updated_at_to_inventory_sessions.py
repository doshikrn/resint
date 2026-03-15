"""add updated_at to inventory_sessions

Revision ID: a1b2c3d4e5f6
Revises: fdf7f9b2b1e3
Create Date: 2026-02-22 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "fdf7f9b2b1e3"
branch_labels = None
depends_on = None


def upgrade():
    # Add updated_at with a DB-side default timestamp. Use CURRENT_TIMESTAMP for SQLite compatibility.
    op.add_column(
        "inventory_sessions",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )


def downgrade():
    op.drop_column("inventory_sessions", "updated_at")
