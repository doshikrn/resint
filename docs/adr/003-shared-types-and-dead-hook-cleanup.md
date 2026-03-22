# ADR-003: Shared Fast-Entry Types & Dead Hook Cleanup

**Status:** Accepted  
**Date:** 2026-03-22  
**Decision makers:** Engineering team

## Context

### Duplicated types
`CurrentUserLike`, `PendingQtyConfirm`, and `QtyValidation` were defined independently in both `use-fast-entry.ts` and `use-entry-submit.ts` with identical shapes. A comment in `use-entry-submit.ts` read:

> "Mirrors CurrentUserLike in use-fast-entry (structural compatibility, no circular import)"

This meant any field addition had to be mirrored manually — a DRY violation and a source of silent drift.

### Dead hooks
Three hooks had zero imports anywhere in the codebase:
- `useAppReady` — returned hardcoded `true` (stub from an earlier iteration)
- `useHeartbeat` — 30-second heartbeat; superseded by `usePresence`
- `useOnlineUsers` — 15-second online-users poll; superseded by `usePresence`

## Decision

1. **Create `lib/hooks/fast-entry-types.ts`** as the single source of truth for all shared types across the fast-entry hook family: `CurrentUserLike`, `PendingQtyConfirm`, `QtyValidation`, `RecentJournalEntry`, `RecentJournalGroup`, `UseFastEntryParams`.

2. **Update both hooks** to import from the shared file. `use-fast-entry.ts` re-exports the types for backward compatibility with any external consumer.

3. **Delete the three dead hooks** — `use-app-ready.ts`, `use-heartbeat.ts`, `use-online-users.ts`.

## Consequences

- **Positive:** Single definition per type; adding a field is a one-file change. 3 fewer files to maintain. No risk of type drift.
- **Negative:** One new file in `lib/hooks/`.
- **Risk mitigated:** Re-exports from `use-fast-entry.ts` ensure existing consumers are unaffected.
