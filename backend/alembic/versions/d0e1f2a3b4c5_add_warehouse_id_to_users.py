"""add warehouse_id to users

Revision ID: d0e1f2a3b4c5
Revises: c0ffee123456
Create Date: 2026-03-03 03:00:00.000000
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "d0e1f2a3b4c5"
down_revision = "c0ffee123456"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("warehouse_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_users_warehouse_id", ["warehouse_id"], unique=False)
        batch_op.create_foreign_key("fk_users_warehouse_id", "warehouses", ["warehouse_id"], ["id"])

    connection = op.get_bind()
    connection.execute(
        sa.text(
            """
        UPDATE users
        SET warehouse_id = default_warehouse_id
        WHERE warehouse_id IS NULL AND default_warehouse_id IS NOT NULL
        """
        )
    )

    first_warehouse_id = connection.execute(
        sa.text("SELECT id FROM warehouses ORDER BY id ASC LIMIT 1")
    ).scalar()
    if first_warehouse_id is not None:
        connection.execute(
            sa.text("UPDATE users SET warehouse_id = :warehouse_id WHERE warehouse_id IS NULL"),
            {"warehouse_id": int(first_warehouse_id)},
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_constraint("fk_users_warehouse_id", type_="foreignkey")
        batch_op.drop_index("ix_users_warehouse_id")
        batch_op.drop_column("warehouse_id")
