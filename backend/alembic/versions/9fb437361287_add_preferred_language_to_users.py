"""add preferred_language to users

Revision ID: 9fb437361287
Revises: cb72f09089f1
Create Date: 2026-03-07 09:36:00.712505

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9fb437361287'
down_revision: Union[str, Sequence[str], None] = 'cb72f09089f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('preferred_language', sa.String(length=5), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'preferred_language')
    op.drop_constraint(None, 'items', type_='foreignkey')
    op.create_foreign_key(op.f('fk_items_station_id_stations'), 'items', 'stations', ['station_id'], ['id'], ondelete='SET NULL')
    op.drop_index(op.f('ix_items_product_code'), table_name='items')
    op.create_unique_constraint(op.f('uq_items_product_code'), 'items', ['product_code'], postgresql_nulls_not_distinct=False)
    op.create_unique_constraint(op.f('uq_item_categories_name'), 'item_categories', ['name'], postgresql_nulls_not_distinct=False)
    op.alter_column('inventory_session_totals', 'qty_final',
               existing_type=sa.Numeric(precision=12, scale=3, asdecimal=False),
               type_=sa.DOUBLE_PRECISION(precision=53),
               existing_nullable=False)
    op.alter_column('inventory_entry_events', 'after_quantity',
               existing_type=sa.Numeric(precision=12, scale=3, asdecimal=False),
               type_=sa.DOUBLE_PRECISION(precision=53),
               existing_nullable=False)
    op.alter_column('inventory_entry_events', 'before_quantity',
               existing_type=sa.Numeric(precision=12, scale=3, asdecimal=False),
               type_=sa.DOUBLE_PRECISION(precision=53),
               existing_nullable=True)
    op.drop_constraint('uq_inventory_entries_session_item', 'inventory_entries', type_='unique')
    op.create_index(op.f('ux_inventory_entries_session_item'), 'inventory_entries', ['session_id', 'item_id'], unique=True)
    op.alter_column('inventory_entries', 'quantity',
               existing_type=sa.Numeric(precision=12, scale=3, asdecimal=False),
               type_=sa.DOUBLE_PRECISION(precision=53),
               existing_nullable=False)
    # ### end Alembic commands ###
