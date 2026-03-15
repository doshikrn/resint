"""merge heads a1b2c3d4e5f6 & a7b8c9d0e1f2

Revision ID: merge_a1b2c3_a7b8c9
Revises: a1b2c3d4e5f6, a7b8c9d0e1f2
Create Date: 2026-02-23 00:00:00.000000
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = 'merge_a1b2c3_a7b8c9'
down_revision = ('a1b2c3d4e5f6', 'a7b8c9d0e1f2')
branch_labels = None
depends_on = None


def upgrade():
    # This is a merge/revision-only migration to unify multiple heads.
    pass


def downgrade():
    # Nothing to do on downgrade for a merge-only revision.
    pass
