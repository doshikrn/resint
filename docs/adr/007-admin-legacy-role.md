# ADR-007: Admin Legacy Role Preservation

**Status:** Accepted  
**Date:** 2026-03-22  
**Decision makers:** Engineering team

## Context

The system defines `ROLE_ADMIN_LEGACY = "admin"` as an alias for the `chef` role. It exists because early users were assigned `role="admin"` in the database before the canonical role vocabulary was established (`chef`, `souschef`, `cook`, `stock_manager`).

Current state:
- **`roles.py`**: All 7 permission frozensets include `"admin"` alongside `"chef"`, ensuring admin users inherit identical permissions. `CANONICAL_ROLES` excludes it. `resolve_registration_role()` rejects it for new registrations.
- **`users.py`**: 4 locations have hardcoded `["manager", "admin"]` filters for user listings.
- **Frontend**: `types.ts`, `permissions.ts`, and 3 page components include `"admin"` in role unions and permission sets.
- **Database**: Existing user rows with `role="admin"` exist in production.

## Decision

**Preserve the admin role alias** as-is. Do not remove it or add a data migration at this time.

### Rationale

1. **Data migration risk**: Changing `role` values in the user table requires a coordinated DB migration + deployment. Rollback is non-trivial.
2. **Functional equivalence**: Admin users already get the same permissions as chef users — the system behaves correctly.
3. **Registration blocked**: `resolve_registration_role()` already prevents new users from being created with `role="admin"`.
4. **Natural attrition**: As admin users are reassigned or deactivated, the legacy role will disappear from active records organically.

### Future removal criteria

The admin role alias can be safely removed when:
- Zero active users have `role="admin"` in production (verify with `SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = true`)
- A data migration is prepared: `UPDATE users SET role = 'chef' WHERE role = 'admin'`
- Frontend permission sets and type unions are updated simultaneously

## Consequences

- **Positive:** No migration risk. No deployment coordination needed.
- **Positive:** Explicitly documented rather than silently tolerated.
- **Negative:** Permission frozensets remain slightly larger than necessary. Marginal cognitive overhead for new developers.
