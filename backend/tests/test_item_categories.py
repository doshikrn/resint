from app.models.item import Item
from app.models.item_category import ItemCategory
from app.models.item_usage_stat import ItemUsageStat


def test_admin_can_create_and_list_categories(client, auth_headers):
    create = client.post(
        "/items/categories",
        headers=auth_headers,
        json={"name": "Мясо"},
    )
    assert create.status_code == 201
    created = create.json()
    assert created["name"] == "Мясо"

    duplicate = client.post(
        "/items/categories",
        headers=auth_headers,
        json={"name": "Мясо"},
    )
    assert duplicate.status_code == 409

    listed = client.get("/items/categories", headers=auth_headers)
    assert listed.status_code == 200
    names = [entry["name"] for entry in listed.json()]
    assert "Мясо" in names


def test_souschef_cannot_create_category(client, auth_headers_souschef):
    response = client.post(
        "/items/categories",
        headers=auth_headers_souschef,
        json={"name": "Бар"},
    )
    assert response.status_code == 201


def test_search_filters_by_category(client, auth_headers, seed_zone_warehouse_item, db_session):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    meat = ItemCategory(name="Мясо")
    dairy = ItemCategory(name="Молочка")
    db_session.add_all([meat, dairy])
    db_session.flush()

    beef = Item(
        product_code="10030",
        name="Beef Steak",
        unit="kg",
        is_active=True,
        warehouse_id=warehouse_id,
        category_id=meat.id,
    )
    milk = Item(
        product_code="10031",
        name="Milk 3.2",
        unit="l",
        is_active=True,
        warehouse_id=warehouse_id,
        category_id=dairy.id,
    )
    db_session.add_all([beef, milk])
    db_session.commit()

    response = client.get(
        "/items/search",
        headers=auth_headers,
        params={"q": "", "warehouse_id": warehouse_id, "category_id": meat.id, "limit": 20},
    )
    assert response.status_code == 422

    response = client.get(
        "/items/search",
        headers=auth_headers,
        params={"q": "e", "warehouse_id": warehouse_id, "category_id": meat.id, "limit": 20},
    )
    assert response.status_code == 200
    names = [entry["name"] for entry in response.json()]
    assert "Beef Steak" in names
    assert "Milk 3.2" not in names


def test_create_item_with_unknown_category_returns_404(
    client, auth_headers, seed_zone_warehouse_item
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    response = client.post(
        "/items",
        headers=auth_headers,
        json={
            "product_code": "10034",
            "name": "Soap",
            "unit": "pcs",
            "warehouse_id": warehouse_id,
            "category_id": 99999,
        },
    )
    assert response.status_code == 404


def test_categories_sorted_by_usage_for_warehouse(
    client, auth_headers, seed_zone_warehouse_item, db_session
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    meat = ItemCategory(name="Мясо")
    dairy = ItemCategory(name="Молочка")
    bar = ItemCategory(name="Бар")
    db_session.add_all([meat, dairy, bar])
    db_session.flush()

    beef = Item(
        product_code="10032",
        name="Beef",
        unit="kg",
        is_active=True,
        warehouse_id=warehouse_id,
        category_id=meat.id,
    )
    milk = Item(
        product_code="10033",
        name="Milk",
        unit="l",
        is_active=True,
        warehouse_id=warehouse_id,
        category_id=dairy.id,
    )
    db_session.add_all([beef, milk])
    db_session.flush()

    db_session.add_all(
        [
            ItemUsageStat(warehouse_id=warehouse_id, item_id=beef.id, use_count=10),
            ItemUsageStat(warehouse_id=warehouse_id, item_id=milk.id, use_count=3),
        ]
    )
    db_session.commit()

    response = client.get(
        "/items/categories",
        headers=auth_headers,
        params={"warehouse_id": warehouse_id},
    )

    assert response.status_code == 200
    names = [entry["name"] for entry in response.json()]
    assert names.index("Мясо") < names.index("Молочка")
    assert names.index("Молочка") < names.index("Бар")


def test_categories_with_unknown_warehouse_returns_404(client, auth_headers):
    response = client.get(
        "/items/categories",
        headers=auth_headers,
        params={"warehouse_id": 99999},
    )

    assert response.status_code == 404
