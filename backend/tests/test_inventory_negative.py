from app.models.item import Item
from app.models.warehouse import Warehouse


def test_create_second_active_session_conflict(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    first = client.post(
        "/inventory/sessions",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    assert first.status_code == 200

    second = client.post(
        "/inventory/sessions",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    assert second.status_code == 409
    assert "Active session already exists" in second.json()["error"]["message"]


def test_add_entry_invalid_mode(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_id = seed_zone_warehouse_item["item"].id

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    session_id = active.json()["id"]

    response = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 1, "mode": "bad-mode"},
    )

    assert response.status_code == 400


def test_add_entry_to_closed_session_rejected(
    client, auth_headers, auth_headers_cook, seed_zone_warehouse_item, seed_closed_session
):
    item_id = seed_zone_warehouse_item["item"].id

    # cook cannot add entries to a closed session
    rejected = client.post(
        f"/inventory/sessions/{seed_closed_session.id}/entries",
        headers=auth_headers_cook,
        json={"item_id": item_id, "quantity": 1, "mode": "add"},
    )
    assert rejected.status_code == 409
    assert rejected.json()["error"]["message"] == "Session is closed"

    # admin (chef-equivalent) CAN add entries to closed session
    allowed = client.post(
        f"/inventory/sessions/{seed_closed_session.id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 1, "mode": "add"},
    )
    assert allowed.status_code == 200


def test_auth_required_for_protected_route(client):
    response = client.get("/warehouses")
    assert response.status_code in (401, 403)


def test_add_entry_rejects_item_from_other_warehouse(
    client,
    auth_headers,
    seed_zone_warehouse_item,
    db_session,
):
    primary_warehouse_id = seed_zone_warehouse_item["warehouse"].id

    other_warehouse = Warehouse(name="Other Warehouse", zone_id=seed_zone_warehouse_item["zone"].id)
    db_session.add(other_warehouse)
    db_session.flush()

    foreign_item = Item(
        product_code="10080",
        name="Foreign Item",
        unit="pcs",
        is_active=True,
        warehouse_id=other_warehouse.id,
    )
    db_session.add(foreign_item)
    db_session.commit()

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": primary_warehouse_id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    response = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": foreign_item.id, "quantity": 1, "mode": "add"},
    )

    assert response.status_code == 400
    assert response.json()["error"]["message"] == "Item does not belong to session warehouse"
