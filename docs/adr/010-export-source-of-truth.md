# ADR-010: Export Source of Truth — Session Entries vs Snapshot

**Status:** Accepted  
**Date:** 2026-03-22  
**Decision makers:** Engineering team

## Context

The export system must decide which data to use as the canonical source for generating inventory reports:

1. **Live entries** (`inventory_entries` table) — real-time, mutable rows updated during a session
2. **Session totals snapshot** (`inventory_session_totals` table) — point-in-time snapshot captured when a session is closed

The `_collect_session_rows()` helper implements the decision logic, called by both export and report aggregation.

## Decision

Use a **snapshot-first, live-fallback** strategy:

```
if session is closed AND snapshot table exists AND snapshot has rows:
    → use snapshot (immutable point-in-time data)
else:
    → use live entries (current state)
```

### Rationale

1. **Closed sessions are immutable**: Once closed, session entries should not change. The snapshot captures the final state at close time via `_snapshot_session_totals()`.
2. **Live sessions need live data**: Draft/active sessions haven't been finalized — only live entries are meaningful.
3. **Graceful degradation**: If the snapshot table doesn't exist (pre-migration environments) or is empty (legacy sessions closed before snapshot feature), the system falls back to live entries seamlessly.
4. **Report consistency**: The `_aggregate_window()` function uses this same logic, ensuring reports and exports agree on the same source data.

## Consequences

- **Positive:** Export of closed sessions is stable — editing entries after close doesn't affect previously-generated reports.
- **Positive:** Backward compatible — works on databases where snapshot table hasn't been migrated yet.
- **Negative:** If `_snapshot_session_totals()` fails during close, the snapshot may be incomplete. Fallback to live entries mitigates this.
