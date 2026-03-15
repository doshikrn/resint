"""add station_id to items

Revision ID: b9c0d1e2f3a4
Revises: f3b4c5d6e7f8
Create Date: 2026-02-26 18:10:00.000000
"""
# ruff: noqa: I001

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b9c0d1e2f3a4"
down_revision = "f3b4c5d6e7f8"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    item_columns = [col["name"] for col in inspector.get_columns("items")]
    if "station_id" not in item_columns:
        op.add_column("items", sa.Column("station_id", sa.Integer(), nullable=True))

    item_indexes = {index["name"] for index in inspector.get_indexes("items")}
    if "ix_items_station_id" not in item_indexes:
        op.create_index("ix_items_station_id", "items", ["station_id"], unique=False)

    item_fks = {fk.get("name") for fk in inspector.get_foreign_keys("items")}
    if "fk_items_station_id_stations" not in item_fks:
        op.create_foreign_key(
            "fk_items_station_id_stations",
            "items",
            "stations",
            ["station_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    item_fks = {fk.get("name") for fk in inspector.get_foreign_keys("items")}
    if "fk_items_station_id_stations" in item_fks:
        op.drop_constraint("fk_items_station_id_stations", "items", type_="foreignkey")

    item_indexes = {index["name"] for index in inspector.get_indexes("items")}
    if "ix_items_station_id" in item_indexes:
        op.drop_index("ix_items_station_id", table_name="items")

    item_columns = [col["name"] for col in inspector.get_columns("items")]
    if "station_id" in item_columns:
        op.drop_column("items", "station_id")
