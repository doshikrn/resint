"""add full_name to users

Revision ID: c1d2e3f4a5b6
Revises: b9c0d1e2f3a4
Create Date: 2026-02-26 22:20:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c1d2e3f4a5b6"
down_revision = "b9c0d1e2f3a4"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    user_columns = [col["name"] for col in inspector.get_columns("users")]
    if "full_name" not in user_columns:
        op.add_column("users", sa.Column("full_name", sa.String(length=120), nullable=True))


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    user_columns = [col["name"] for col in inspector.get_columns("users")]
    if "full_name" in user_columns:
        op.drop_column("users", "full_name")
