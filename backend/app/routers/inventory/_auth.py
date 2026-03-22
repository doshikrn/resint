"""Auth / permission guard helpers for the inventory router."""

from fastapi import HTTPException
from sqlalchemy.orm import Session as DbSession

from app.core.roles import (
    can_access_all_warehouses,
    can_manage_revision,
    can_view_audit,
)
from app.models.enums import SessionStatus
from app.models.inventory_session import InventorySession

from app.routers.inventory._common import _raise_api_error


def _require_audit_view_role(current_user) -> None:
    if not can_view_audit(current_user.role):
        raise HTTPException(status_code=403, detail="Insufficient role to view audit")


def _require_revision_manage_role(current_user) -> None:
    if not can_manage_revision(current_user.role):
        raise HTTPException(
            status_code=403, detail="Only chef or souschef can manage revision"
        )


def _can_edit_closed_revision(current_user) -> bool:
    return can_manage_revision(current_user.role)


def _resolve_user_warehouse_id(current_user) -> int | None:
    warehouse_id = getattr(current_user, "warehouse_id", None)
    if warehouse_id is None:
        warehouse_id = getattr(current_user, "default_warehouse_id", None)
    if warehouse_id is None:
        return None
    return int(warehouse_id)


def _require_user_warehouse_id(current_user) -> int:
    warehouse_id = _resolve_user_warehouse_id(current_user)
    if warehouse_id is None:
        raise HTTPException(
            status_code=403,
            detail="User is not bound to a warehouse",
        )
    return warehouse_id


def _require_access_to_warehouse(session: InventorySession, current_user) -> None:
    if can_access_all_warehouses(current_user.role):
        return
    user_warehouse_id = _require_user_warehouse_id(current_user)
    if int(session.warehouse_id) != user_warehouse_id:
        raise HTTPException(status_code=403, detail="Forbidden for this warehouse")


def _require_warehouse_param_access(requested_warehouse_id: int, current_user) -> None:
    if can_access_all_warehouses(current_user.role):
        return
    user_warehouse_id = _require_user_warehouse_id(current_user)
    if int(requested_warehouse_id) != user_warehouse_id:
        raise HTTPException(status_code=403, detail="Forbidden for this warehouse")


def _is_session_closed(session: InventorySession) -> bool:
    """Check both legacy ``is_closed`` flag and canonical ``status`` column."""
    return bool(
        getattr(session, "is_closed", False)
        or getattr(session, "status", None) == SessionStatus.CLOSED
    )


def _require_active_session_owner(session: InventorySession, current_user) -> None:
    is_active = not _is_session_closed(session)
    if is_active and session.created_by_user_id != current_user.id:
        _raise_api_error(
            403, "SESSION_READ_ONLY", "Active session is owned by another user"
        )
