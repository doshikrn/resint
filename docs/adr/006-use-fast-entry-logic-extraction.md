# ADR-006: useFastEntry Logic Extraction

**Status:** Accepted  
**Date:** 2026-03-22  
**Decision makers:** Engineering team

## Context

`useFastEntry` (1,028 lines) is the central orchestration hook for the fast-entry inventory screen. It mixes:
- React state management and effects (orchestration)
- Pure business logic (qty validation rules, journal building)

The qty validation block (~140 LOC) and recent-journal derivation block (~120 LOC) are pure computations that depend only on input data, not on React lifecycle. They are testable in isolation and reusable outside the hook.

## Decision

Extract two pure-function modules:

1. **`lib/inventory-qty-validation.ts`** — `validateItemQty()` and `computeAverageQty()`
   - Parsing, range validation, step alignment, soft/hard warnings
   - Previously inline in a single `useMemo` block

2. **`lib/inventory-recent-journal.ts`** — `buildRecentJournalEntries()`, `groupJournalEntries()`, `findConfirmedQueueKeys()`
   - Merges offline queue items with server events, deduplicates by request_id
   - Groups entries by relative-time labels
   - Finds confirmed queue keys for auto-purge

The hook now calls these pure functions inside `useMemo`/`useEffect`, reducing its size from 1,028 to ~840 lines.

## Consequences

- **Positive:** ~190 lines of business logic moved to unit-testable pure functions.
- **Positive:** Journal and validation logic can be reused in other views (e.g., report previews) without depending on the full hook.
- **Positive:** Hook remains the single orchestration point — no UX or behavior changes.
- **Negative:** Two new files. Import list in the hook grows slightly.
