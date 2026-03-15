from __future__ import annotations

import os
import re
import sys
from pathlib import Path

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"

DANGEROUS_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("op.drop_column", re.compile(r"\bop\.drop_column\s*\(", re.IGNORECASE)),
    ("op.drop_table", re.compile(r"\bop\.drop_table\s*\(", re.IGNORECASE)),
    ("op.drop_constraint", re.compile(r"\bop\.drop_constraint\s*\(", re.IGNORECASE)),
    (
        "raw_sql_drop_column",
        re.compile(r"\bALTER\s+TABLE\b[\s\S]{0,300}\bDROP\s+COLUMN\b", re.IGNORECASE),
    ),
)

UPGRADE_BLOCK_RE = re.compile(
    r"def\s+upgrade\s*\([^)]*\)\s*:\s*(?P<body>[\s\S]*?)(?:\n\s*def\s+downgrade\s*\(|\Z)",
    re.IGNORECASE,
)


def _is_enabled(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "y"}


def main() -> int:
    if not _is_enabled("MIGRATION_GUARD_ENABLED", "1"):
        print("migration_safety_guard status=disabled")
        return 0

    dangerous_hits: list[tuple[Path, str]] = []

    if not VERSIONS_DIR.exists():
        print(f"migration_safety_guard status=skipped reason=missing_versions_dir path={VERSIONS_DIR}")
        return 0

    for path in sorted(VERSIONS_DIR.glob("*.py")):
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            content = path.read_text(encoding="latin-1")

        match = UPGRADE_BLOCK_RE.search(content)
        upgrade_body = match.group("body") if match else ""

        for label, pattern in DANGEROUS_PATTERNS:
            if pattern.search(upgrade_body):
                dangerous_hits.append((path, label))

    if not dangerous_hits:
        print("migration_safety_guard status=ok dangerous_migrations=0")
        return 0

    backup_confirmed = _is_enabled("MIGRATION_BACKUP_CONFIRMED", "0")
    restore_check_confirmed = _is_enabled("MIGRATION_RESTORE_CHECK_CONFIRMED", "0")

    print("migration_safety_guard status=dangerous_detected")
    for path, label in dangerous_hits:
        print(f" - file={path.name} pattern={label}")

    if backup_confirmed and restore_check_confirmed:
        print("migration_safety_guard status=approved_with_overrides")
        return 0

    print(
        "migration_safety_guard status=blocked reason=dangerous_migration_without_backup_or_restore_check "
        "required_env=MIGRATION_BACKUP_CONFIRMED=1,MIGRATION_RESTORE_CHECK_CONFIRMED=1"
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())