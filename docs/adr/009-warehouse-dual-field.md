# ADR-009: Warehouse Dual-Field Design (warehouse_id vs default_warehouse_id)

**Status:** Accepted  
**Date:** 2026-03-22  
**Decision makers:** Engineering team

## Context

The `User` model has two warehouse foreign keys:
- `warehouse_id` — the user's **current operational assignment** (the warehouse they are actively working in)
- `default_warehouse_id` — the user's **preferred/home warehouse** (used as a fallback)

Both are nullable. The resolution logic in `_resolve_user_warehouse_id()` implements a cascade:
1. If `warehouse_id` is set → use it
2. Else if `default_warehouse_id` is set → use it
3. Else → return `None` (user is unbound, gets 403 on warehouse-scoped operations)

## Decision

**Retain the dual-field design.** Both fields serve distinct operational purposes.

### Use cases

| Field | Set by | Purpose |
|-------|--------|---------|
| `warehouse_id` | Admin assignment | Current shift assignment. Can change daily for mobile staff. |
| `default_warehouse_id` | Admin or self-service | Home warehouse. Stable across shifts. Used when `warehouse_id` is cleared (user not on active duty). |

### Why not a single field?

A single `warehouse_id` would require clearing it when a user finishes a shift (to prevent stale access), but then the system loses their preferred warehouse for next login. The dual-field design allows:
- Clear `warehouse_id` after a shift → user falls back to `default_warehouse_id`
- Set `warehouse_id` for temporary reassignment → `default_warehouse_id` preserves their home base
- Both null → user is explicitly unbound (new hire, pending assignment)

## Consequences

- **Positive:** Clean separation of temporary assignment vs permanent preference.
- **Positive:** Cascade logic is centralized in `_resolve_user_warehouse_id()` — all warehouse-scoped operations use the same resolution.
- **Negative:** Two FK columns add marginal schema complexity. New developers must understand the cascade.
- **Negative:** Admin UI must expose both fields (currently does).
