from app.models.item import Item
from app.models.item_alias import ItemAlias


def test_search_finds_item_by_alias_text(
    client, auth_headers, seed_zone_warehouse_item, db_session
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    item = Item(
        product_code="10010",
        name="Mozzarella",
        unit="kg",
        is_active=True,
        warehouse_id=warehouse_id,
    )
    db_session.add(item)
    db_session.flush()

    alias = ItemAlias(item_id=item.id, alias_text="моц")
    db_session.add(alias)
    db_session.commit()

    response = client.get(
        "/items/search",
        headers=auth_headers,
        params={"q": "моц", "warehouse_id": warehouse_id, "limit": 10},
    )

    assert response.status_code == 200
    names = [entry["name"] for entry in response.json()]
    assert "Mozzarella" in names


def test_search_ranking_name_starts_before_alias_starts(
    client, auth_headers, seed_zone_warehouse_item, db_session
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    name_starts_item = Item(
        product_code="10011", name="Cola 1L", unit="l", is_active=True, warehouse_id=warehouse_id
    )
    alias_starts_item = Item(
        product_code="10012",
        name="Sparkling Drink",
        unit="l",
        is_active=True,
        warehouse_id=warehouse_id,
    )
    db_session.add_all([name_starts_item, alias_starts_item])
    db_session.flush()

    db_session.add(ItemAlias(item_id=alias_starts_item.id, alias_text="cola 1l"))
    db_session.commit()

    response = client.get(
        "/items/search",
        headers=auth_headers,
        params={"q": "cola", "warehouse_id": warehouse_id, "limit": 10},
    )

    assert response.status_code == 200
    names = [entry["name"] for entry in response.json()]
    assert names.index("Cola 1L") < names.index("Sparkling Drink")


def test_search_ranking_alias_starts_before_contains(
    client, auth_headers, seed_zone_warehouse_item, db_session
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    alias_starts_item = Item(
        product_code="10013",
        name="Orange Soda",
        unit="l",
        is_active=True,
        warehouse_id=warehouse_id,
    )
    contains_item = Item(
        product_code="10014",
        name="Classic Cola",
        unit="l",
        is_active=True,
        warehouse_id=warehouse_id,
    )
    db_session.add_all([alias_starts_item, contains_item])
    db_session.flush()

    db_session.add(ItemAlias(item_id=alias_starts_item.id, alias_text="cola zero"))
    db_session.commit()

    response = client.get(
        "/items/search",
        headers=auth_headers,
        params={"q": "cola", "warehouse_id": warehouse_id, "limit": 10},
    )

    assert response.status_code == 200
    names = [entry["name"] for entry in response.json()]
    assert names.index("Orange Soda") < names.index("Classic Cola")
