"""RBAC and filename safety for admin backup routes."""

import pytest
from fastapi import HTTPException

from app.routers.admin_backups import _safe_filename


def test_admin_backups_forbidden_for_cook(client, auth_headers_cook):
    r = client.get("/admin/backups", headers=auth_headers_cook)
    assert r.status_code == 403


def test_safe_filename_rejects_non_matching_pattern():
    with pytest.raises(HTTPException) as exc:
        _safe_filename("evil.sql")
    assert exc.value.status_code == 400


def test_safe_filename_uses_basename_only():
    """Path segments before the filename must not widen the accepted name."""
    name = "database_backup_2024-01-01.sql.gz"
    assert _safe_filename(f"../other/{name}") == name


def test_admin_backups_delete_rejects_non_matching_pattern(client, auth_headers_manager):
    r = client.delete(
        "/admin/backups/evil.sql",
        headers=auth_headers_manager,
    )
    assert r.status_code == 400
