"""Domain enums for inventory models.

These are ``(str, Enum)`` classes so that their members behave like plain
strings in SQLAlchemy comparisons, Pydantic serialization, and JSON output.
Database columns continue to store plain VARCHAR values.
"""

from enum import Enum


# ── Session lifecycle status ────────────────────────────────

class SessionStatus(str, Enum):
    DRAFT = "draft"
    CLOSED = "closed"


# ── Entry-level event actions ───────────────────────────────

class EntryAction(str, Enum):
    ADD = "add"
    SET = "set"
    PATCH = "patch"
    DELETE = "delete"
    CORRECT_AFTER_CLOSE = "correct_after_close"


# ── Session-level event actions ─────────────────────────────

class SessionEventAction(str, Enum):
    SESSION_CLOSED = "session_closed"
    REVISION_REOPENED = "revision_reopened"
    SESSION_DELETED = "session_deleted"
    ZONE_COMPLETED = "zone_completed"


# ── Audit-log actions (inventory domain only) ──────────────

class AuditAction(str, Enum):
    REVISION_CREATED = "revision_created"
    REVISION_CLOSED = "revision_closed"
    REVISION_REOPENED = "revision_reopened"
    REVISION_DELETED = "revision_deleted"
    REVISION_EXPORTED = "revision_exported"
    ENTRY_CORRECTED = "entry_corrected"
    ENTRY_UPDATED = "entry_updated"
    ENTRY_DELETED = "entry_deleted"
