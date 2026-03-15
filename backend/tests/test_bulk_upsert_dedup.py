"""
End-to-end test for bulk-upsert duplicate detection.

Covers: partial names must NOT match, exact names (case-insensitive) MUST match,
same name + different unit must NOT match.
"""
from app.models.item import Item


def test_bulk_upsert_partial_name_is_not_existing(
    client, auth_headers, seed_zone_warehouse_item, db_session
):
    """A row whose name is a SUBSTRING of an existing item must be counted
    as 'created', never as 'skipped_existing'."""
    wh = seed_zone_warehouse_item["warehouse"]

    # Seed a few items with longer names
    for name, code in [("Tomato paste", "10001"), ("Tomato sauce", "10002")]:
        db_session.add(
            Item(product_code=code, name=name, unit="kg", is_active=True, warehouse_id=wh.id)
        )
    db_session.commit()

    # --- dry_run check ---
    resp = client.post(
        "/items/bulk-upsert",
        headers=auth_headers,
        json={
            "rows": [
                # partial name — must NOT match "Tomato paste" or "Tomato sauce"
                {"name": "Tomato", "unit": "kg"},
                # completely new name
                {"name": "Brand new item", "unit": "kg"},
            ],
            "dry_run": True,
            "default_warehouse_id": wh.id,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 2, f"partial name must be new, got: {body}"
    assert body["skipped_existing"] == 0, f"no existing match expected, got: {body}"
    assert body["errors"] == []


def test_bulk_upsert_exact_name_same_unit_is_existing(
    client, auth_headers, seed_zone_warehouse_item, db_session
):
    """Exact (case-insensitive) name + same unit must be 'skipped_existing'."""
    wh = seed_zone_warehouse_item["warehouse"]

    db_session.add(
        Item(product_code="10010", name="Olive oil", unit="l", is_active=True, warehouse_id=wh.id)
    )
    db_session.commit()

    resp = client.post(
        "/items/bulk-upsert",
        headers=auth_headers,
        json={
            "rows": [
                # exact match (different case)
                {"name": "olive oil", "unit": "l"},
            ],
            "dry_run": True,
            "default_warehouse_id": wh.id,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["skipped_existing"] == 1, f"exact match expected, got: {body}"
    assert body["created"] == 0


def test_bulk_upsert_same_name_different_unit_is_new(
    client, auth_headers, seed_zone_warehouse_item, db_session
):
    """Same name but different unit must be 'created', not 'skipped_existing'."""
    wh = seed_zone_warehouse_item["warehouse"]

    db_session.add(
        Item(product_code="10020", name="Sugar", unit="kg", is_active=True, warehouse_id=wh.id)
    )
    db_session.commit()

    resp = client.post(
        "/items/bulk-upsert",
        headers=auth_headers,
        json={
            "rows": [
                # same name, different unit
                {"name": "Sugar", "unit": "pcs"},
            ],
            "dry_run": True,
            "default_warehouse_id": wh.id,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 1, f"different unit must be new, got: {body}"
    assert body["skipped_existing"] == 0


def test_bulk_upsert_mixed_batch(
    client, auth_headers, seed_zone_warehouse_item, db_session
):
    """Mixed batch: some exact matches, some partial, some new."""
    wh = seed_zone_warehouse_item["warehouse"]

    for name, code, unit in [
        ("Chicken breast", "20001", "kg"),
        ("Chicken wings", "20002", "kg"),
        ("Rice", "20003", "kg"),
    ]:
        db_session.add(
            Item(product_code=code, name=name, unit=unit, is_active=True, warehouse_id=wh.id)
        )
    db_session.commit()

    resp = client.post(
        "/items/bulk-upsert",
        headers=auth_headers,
        json={
            "rows": [
                {"name": "Chicken", "unit": "kg"},          # partial — must be NEW
                {"name": "chicken breast", "unit": "kg"},    # exact match — must be EXISTING
                {"name": "Rice", "unit": "kg"},              # exact match — must be EXISTING
                {"name": "Rice", "unit": "l"},               # same name diff unit — must be NEW
                {"name": "Beef", "unit": "kg"},              # completely new — must be NEW
            ],
            "dry_run": True,
            "default_warehouse_id": wh.id,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    # "Chicken" (new) + "Rice l" (new) + "Beef" (new) = 3 created
    assert body["created"] == 3, f"expected 3 new, got: {body}"
    # "chicken breast" + "Rice kg" = 2 existing
    assert body["skipped_existing"] == 2, f"expected 2 existing, got: {body}"
    assert body["errors"] == []
