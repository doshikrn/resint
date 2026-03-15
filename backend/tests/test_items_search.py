from app.models.item import Item
from app.models.item_category import ItemCategory


def test_search_returns_only_active_items(
    client, auth_headers, seed_zone_warehouse_item, db_session
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    active_item = Item(
        product_code="10020",
        name="Tomato Fresh",
        unit="kg",
        is_active=True,
        warehouse_id=warehouse_id,
    )
    inactive_item = Item(
        product_code="10021",
        name="Tomato Old",
        unit="kg",
        is_active=False,
        warehouse_id=warehouse_id,
    )

    db_session.add(active_item)
    db_session.add(inactive_item)
    db_session.commit()

    response = client.get(
        "/items/search",
        headers=auth_headers,
        params={"q": "Tomato", "warehouse_id": warehouse_id},
    )

    assert response.status_code == 200
    body = response.json()
    names = [item["name"] for item in body]

    assert "Tomato Fresh" in names
    assert "Tomato Old" not in names
    assert all(item["is_active"] for item in body)


def test_search_ranks_exact_then_prefix_then_contains(
    client,
    auth_headers,
    seed_zone_warehouse_item,
    db_session,
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    exact = Item(
        product_code="10022", name="Milk", unit="l", is_active=True, warehouse_id=warehouse_id
    )
    prefix = Item(
        product_code="10023",
        name="Milk Premium",
        unit="l",
        is_active=True,
        warehouse_id=warehouse_id,
    )
    contains = Item(
        product_code="10024",
        name="Fresh Milk 3.2%",
        unit="l",
        is_active=True,
        warehouse_id=warehouse_id,
    )

    db_session.add_all([exact, prefix, contains])
    db_session.commit()

    response = client.get(
        "/items/search",
        headers=auth_headers,
        params={"q": "Milk", "warehouse_id": warehouse_id, "limit": 10},
    )

    assert response.status_code == 200
    names = [item["name"] for item in response.json()]

    assert names.index("Milk") < names.index("Milk Premium")
    assert names.index("Milk Premium") < names.index("Fresh Milk 3.2%")


def test_create_item_normalizes_unit_and_name(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    response = client.post(
        "/items",
        headers=auth_headers,
        json={
            "product_code": "10025",
            "name": "  Beef Tenderloin  ",
            "unit": " КГ ",
            "warehouse_id": warehouse_id,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Beef Tenderloin"
    assert payload["unit"] == "kg"


def test_create_item_rejects_unsupported_unit(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    response = client.post(
        "/items",
        headers=auth_headers,
        json={
            "product_code": "10026",
            "name": "Wine Box",
            "unit": "box",
            "warehouse_id": warehouse_id,
        },
    )

    assert response.status_code == 422


def test_search_rate_limit_returns_429(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    limited_response = None
    for _ in range(130):
        response = client.get(
            "/items/search",
            headers=auth_headers,
            params={"q": "M", "warehouse_id": warehouse_id, "limit": 5},
        )
        if response.status_code == 429:
            limited_response = response
            break

    assert limited_response is not None
    assert limited_response.status_code == 429
    assert limited_response.json()["error"]["message"] == "Too many search requests"


def test_list_items_filters_by_category(client, auth_headers, seed_zone_warehouse_item, db_session):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    meat = ItemCategory(name="Meat")
    dairy = ItemCategory(name="Dairy")
    db_session.add_all([meat, dairy])
    db_session.flush()

    beef = Item(
        product_code="10027",
        name="Beef",
        unit="kg",
        is_active=True,
        warehouse_id=warehouse_id,
        category_id=meat.id,
    )
    milk = Item(
        product_code="10028",
        name="Milk",
        unit="l",
        is_active=True,
        warehouse_id=warehouse_id,
        category_id=dairy.id,
    )
    db_session.add_all([beef, milk])
    db_session.commit()

    response = client.get(
        "/items",
        headers=auth_headers,
        params={"warehouse_id": warehouse_id, "category_id": meat.id},
    )

    assert response.status_code == 200
    names = [item["name"] for item in response.json()]
    assert "Beef" in names
    assert "Milk" not in names
