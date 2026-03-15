"""add user department and default warehouse

Revision ID: f3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-02-26 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "f3b4c5d6e7f8"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


USER_DEPARTMENT_ENUM = sa.Enum("kitchen", "bar", name="user_department", native_enum=False)


def upgrade() -> None:
    op.add_column("users", sa.Column("department", USER_DEPARTMENT_ENUM, nullable=True))

    op.add_column("users", sa.Column("default_warehouse_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_users_default_warehouse_id"), "users", ["default_warehouse_id"], unique=False)
    op.create_foreign_key(
        "fk_users_default_warehouse_id_warehouses",
        "users",
        "warehouses",
        ["default_warehouse_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_default_warehouse_id_warehouses", "users", type_="foreignkey")
    op.drop_index(op.f("ix_users_default_warehouse_id"), table_name="users")
    op.drop_column("users", "default_warehouse_id")

    op.drop_column("users", "department")
