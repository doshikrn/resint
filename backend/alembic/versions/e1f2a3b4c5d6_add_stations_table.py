"""add stations table

Revision ID: e1f2a3b4c5d6
Revises: b1c2d3e4f5a6
Create Date: 2026-02-26 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e1f2a3b4c5d6"
down_revision = "b1c2d3e4f5a6"
branch_labels = None
depends_on = None


STATION_DEPARTMENT_ENUM = sa.Enum("kitchen", "bar", name="station_department", native_enum=False)


def upgrade() -> None:
    op.create_table(
        "stations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("department", STATION_DEPARTMENT_ENUM, nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_stations_id"), "stations", ["id"], unique=False)
    op.create_index(op.f("ix_stations_name"), "stations", ["name"], unique=False)
    op.create_index(op.f("ix_stations_department"), "stations", ["department"], unique=False)
    op.alter_column("stations", "is_active", server_default=None)


def downgrade() -> None:
    op.drop_index(op.f("ix_stations_department"), table_name="stations")
    op.drop_index(op.f("ix_stations_name"), table_name="stations")
    op.drop_index(op.f("ix_stations_id"), table_name="stations")
    op.drop_table("stations")
