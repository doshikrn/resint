"""convert qty columns to numeric

Revision ID: e7f8a9b0c1d2
Revises: d0e1f2a3b4c5
Create Date: 2026-03-03 10:00:00.000000
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "e7f8a9b0c1d2"
down_revision = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.execute(
            """
            ALTER TABLE inventory_entries
            ALTER COLUMN quantity TYPE NUMERIC(12,3)
            USING ROUND(quantity::numeric, 3)
            """
        )
        op.execute(
            """
            ALTER TABLE inventory_entry_events
            ALTER COLUMN before_quantity TYPE NUMERIC(12,3)
            USING CASE
                WHEN before_quantity IS NULL THEN NULL
                ELSE ROUND(before_quantity::numeric, 3)
            END
            """
        )
        op.execute(
            """
            ALTER TABLE inventory_entry_events
            ALTER COLUMN after_quantity TYPE NUMERIC(12,3)
            USING ROUND(after_quantity::numeric, 3)
            """
        )
        op.execute(
            """
            ALTER TABLE inventory_session_totals
            ALTER COLUMN qty_final TYPE NUMERIC(12,3)
            USING ROUND(qty_final::numeric, 3)
            """
        )
        return

    with op.batch_alter_table("inventory_entries") as batch_op:
        batch_op.alter_column(
            "quantity",
            existing_type=sa.Float(),
            type_=sa.Numeric(12, 3),
            existing_nullable=False,
        )

    with op.batch_alter_table("inventory_entry_events") as batch_op:
        batch_op.alter_column(
            "before_quantity",
            existing_type=sa.Float(),
            type_=sa.Numeric(12, 3),
            existing_nullable=True,
        )
        batch_op.alter_column(
            "after_quantity",
            existing_type=sa.Float(),
            type_=sa.Numeric(12, 3),
            existing_nullable=False,
        )

    with op.batch_alter_table("inventory_session_totals") as batch_op:
        batch_op.alter_column(
            "qty_final",
            existing_type=sa.Float(),
            type_=sa.Numeric(12, 3),
            existing_nullable=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.execute(
            """
            ALTER TABLE inventory_entries
            ALTER COLUMN quantity TYPE DOUBLE PRECISION
            USING quantity::double precision
            """
        )
        op.execute(
            """
            ALTER TABLE inventory_entry_events
            ALTER COLUMN before_quantity TYPE DOUBLE PRECISION
            USING before_quantity::double precision
            """
        )
        op.execute(
            """
            ALTER TABLE inventory_entry_events
            ALTER COLUMN after_quantity TYPE DOUBLE PRECISION
            USING after_quantity::double precision
            """
        )
        op.execute(
            """
            ALTER TABLE inventory_session_totals
            ALTER COLUMN qty_final TYPE DOUBLE PRECISION
            USING qty_final::double precision
            """
        )
        return

    with op.batch_alter_table("inventory_entries") as batch_op:
        batch_op.alter_column(
            "quantity",
            existing_type=sa.Numeric(12, 3),
            type_=sa.Float(),
            existing_nullable=False,
        )

    with op.batch_alter_table("inventory_entry_events") as batch_op:
        batch_op.alter_column(
            "before_quantity",
            existing_type=sa.Numeric(12, 3),
            type_=sa.Float(),
            existing_nullable=True,
        )
        batch_op.alter_column(
            "after_quantity",
            existing_type=sa.Numeric(12, 3),
            type_=sa.Float(),
            existing_nullable=False,
        )

    with op.batch_alter_table("inventory_session_totals") as batch_op:
        batch_op.alter_column(
            "qty_final",
            existing_type=sa.Numeric(12, 3),
            type_=sa.Float(),
            existing_nullable=False,
        )
