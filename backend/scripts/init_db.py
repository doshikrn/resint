"""
init_db.py — Idempotent production database bootstrap.

Behaviour
---------
FRESH database (no alembic_version table and no users table):
  1. Drop and recreate the ``public`` schema (clean slate).
  2. Create all tables via SQLAlchemy ``metadata.create_all()``.
     SQLAlchemy resolves FK dependencies with a topological sort, so the
     creation order is always correct regardless of the order models are
     imported:  zones → stations → warehouses → users → items → …
  3. Stamp Alembic at HEAD so that future ``alembic upgrade head`` calls are
     no-ops until a new migration is added.
  4. Create the initial admin user.

EXISTING database (alembic_version or users table already present):
  Skip schema creation entirely.  ``alembic upgrade head`` in entrypoint.sh
  will apply any pending migrations.
  Still ensures the admin user exists (idempotent).

Environment variables
---------------------
DATABASE_URL        — required (set by docker-compose)
ADMIN_USERNAME      — optional, default: admin
ADMIN_PASSWORD      — optional, default: AdminPassword2026!
ADMIN_FULL_NAME     — optional, default: Administrator

Exit codes
----------
0 — success
1 — fatal error (the container will restart and try again)
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

# ── Make the backend package importable when called as a script ───────────────
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import sqlalchemy as sa
from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig

# Importing app.db.base registers ALL ORM models with Base.metadata so that
# create_all() sees every table, including the ones added in later migrations.
import app.db.base  # noqa: F401
from app.core.security import hash_password
from app.db.base_class import Base
from app.db.session import engine

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [init_db] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

# ── Runtime configuration ─────────────────────────────────────────────────────
ADMIN_USERNAME: str = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "AdminPassword2026!")
ADMIN_FULL_NAME: str = os.getenv("ADMIN_FULL_NAME", "Administrator")
ADMIN_ROLE: str = "manager"

ALEMBIC_INI: Path = BACKEND_DIR / "alembic.ini"


# ── Step helpers ──────────────────────────────────────────────────────────────

def _is_fresh_db() -> bool:
    """Return True when the database has no application tables yet.

    We check for *both* ``alembic_version`` (Alembic bookkeeping) and
    ``users`` (the first table in the init migration) so that a half-failed
    previous run does not falsely look like a fresh database.
    """
    with engine.connect() as conn:
        inspector = sa.inspect(conn)
        tables = set(inspector.get_table_names(schema="public"))
    fresh = "alembic_version" not in tables and "users" not in tables
    log.info(
        "Database state: %s (tables found: %s)",
        "FRESH" if fresh else "EXISTING",
        sorted(tables) if tables else "none",
    )
    return fresh


def _bootstrap_schema() -> None:
    """Drop and recreate the public schema, then build all tables.

    Using ``DROP SCHEMA … CASCADE`` guarantees a truly clean slate even if a
    previous half-initialised run left orphaned objects.  The subsequent
    ``create_all()`` call lets SQLAlchemy's dependency resolver emit every
    ``CREATE TABLE`` in the correct FK-safe order.
    """
    log.info("Dropping public schema (CASCADE) …")
    with engine.begin() as conn:
        conn.execute(sa.text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(sa.text("CREATE SCHEMA public"))
        # Restore default privileges so the app user can access the schema.
        conn.execute(sa.text("GRANT ALL ON SCHEMA public TO PUBLIC"))

    log.info("Creating all tables (SQLAlchemy topological FK ordering) …")
    # create_all resolves: zones → stations → warehouses → users → items → …
    Base.metadata.create_all(engine)
    log.info("Schema bootstrap complete.")


def _stamp_alembic_head() -> None:
    """Write HEAD into alembic_version so future upgrades are no-ops.

    This must be called *after* ``_bootstrap_schema()`` because the
    ``alembic_version`` table is created by the first migration and we just
    created it via ``create_all()``.
    """
    cfg = AlembicConfig(str(ALEMBIC_INI))
    # Always override with the runtime DATABASE_URL so the stamp targets the
    # correct database regardless of what is written in alembic.ini.
    cfg.set_main_option("sqlalchemy.url", str(engine.url))
    alembic_command.stamp(cfg, "head")
    log.info("Alembic stamped at HEAD.")


def _ensure_admin_user() -> None:
    """Insert the admin user if it does not already exist (idempotent).

    Uses raw SQL to stay independent of the ORM session lifecycle and to
    avoid any accidental side effects from SQLAlchemy events.
    """
    with engine.begin() as conn:
        exists = conn.execute(
            sa.text("SELECT 1 FROM users WHERE username = :u LIMIT 1"),
            {"u": ADMIN_USERNAME},
        ).scalar()

        if exists:
            log.info("Admin user '%s' already exists — skipping.", ADMIN_USERNAME)
            return

        conn.execute(
            sa.text(
                "INSERT INTO users "
                "(username, full_name, password_hash, role, is_active) "
                "VALUES (:username, :full_name, :password_hash, :role, :is_active)"
            ),
            {
                "username": ADMIN_USERNAME,
                "full_name": ADMIN_FULL_NAME,
                "password_hash": hash_password(ADMIN_PASSWORD),
                "role": ADMIN_ROLE,
                "is_active": True,
            },
        )

    log.info(
        "Admin user '%s' created  (role=%s, full_name='%s').",
        ADMIN_USERNAME,
        ADMIN_ROLE,
        ADMIN_FULL_NAME,
    )


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> int:
    log.info("=== init_db starting ===")
    try:
        fresh = _is_fresh_db()

        if fresh:
            log.info("First-deploy path: bootstrapping full schema …")
            _bootstrap_schema()
            _stamp_alembic_head()
        else:
            log.info(
                "Re-deploy path: schema bootstrap skipped. "
                "Alembic will apply any pending migrations."
            )

        _ensure_admin_user()

        log.info("=== init_db finished successfully ===")
        return 0

    except Exception:
        log.exception("init_db FAILED with an unhandled exception")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
