"""add station to entries and users

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-02-26 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "f2a3b4c5d6e7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def _ensure_unknown_station(bind) -> int:
    stations_table = sa.table(
        "stations",
        sa.column("id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("department", sa.String()),
        sa.column("is_active", sa.Boolean()),
        sa.column("sort_order", sa.Integer()),
    )

    existing = bind.execute(
        sa.select(stations_table.c.id)
        .where(sa.func.lower(stations_table.c.name) == "unknown")
        .order_by(stations_table.c.id.asc())
        .limit(1)
    ).first()
    if existing:
        return int(existing[0])

    inserted = bind.execute(
        sa.insert(stations_table).values(
            name="Unknown",
            department="kitchen",
            is_active=True,
            sort_order=9999,
        )
    )

    inserted_id = getattr(inserted, "inserted_primary_key", None)
    if inserted_id and inserted_id[0] is not None:
        return int(inserted_id[0])

    fallback = bind.execute(
        sa.select(stations_table.c.id)
        .where(sa.func.lower(stations_table.c.name) == "unknown")
        .order_by(stations_table.c.id.asc())
        .limit(1)
    ).first()
    if not fallback:
        raise RuntimeError("Failed to ensure Unknown station")
    return int(fallback[0])


def upgrade() -> None:
    bind = op.get_bind()
    unknown_station_id = _ensure_unknown_station(bind)

    op.add_column("users", sa.Column("default_station_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_users_default_station_id"), "users", ["default_station_id"], unique=False)
    op.create_foreign_key(
        "fk_users_default_station_id_stations",
        "users",
        "stations",
        ["default_station_id"],
        ["id"],
    )

    op.add_column("inventory_entries", sa.Column("station_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_inventory_entries_station_id"), "inventory_entries", ["station_id"], unique=False)
    op.create_foreign_key(
        "fk_inventory_entries_station_id_stations",
        "inventory_entries",
        "stations",
        ["station_id"],
        ["id"],
    )

    op.add_column("inventory_entry_events", sa.Column("station_id", sa.Integer(), nullable=True))
    op.create_index(
        op.f("ix_inventory_entry_events_station_id"),
        "inventory_entry_events",
        ["station_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_inventory_entry_events_station_id_stations",
        "inventory_entry_events",
        "stations",
        ["station_id"],
        ["id"],
    )

    bind.execute(
        sa.text("UPDATE inventory_entries SET station_id = :station_id WHERE station_id IS NULL"),
        {"station_id": unknown_station_id},
    )
    bind.execute(
        sa.text("UPDATE inventory_entry_events SET station_id = :station_id WHERE station_id IS NULL"),
        {"station_id": unknown_station_id},
    )


def downgrade() -> None:
    op.drop_constraint("fk_inventory_entry_events_station_id_stations", "inventory_entry_events", type_="foreignkey")
    op.drop_index(op.f("ix_inventory_entry_events_station_id"), table_name="inventory_entry_events")
    op.drop_column("inventory_entry_events", "station_id")

    op.drop_constraint("fk_inventory_entries_station_id_stations", "inventory_entries", type_="foreignkey")
    op.drop_index(op.f("ix_inventory_entries_station_id"), table_name="inventory_entries")
    op.drop_column("inventory_entries", "station_id")

    op.drop_constraint("fk_users_default_station_id_stations", "users", type_="foreignkey")
    op.drop_index(op.f("ix_users_default_station_id"), table_name="users")
    op.drop_column("users", "default_station_id")
