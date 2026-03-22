# ADR-004: Auth Hardening — create_item Role Check

**Status:** Accepted  
**Date:** 2026-03-22  
**Decision makers:** Engineering team

## Context

The `POST /items/` endpoint (`create_item`) accepted any authenticated user as a valid caller. The endpoint only required `Depends(get_current_user)` but did not check the user's role.

In practice, only souschef-level users and above should be able to create new catalog items. Other endpoints (`PATCH /items/{id}`, `DELETE /items/{id}`, import/export) already enforced the `can_manage_catalog` role check.

## Decision

Add an explicit role check to `create_item`:

```python
current_user = Depends(get_current_user)
# ...
if not can_manage_catalog(current_user.role):
    raise HTTPException(status_code=403, detail="Not allowed to create items")
```

This is consistent with the existing `update_item` and `delete_item` patterns.

## Consequences

- **Positive:** Closes an auth gap. All catalog-mutation endpoints now have consistent role requirements.
- **Negative:** If any low-privilege user relied on creating items, they will get 403. In practice this doesn't happen — the frontend UI only shows the "create item" form to users with `can_manage_catalog`.
