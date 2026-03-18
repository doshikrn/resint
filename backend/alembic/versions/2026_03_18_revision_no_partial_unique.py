"""replace revision_no unique constraint with partial unique index

The full UniqueConstraint(warehouse_id, revision_no) prevents reusing
revision numbers for soft-deleted sessions.  Replace it with a partial
unique index that only enforces uniqueness among non-deleted rows
(WHERE deleted_at IS NULL), so deleted revision numbers become available
for new sessions.

Revision ID: n3o4p5q6r7s8
Revises: m2n3o4p5q6r7
Create Date: 2026-03-18 10:00:00.000000

"""
from alembic import op


revision = "n3o4p5q6r7s8"
down_revision = "m2n3o4p5q6r7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "uq_inventory_sessions_revision_no",
        "inventory_sessions",
        type_="unique",
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_inventory_sessions_revision_no "
        "ON inventory_sessions (warehouse_id, revision_no) "
        "WHERE deleted_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_inventory_sessions_revision_no")
    op.create_unique_constraint(
        "uq_inventory_sessions_revision_no",
        "inventory_sessions",
        ["warehouse_id", "revision_no"],
    )
