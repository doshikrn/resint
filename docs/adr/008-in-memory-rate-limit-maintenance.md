# ADR-008: In-Memory Rate Limiter and Maintenance Mode

**Status:** Accepted  
**Date:** 2026-03-22  
**Decision makers:** Engineering team

## Context

Two operational safety mechanisms use in-memory state:

### Rate Limiter (`core/rate_limit.py`)
- Sliding-window counter per (IP+username) for login failures (5 attempts / 5 min) and per-IP for item search (120 requests / 60s).
- Thread-safe via `threading.Lock`.
- State is **not** shared across processes or persisted to disk/DB.

### Maintenance Mode (`core/maintenance.py`)
- Boolean flag toggled via admin API.
- Blocks all non-GET requests (except health check and admin/backups endpoints) with HTTP 503.
- State is **not** persisted — restarting the process clears maintenance mode.

## Decision

**Keep both mechanisms in-memory.** Do not migrate to Redis/DB-backed implementations.

### Rationale

1. **Single-worker deployment**: The production setup runs a single Gunicorn worker with Uvicorn. There is no multi-process state sharing requirement.
2. **Rate limiter scope**: Login rate limiting is a defense-in-depth measure against credential stuffing. At current scale (< 50 concurrent users), the in-memory approach is sufficient. The sliding window automatically expires stale entries.
3. **Maintenance mode lifecycle**: Maintenance mode is activated before database restore operations. The restore process itself triggers a container restart, which naturally clears the flag. Persistence would actually be harmful — a stuck maintenance flag after a failed restore would require manual intervention.
4. **Operational simplicity**: No Redis dependency to manage, monitor, or secure. The application stack remains PostgreSQL-only.

### When to revisit

Migrate to Redis-backed rate limiting if:
- The deployment scales to multiple Gunicorn workers or multiple containers behind a load balancer
- Brute-force login attempts exceed the capacity of in-memory tracking
- Regulatory requirements mandate persistent audit trails for rate-limit events

## Consequences

- **Positive:** Zero additional infrastructure dependencies.
- **Positive:** Maintenance mode auto-clears on restart — no risk of a stuck 503.
- **Positive:** Rate limiter state auto-clears on deploy — no stale lockouts after releases.
- **Negative:** Rate limits reset on application restart. Acceptable at current scale.
- **Negative:** Rate limits are per-process only. Would not work correctly with multiple workers.
