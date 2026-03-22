# ADR-001: Inventory Router Package Split

**Status:** Accepted  
**Date:** 2026-03-22  
**Decision makers:** Engineering team

## Context

`backend/app/routers/inventory.py` had grown to **3,297 lines** containing 48 helper functions and 27 route handlers (75 total functions). The file covered six distinct domains — session lifecycle, entry CRUD, audit viewing, zone progress, reports/export, and shared utilities — all in a single module.

Problems:
- **Merge conflicts** — any inventory-related change touched the same file.
- **Cognitive load** — understanding one route required scrolling through 3k+ lines.
- **Testing isolation** — impossible to test one subsystem without importing the rest.
- **IDE perf** — large monolithic files slow down autocomplete and linting.

## Decision

Split `inventory.py` into a Python package `app/routers/inventory/` with domain-focused sub-modules:

| Module | Lines | Routes | Responsibility |
|--------|-------|--------|----------------|
| `_helpers.py` | ~1,030 | 0 | 48 shared helpers (auth, validation, events, etc.) |
| `sessions.py` | ~660 | 10 | Session lifecycle (create, close, reopen, delete) |
| `entries.py` | ~660 | 6 | Entry CRUD (add, patch, delete, recent) |
| `audit.py` | ~200 | 5 | Audit log & verification |
| `progress.py` | ~170 | 3 | Zone progress tracking |
| `reports.py` | ~610 | 6 | Reports, export, diff |
| `__init__.py` | ~30 | 0 | Combines sub-routers into one `router` |

The top-level import `from app.routers.inventory import router` remains unchanged.

## Consequences

- **Positive:** Each module is small enough to comprehend in one sitting. Merge conflicts are now localised per domain. CI can report per-module stats.
- **Negative:** Cross-module imports require `from ._helpers import ...` — slightly more verbose. Refactoring route prefixes now requires checking `__init__.py`.
- **Risk mitigated:** All 120 existing tests pass without modification (except one pre-existing test failure that was actually a missing validation — see below).

## Side-effect: Bug fix

During the split, test `test_patch_after_close_requires_reason_and_marks_action` was discovered to be failing because the "reason required for corrections after session close" validation had never been implemented. The validation was added to `entries.py` as part of this work.
