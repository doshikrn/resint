# ADR-011: Offline Queue Confirmation and Auto-Purge Policy

**Status:** Accepted  
**Date:** 2026-03-22  
**Decision makers:** Engineering team

## Context

The fast-entry screen supports offline operation via an IndexedDB/localStorage queue (`offlineQueue`). When the user submits an entry while online, it goes directly to the API. When offline, entries are queued locally and synced when connectivity returns.

The challenge: when a synced entry's server event arrives in the recent events feed, the queue item is redundant. Keeping it creates visual duplicates in the journal.

## Decision

Implement a **three-stage lifecycle** for queue items:

### 1. Dedup at display time
`buildRecentJournalEntries()` compares each queue item's `idempotency_key` against the server events' `request_id` set. If a match exists, the queue item is excluded from the journal — the server event takes precedence.

### 2. Auto-purge from storage
`findConfirmedQueueKeys()` identifies queue items where:
- `status === "synced"` (the client already sent the request)
- A server event with matching `request_id` exists (the server confirmed it)

These items are removed from IDB/LS in an `useEffect` that fires whenever `recentEvents` or `offlineQueue` changes.

### 3. No entry disappears from the journal
Auto-purge only removes the queue copy. The server event remains in `recentEvents` and is always displayed. From the user's perspective, a pending → syncing → saved transition happens seamlessly.

### Idempotency guarantee
Each queue item carries a UUID `idempotency_key`. The server stores this as `request_id` on the entry event. The backend's `_get_stored_idempotent_response()` and `_build_entries_request_hash()` prevent duplicate application even if the same request is retried.

## Consequences

- **Positive:** Offline queue stays clean — confirmed items are automatically removed.
- **Positive:** No visual duplicates in the journal.
- **Positive:** Server-side idempotency prevents double-counting even on retry.
- **Negative:** Brief window where both queue item and server event exist (between sync and next recentEvents poll). Dedup at display time handles this.
