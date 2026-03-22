# ADR-005: Helpers Module Split (_helpers.py → 6 Focused Modules)

**Status:** Accepted  
**Date:** 2026-03-22  
**Decision makers:** Engineering team

## Context

After ADR-001 split the monolithic `inventory.py` router into 5 sub-routers, shared helper functions accumulated in `_helpers.py` (859 lines, 48 functions). This file became a second-order "god-helper" with no domain cohesion — auth guards, qty validation, event builders, session CRUD, zone-progress state, and idempotency logic were all mixed together.

Sub-router dependencies were uneven:
- `entries.py` imported 20 helpers
- `sessions.py` imported 15
- `progress.py` imported 12
- `reports.py` imported 9
- `audit.py` imported 5

## Decision

Split `_helpers.py` into 7 focused modules under `backend/app/routers/inventory/`:

| Module | Responsibility | Functions |
|--------|---------------|-----------|
| `_common.py` | Shared micro-utility (`_raise_api_error`) | 1 |
| `_auth.py` | Permission guards, warehouse access | 9 |
| `_validation.py` | Qty normalization, item validation, ETag/version parsing | 7 |
| `_events.py` | Audit-event builders, user display names, contributors | 6 |
| `_session_ops.py` | Session CRUD, station resolution, snapshots, counters | 14 |
| `_progress.py` | Zone-progress state machine | 5 |
| `_idempotency.py` | Request hashing, idempotency store, report aggregation, catalog ETag | 7 |

The original `_helpers.py` becomes a thin re-export facade that imports and re-exports every symbol, so all existing `from app.routers.inventory._helpers import (...)` statements in sub-routers continue working with zero changes.

## Consequences

- **Positive:** Each module has a single domain responsibility. Developers can understand and modify one concern without scanning 860 lines.
- **Positive:** Import dependency graph is now explicit — circular imports are structurally prevented by the layering (_common → _auth → _validation → _events → _session_ops → _progress → _idempotency).
- **Positive:** Zero breaking changes — existing imports all route through the facade.
- **Negative:** 7 new files. Marginal navigation overhead in IDE, mitigated by clear naming convention.
