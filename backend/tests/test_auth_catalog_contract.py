"""
Contract tests for auth boundaries on catalog mutations.

These tests verify that role-based access control is correctly enforced
on item creation, update, and deletion endpoints.
"""


def test_cook_cannot_create_item(client, auth_headers_cook, seed_zone_warehouse_item):
    """cook role must be rejected from POST /items/ with 403."""
    wh_id = seed_zone_warehouse_item["warehouse"].id
    resp = client.post(
        "/items/",
        headers=auth_headers_cook,
        json={
            "product_code": "99999",
            "name": "Forbidden Item",
            "unit": "kg",
            "warehouse_id": wh_id,
        },
    )
    assert resp.status_code == 403


def test_souschef_can_create_item(client, auth_headers_souschef, seed_zone_warehouse_item):
    """souschef role should be allowed to create items (can_manage_catalog)."""
    wh_id = seed_zone_warehouse_item["warehouse"].id
    resp = client.post(
        "/items/",
        headers=auth_headers_souschef,
        json={
            "product_code": "99998",
            "name": "Allowed Item",
            "unit": "kg",
            "warehouse_id": wh_id,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Allowed Item"


def test_admin_can_create_item(client, auth_headers, seed_zone_warehouse_item):
    """admin (manager) role should be allowed to create items."""
    wh_id = seed_zone_warehouse_item["warehouse"].id
    resp = client.post(
        "/items/",
        headers=auth_headers,
        json={
            "product_code": "99997",
            "name": "Admin Item",
            "unit": "kg",
            "warehouse_id": wh_id,
        },
    )
    assert resp.status_code == 200


def test_unauthenticated_cannot_create_item(client, seed_zone_warehouse_item):
    """Missing auth token must yield 401."""
    wh_id = seed_zone_warehouse_item["warehouse"].id
    resp = client.post(
        "/items/",
        json={
            "product_code": "99996",
            "name": "No Token Item",
            "unit": "kg",
            "warehouse_id": wh_id,
        },
    )
    assert resp.status_code == 401
