"""add unique partial index for active inventory sessions

Revision ID: a7b8c9d0e1f2
Revises: fdf7f9b2b1e3
Create Date: 2026-02-23 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


def _is_postgres():
    bind = op.get_bind()
    return bind.dialect.name == "postgresql"

# revision identifiers, used by Alembic.
revision = 'a7b8c9d0e1f2'
down_revision = 'fdf7f9b2b1e3'
branch_labels = None
depends_on = None


def upgrade():
    # Create a partial unique index so Postgres enforces at most one draft session per warehouse
    # Skip on non-Postgres DBs (SQLite doesn't support partial indexes in the same way)
    if _is_postgres():
        op.create_index(
            'uq_inventory_sessions_warehouse_draft',
            'inventory_sessions',
            ['warehouse_id'],
            unique=True,
            postgresql_where=sa.text("status='draft'"),
        )


def downgrade():
    if _is_postgres():
        op.drop_index('uq_inventory_sessions_warehouse_draft', table_name='inventory_sessions')
