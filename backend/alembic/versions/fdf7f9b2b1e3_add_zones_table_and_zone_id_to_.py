"""add zones table and zone_id to warehouses

Revision ID: fdf7f9b2b1e3
Revises: f9c28fda7632
Create Date: 2026-02-22 11:27:50.470540

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "fdf7f9b2b1e3"
down_revision: str = "f9c28fda7632"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    # 1) zones (создаём только если не существует)
    if "zones" not in tables:
        op.create_table(
            "zones",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("description", sa.String(length=255), nullable=True),
        )
        op.create_index("ix_zones_id", "zones", ["id"])
        op.create_index("ix_zones_name", "zones", ["name"], unique=True)

    # 2) zone_id (добавляем только если колонки ещё нет)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    warehouses_columns = [col["name"] for col in inspector.get_columns("warehouses")]
    
    if "zone_id" not in warehouses_columns:
        op.add_column("warehouses", sa.Column("zone_id", sa.Integer(), nullable=True))
        op.create_index("ix_warehouses_zone_id", "warehouses", ["zone_id"])
        op.create_foreign_key(
            "fk_warehouses_zone_id_zones",
            "warehouses",
            "zones",
            ["zone_id"],
            ["id"],
            ondelete="RESTRICT",
        )

    # 3) backfill zone_id (если есть NULL значения)
    existing_default = conn.execute(sa.text("SELECT id FROM zones WHERE name = :n"), {"n": "Default"}).scalar()
    
    if existing_default is None:
        # "Default" зона не существует - создаём
        conn.execute(sa.text("INSERT INTO zones (name, description) VALUES (:n, :d)"),
                     {"n": "Default", "d": "Auto-created during migration"})
        default_zone_id = conn.execute(sa.text("SELECT id FROM zones WHERE name = :n"), {"n": "Default"}).scalar()
    else:
        default_zone_id = existing_default

    # Обновляем NULL значения
    conn.execute(sa.text("UPDATE warehouses SET zone_id = :z WHERE zone_id IS NULL"),
                 {"z": default_zone_id})


def downgrade():
    op.drop_constraint("fk_warehouses_zone_id_zones", "warehouses", type_="foreignkey")
    op.drop_index("ix_warehouses_zone_id", table_name="warehouses")
    op.drop_column("warehouses", "zone_id")

    op.drop_index("ix_zones_name", table_name="zones")
    op.drop_index("ix_zones_id", table_name="zones")
    op.drop_table("zones")
