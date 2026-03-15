import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError


pytestmark = pytest.mark.postgres


def _postgres_url() -> str:
    return os.getenv("POSTGRES_TEST_DATABASE_URL") or os.getenv("DATABASE_URL", "")


def _skip_if_not_enabled():
    if os.getenv("RUN_POSTGRES_TESTS") != "1":
        pytest.skip("RUN_POSTGRES_TESTS != 1")

    url = _postgres_url()
    if not url.startswith("postgresql"):
        pytest.skip("DATABASE_URL is not PostgreSQL")



def test_postgres_has_active_session_unique_partial_index():
    _skip_if_not_enabled()
    engine = create_engine(_postgres_url())

    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT indexdef
                FROM pg_indexes
                WHERE schemaname = 'public'
                  AND tablename = 'inventory_sessions'
                  AND indexname = 'uq_inventory_sessions_warehouse_draft'
                """
            )
        ).fetchone()

    assert row is not None
    assert "UNIQUE INDEX" in row[0]
    assert "warehouse_id" in row[0]
    assert "status" in row[0]



def test_postgres_blocks_second_active_session_insert():
    _skip_if_not_enabled()
    engine = create_engine(_postgres_url())

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO users (username, password_hash, role, is_active)
                VALUES (:username, 'x', 'admin', true)
                ON CONFLICT (username) DO NOTHING
                """
            ),
            {"username": "pg_contract_user"},
        )
        conn.execute(
            text(
                """
                INSERT INTO zones (name, description)
                VALUES ('pg_contract_zone', 'pg contract')
                ON CONFLICT (name) DO NOTHING
                """
            )
        )
        conn.execute(
            text(
                """
                INSERT INTO warehouses (name, zone_id)
                VALUES (
                    'pg_contract_wh',
                    (SELECT id FROM zones WHERE name = 'pg_contract_zone')
                )
                ON CONFLICT (name) DO NOTHING
                """
            )
        )

    with engine.begin() as conn:
        user_id = conn.execute(
            text("SELECT id FROM users WHERE username = 'pg_contract_user'")
        ).scalar_one()
        warehouse_id = conn.execute(
            text("SELECT id FROM warehouses WHERE name = 'pg_contract_wh'")
        ).scalar_one()

        conn.execute(
            text(
                """
                INSERT INTO inventory_sessions (warehouse_id, created_by_user_id, status, created_at, updated_at)
                VALUES (:warehouse_id, :user_id, 'draft', now(), now())
                ON CONFLICT DO NOTHING
                """
            ),
            {"warehouse_id": warehouse_id, "user_id": user_id},
        )

        with pytest.raises(IntegrityError):
            conn.execute(
                text(
                    """
                    INSERT INTO inventory_sessions (warehouse_id, created_by_user_id, status, created_at, updated_at)
                    VALUES (:warehouse_id, :user_id, 'draft', now(), now())
                    """
                ),
                {"warehouse_id": warehouse_id, "user_id": user_id},
            )
