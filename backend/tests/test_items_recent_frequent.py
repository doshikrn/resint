from app.models.item import Item


def test_recent_items_returns_last_used_first(
    client, auth_headers, seed_zone_warehouse_item, db_session
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    first_item = seed_zone_warehouse_item["item"]

    second_item = Item(
        product_code="10040", name="Butter", unit="kg", is_active=True, warehouse_id=warehouse_id
    )
    db_session.add(second_item)
    db_session.commit()
    db_session.refresh(second_item)

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add_first = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": first_item.id, "quantity": 1, "mode": "set"},
    )
    assert add_first.status_code == 200

    add_second = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": second_item.id, "quantity": 1, "mode": "set"},
    )
    assert add_second.status_code == 200

    response = client.get(
        "/items/recent",
        headers=auth_headers,
        params={"warehouse_id": warehouse_id, "limit": 20},
    )
    assert response.status_code == 200

    names = [item["name"] for item in response.json()]
    assert names[0] == second_item.name
    assert first_item.name in names


def test_frequent_items_returns_most_used_first(
    client, auth_headers, seed_zone_warehouse_item, db_session
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    most_used = seed_zone_warehouse_item["item"]

    less_used = Item(
        product_code="10041", name="Cream", unit="l", is_active=True, warehouse_id=warehouse_id
    )
    db_session.add(less_used)
    db_session.commit()
    db_session.refresh(less_used)

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    for _ in range(3):
        response = client.post(
            f"/inventory/sessions/{session_id}/entries",
            headers=auth_headers,
            json={"item_id": most_used.id, "quantity": 1, "mode": "add"},
        )
        assert response.status_code == 200

    response = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": less_used.id, "quantity": 1, "mode": "add"},
    )
    assert response.status_code == 200

    frequent = client.get(
        "/items/frequent",
        headers=auth_headers,
        params={"warehouse_id": warehouse_id, "limit": 20, "period": "30d"},
    )
    assert frequent.status_code == 200

    names = [item["name"] for item in frequent.json()]
    assert names[0] == most_used.name
    assert less_used.name in names


def test_frequent_items_invalid_period_returns_422(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    response = client.get(
        "/items/frequent",
        headers=auth_headers,
        params={"warehouse_id": warehouse_id, "period": "bad"},
    )
    assert response.status_code == 422


def test_recent_and_frequent_warehouse_not_found(client, auth_headers):
    recent = client.get(
        "/items/recent",
        headers=auth_headers,
        params={"warehouse_id": 999999},
    )
    assert recent.status_code == 404

    frequent = client.get(
        "/items/frequent",
        headers=auth_headers,
        params={"warehouse_id": 999999},
    )
    assert frequent.status_code == 404
