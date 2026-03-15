"""add revision_no and deleted_at to inventory_sessions

Revision ID: c0ffee123456
Revises: b8c9d0e1f2a3
Create Date: 2026-03-03 00:00:00.000000
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "c0ffee123456"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None


def _backfill_revision_numbers(connection) -> None:
    dialect = connection.dialect.name
    if dialect == "postgresql":
        connection.execute(
            sa.text(
                """
            WITH numbered AS (
                SELECT
                    id,
                    ROW_NUMBER() OVER (PARTITION BY warehouse_id ORDER BY created_at, id) AS revision_no
                FROM inventory_sessions
            )
            UPDATE inventory_sessions s
            SET revision_no = numbered.revision_no
            FROM numbered
            WHERE s.id = numbered.id
            """
            )
        )
        return

    rows = connection.execute(
        sa.text(
            "SELECT id, warehouse_id FROM inventory_sessions ORDER BY warehouse_id, created_at, id"
        )
    ).fetchall()
    current_warehouse = None
    counter = 0
    for row in rows:
        if current_warehouse != row.warehouse_id:
            current_warehouse = row.warehouse_id
            counter = 1
        else:
            counter += 1
        connection.execute(
            sa.text("UPDATE inventory_sessions SET revision_no = :rev WHERE id = :id"),
            {"rev": counter, "id": row.id},
        )


def upgrade() -> None:
    with op.batch_alter_table("inventory_sessions") as batch_op:
        batch_op.add_column(sa.Column("revision_no", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))

    connection = op.get_bind()
    _backfill_revision_numbers(connection)

    with op.batch_alter_table("inventory_sessions") as batch_op:
        batch_op.alter_column("revision_no", nullable=False)
        batch_op.create_unique_constraint(
            "uq_inventory_sessions_revision_no",
            ["warehouse_id", "revision_no"],
        )


def downgrade() -> None:
    with op.batch_alter_table("inventory_sessions") as batch_op:
        batch_op.drop_constraint("uq_inventory_sessions_revision_no", type_="unique")
        batch_op.drop_column("deleted_at")
        batch_op.drop_column("revision_no")
