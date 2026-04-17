"""check_migration_safety.py — Pre-migration safety gate.

Scans Alembic migration files for destructive operations (DROP COLUMN,
DROP TABLE, DROP CONSTRAINT) inside the ``upgrade()`` function.

Key behaviour
-------------
Only PENDING migrations are scanned.  If a migration has already been applied
to the target database its ``upgrade()`` will never run again, so there is
no danger — the gate lets it through silently.

If the database is unreachable the script falls back to checking all migration
files (conservative / safe-by-default).

Exit codes
----------
0 — no dangerous pending migrations, or all dangerous ones are approved
1 — dangerous pending migrations found without explicit override
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"
ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"

# ---------------------------------------------------------------------------
# Patterns that indicate a destructive upgrade
# ---------------------------------------------------------------------------

DANGEROUS_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("op.drop_column",     re.compile(r"\bop\.drop_column\s*\(",     re.IGNORECASE)),
    ("op.drop_table",      re.compile(r"\bop\.drop_table\s*\(",      re.IGNORECASE)),
    ("op.drop_constraint", re.compile(r"\bop\.drop_constraint\s*\(", re.IGNORECASE)),
    (
        "raw_sql_drop_column",
        re.compile(r"\bALTER\s+TABLE\b[\s\S]{0,300}\bDROP\s+COLUMN\b", re.IGNORECASE),
    ),
)

# Captures everything between ``def upgrade(...):`` and ``def downgrade(``.
UPGRADE_BLOCK_RE = re.compile(
    r"def\s+upgrade\s*\([^)]*\)\s*:\s*(?P<body>[\s\S]*?)"
    r"(?:\n\s*def\s+downgrade\s*\(|\Z)",
    re.IGNORECASE,
)

# Extracts the ``revision = "abc123"`` declaration from a migration file.
REVISION_ID_RE = re.compile(
    r'^\s*revision\s*(?::\s*\w+)?\s*=\s*["\']([a-zA-Z0-9_]+)["\']',
    re.MULTILINE,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_enabled(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "y"}


def _extract_revision_id(content: str) -> str | None:
    """Return the revision ID declared in a migration file, or None."""
    match = REVISION_ID_RE.search(content)
    return match.group(1) if match else None


def _get_pending_revision_ids() -> set[str] | None:
    """Return the set of revision IDs that have NOT yet been applied.

    Uses Alembic's own revision graph + the live ``alembic_version`` table so
    the result is exact.

    Returns ``None`` when the database cannot be reached, signalling that the
    caller should treat all revisions as pending (conservative fallback).
    """
    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        return None  # no URL → conservative: check everything

    if not ALEMBIC_INI.exists():
        return None  # can't build ScriptDirectory without alembic.ini

    try:
        from sqlalchemy import create_engine
        from alembic.config import Config as AlembicConfig
        from alembic.runtime.migration import MigrationContext
        from alembic.script import ScriptDirectory

        cfg = AlembicConfig(str(ALEMBIC_INI))
        cfg.set_main_option("sqlalchemy.url", database_url)
        script = ScriptDirectory.from_config(cfg)

        _engine = create_engine(
            database_url,
            connect_args={"connect_timeout": 5},
            pool_pre_ping=True,
        )
        with _engine.connect() as conn:
            ctx = MigrationContext.configure(conn)
            current_heads: set[str] = set(ctx.get_current_heads())
        _engine.dispose()

        if not current_heads:
            # Nothing applied yet → every revision is pending.
            return {rev.revision for rev in script.walk_revisions()}

        # Walk the revision graph backwards from every current head to
        # collect all revisions that have already been applied.
        applied: set[str] = set()

        def _collect(rev_id: str) -> None:
            if not rev_id or rev_id in applied:
                return
            applied.add(rev_id)
            rev = script.get_revision(rev_id)
            if rev is None:
                return
            down = rev.down_revision
            if isinstance(down, (list, tuple)):
                for parent in down:
                    _collect(parent)
            elif down:
                _collect(down)

        for head in current_heads:
            _collect(head)

        all_revisions = {rev.revision for rev in script.walk_revisions()}
        pending = all_revisions - applied
        print(
            f"migration_safety_guard db_heads={sorted(current_heads)} "
            f"pending_count={len(pending)}"
        )
        return pending

    except Exception as exc:  # noqa: BLE001
        print(
            f"migration_safety_guard status=warning "
            f"reason=cannot_determine_pending_revisions msg={exc}"
        )
        return None  # conservative fallback


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    if not _is_enabled("MIGRATION_GUARD_ENABLED", "1"):
        print("migration_safety_guard status=disabled")
        return 0

    if not VERSIONS_DIR.exists():
        print(
            f"migration_safety_guard status=skipped "
            f"reason=missing_versions_dir path={VERSIONS_DIR}"
        )
        return 0

    # Determine which revisions are still pending.
    # ``None`` means "could not connect — be conservative and check all files".
    pending_revision_ids = _get_pending_revision_ids()

    dangerous_hits: list[tuple[Path, str]] = []

    for path in sorted(VERSIONS_DIR.glob("*.py")):
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            content = path.read_text(encoding="latin-1")

        # Skip migrations that have already been applied to the database.
        # Their upgrade() will never run again, so they pose no risk.
        if pending_revision_ids is not None:
            revision_id = _extract_revision_id(content)
            if revision_id and revision_id not in pending_revision_ids:
                continue  # already applied — safe to ignore

        match = UPGRADE_BLOCK_RE.search(content)
        upgrade_body = match.group("body") if match else ""

        for label, pattern in DANGEROUS_PATTERNS:
            if pattern.search(upgrade_body):
                dangerous_hits.append((path, label))

    if not dangerous_hits:
        print("migration_safety_guard status=ok dangerous_pending_migrations=0")
        return 0

    backup_confirmed = _is_enabled("MIGRATION_BACKUP_CONFIRMED", "0")
    restore_check_confirmed = _is_enabled("MIGRATION_RESTORE_CHECK_CONFIRMED", "0")

    print("migration_safety_guard status=dangerous_pending_detected")
    for path, label in dangerous_hits:
        print(f"  file={path.name} pattern={label}")

    if backup_confirmed and restore_check_confirmed:
        print("migration_safety_guard status=approved_with_overrides")
        return 0

    print(
        "migration_safety_guard status=blocked "
        "reason=dangerous_pending_migration_without_backup_or_restore_check "
        "required_env=MIGRATION_BACKUP_CONFIRMED=1,MIGRATION_RESTORE_CHECK_CONFIRMED=1"
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
