"""merge heads

Revision ID: cb72f09089f1
Revises: e7f8a9b0c1d2, g1h2i3j4k5l6, h1i2j3k4l5m6, i1j2k3l4m5n6
Create Date: 2026-03-07 09:35:33.617930

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cb72f09089f1'
down_revision: Union[str, Sequence[str], None] = ('e7f8a9b0c1d2', 'g1h2i3j4k5l6', 'h1i2j3k4l5m6', 'i1j2k3l4m5n6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
