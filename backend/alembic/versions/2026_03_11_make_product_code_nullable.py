"""Make product_code nullable in items table

Revision ID: m2n3o4p5q6r7
Revises: l1m2n3o4p5q6
Create Date: 2026-03-11
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "m2n3o4p5q6r7"
down_revision = "l1m2n3o4p5q6"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('items', 'product_code', existing_type=sa.String(length=64), nullable=True)


def downgrade():
    op.alter_column('items', 'product_code', existing_type=sa.String(length=64), nullable=False)
