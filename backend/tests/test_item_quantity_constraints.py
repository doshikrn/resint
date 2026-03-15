from app.models.item import Item


def test_create_item_with_step_and_bounds(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    response = client.post(
        "/items",
        headers=auth_headers,
        json={
            "product_code": "10070",
            "name": "Wine Bottle",
            "unit": "bottle",
            "step": 1,
            "min_qty": 1,
            "max_qty": 500,
            "warehouse_id": warehouse_id,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["unit"] == "bottle"
    assert body["step"] == 1
    assert body["min_qty"] == 1
    assert body["max_qty"] == 500


def test_create_item_rejects_invalid_bounds(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    response = client.post(
        "/items",
        headers=auth_headers,
        json={
            "product_code": "10071",
            "name": "Broken Item",
            "unit": "pack",
            "step": 1,
            "min_qty": 10,
            "max_qty": 5,
            "warehouse_id": warehouse_id,
        },
    )

    assert response.status_code == 422


def test_inventory_rejects_quantity_not_aligned_to_step(
    client, auth_headers, seed_zone_warehouse_item, db_session
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    stepped_item = Item(
        product_code="10072",
        name="Flour",
        unit="pcs",
        step=0.25,
        min_qty=None,
        max_qty=None,
        is_active=True,
        warehouse_id=warehouse_id,
    )
    db_session.add(stepped_item)
    db_session.commit()
    db_session.refresh(stepped_item)

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    response = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": stepped_item.id, "quantity": 0.3, "mode": "set"},
    )

    assert response.status_code == 422
    assert "step" in response.json()["error"]["message"]


def test_inventory_respects_min_max_qty(client, auth_headers, seed_zone_warehouse_item, db_session):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    limited_item = Item(
        product_code="10073",
        name="Olive Oil",
        unit="l",
        step=0.5,
        min_qty=0.5,
        max_qty=5.0,
        is_active=True,
        warehouse_id=warehouse_id,
    )
    db_session.add(limited_item)
    db_session.commit()
    db_session.refresh(limited_item)

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    too_low = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": limited_item.id, "quantity": 0.1, "mode": "set"},
    )
    assert too_low.status_code == 422

    ok = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": limited_item.id, "quantity": 1.0, "mode": "set"},
    )
    assert ok.status_code == 200

    too_high = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": limited_item.id, "quantity": 6.0, "mode": "set"},
    )
    assert too_high.status_code == 422
