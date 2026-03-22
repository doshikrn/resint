# ADR-012: Auth & Session Cookie Contract

**Status:** Accepted  
**Date:** 2026-03-22  
**Decision makers:** Engineering team

## Context

The application uses a JWT-based authentication flow with access and refresh tokens stored in httpOnly cookies. The frontend Next.js proxy handles token lifecycle transparently — the browser never sees raw tokens.

## Architecture

```
Browser  ──►  Next.js API Routes (proxy)  ──►  FastAPI Backend
               │                                    │
               │  httpOnly cookies                   │  Bearer JWT header
               │  (rr_access_token,                  │  (Authorization: Bearer ...)
               │   rr_refresh_token)                 │
```

### Cookie Configuration

| Cookie | Value | httpOnly | Secure | SameSite | Path | maxAge |
|--------|-------|----------|--------|----------|------|--------|
| `rr_access_token` | JWT (HS256) | Yes | production only | Lax | `/` | 12 hours |
| `rr_refresh_token` | `secrets.token_urlsafe(48)` | Yes | production only | Lax | `/` | 14 days |

### Token Lifecycle

1. **Login** (`POST /api/auth/login`):
   - Next.js proxy forwards credentials to FastAPI `POST /auth/login`
   - Backend verifies password, issues JWT access token + random refresh token
   - Refresh token stored as SHA-256 hash in `refresh_tokens` table
   - Proxy sets both cookies on the response

2. **Authenticated requests** (`/api/backend/[...path]`):
   - Proxy reads `rr_access_token` cookie, forwards as `Authorization: Bearer` header
   - Backend validates JWT, extracts `sub` (username) and `role`

3. **Token refresh** (transparent):
   - If access token is missing but refresh token exists → proxy auto-refreshes before forwarding
   - If backend returns 401 → proxy attempts refresh, retries the original request
   - Old refresh token is revoked (`revoked_at` set), new one issued with `replaced_by_token_id` chain
   - Concurrent refresh deduplication via in-memory `inFlightRefreshes` map

4. **Logout** (`POST /api/auth/logout`):
   - Backend revokes refresh token, clears `last_seen_at`
   - Proxy sets both cookies to empty with `maxAge: 0`

5. **Middleware** (`middleware.ts`):
   - Checks for presence of either cookie on protected routes
   - Missing cookies → redirect to `/login?next=<path>`
   - Does **not** validate JWT (that's the proxy's job)

### Security Properties

- **XSS mitigation**: Tokens are httpOnly — JavaScript cannot read them
- **CSRF mitigation**: SameSite=Lax prevents cross-origin POST with cookies
- **Token rotation**: Each refresh revokes the old token, preventing replay
- **Refresh chain tracking**: `replaced_by_token_id` enables audit of token lineage

## Decision

This architecture is intentional and should be preserved. Key invariants:

1. **Browser never sees raw tokens** — all token handling happens in Next.js API routes
2. **JWT is stateless** — backend validates signature + expiry without DB lookup
3. **Refresh token is stateful** — stored hashed in DB, revocable, with chain tracking
4. **Proxy handles retry** — 401 → refresh → retry is transparent to React components

## Consequences

- **Positive:** Strong XSS protection. Tokens cannot be exfiltrated via client-side script injection.
- **Positive:** Transparent refresh — React components never handle auth errors directly.
- **Positive:** Token revocation via refresh token chain — logout invalidates future refreshes immediately.
- **Negative:** Every API request adds proxy latency (Next.js → FastAPI). Acceptable for internal tool.
- **Negative:** All cookies expire independently — access token maxAge (12h) and JWT exp (30min via `access_token_expire_minutes`) can diverge. The proxy handles this via transparent refresh.
