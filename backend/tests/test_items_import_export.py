import csv
from io import StringIO

from app.models.item import Item
from app.models.item_category import ItemCategory


def test_import_csv_dry_run_returns_preview_without_writes(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    data = f"product_code,name,unit,warehouse_id\n10100,Salmon,kg,{warehouse_id}\n"

    response = client.post(
        "/items/import?dry_run=true",
        headers=auth_headers,
        files={"file": ("items.csv", data.encode("utf-8"), "text/csv")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["dry_run"] is True
    assert body["created"] == 1
    assert body["updated"] == 0
    assert body["errors"] == []

    check = client.get(
        "/items/search",
        headers=auth_headers,
        params={"q": "Salmon", "warehouse_id": warehouse_id},
    )
    assert check.status_code == 200
    assert all(entry["name"] != "Salmon" for entry in check.json())


def test_import_csv_apply_creates_and_updates(
    client, auth_headers, seed_zone_warehouse_item, db_session
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    cat = ItemCategory(name="Мясо")
    db_session.add(cat)
    db_session.flush()

    existing = Item(
        product_code="10101",
        name="Beef",
        unit="kg",
        is_active=True,
        warehouse_id=warehouse_id,
        category_id=None,
    )
    db_session.add(existing)
    db_session.commit()

    data = (
        "product_code,name,unit,warehouse_id,step,min_qty,max_qty,is_favorite,category\n"
        f"10101,Beef,кг,{warehouse_id},0.5,0.5,20,true,Мясо\n"
        f"10102,Cheese,л,{warehouse_id},1,1,30,false,\n"
    )

    response = client.post(
        "/items/import?dry_run=false",
        headers=auth_headers,
        files={"file": ("items.csv", data.encode("utf-8"), "text/csv")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["dry_run"] is False
    assert body["created"] == 1
    assert body["updated"] == 1
    assert body["errors"] == []

    check = client.get(
        "/items/search",
        headers=auth_headers,
        params={"q": "Beef", "warehouse_id": warehouse_id},
    )
    assert check.status_code == 200
    beef = next(entry for entry in check.json() if entry["name"] == "Beef")
    assert beef["step"] == 0.5
    assert beef["is_favorite"] is True
    assert beef["category_id"] == cat.id


def test_import_csv_reports_validation_errors(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    data = f"product_code,name,unit,warehouse_id\n12345,Wrong Unit,box,{warehouse_id}\n,,kg,\n"

    response = client.post(
        "/items/import?dry_run=true",
        headers=auth_headers,
        files={"file": ("items.csv", data.encode("utf-8"), "text/csv")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert len(body["errors"]) == 2


def test_export_csv_returns_catalog_rows(
    client, auth_headers, seed_zone_warehouse_item, db_session
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    category = ItemCategory(name="Бар")
    db_session.add(category)
    db_session.flush()

    item = Item(
        product_code="10110",
        name="Cola",
        unit="l",
        is_active=True,
        is_favorite=True,
        warehouse_id=warehouse_id,
        category_id=category.id,
    )
    db_session.add(item)
    db_session.commit()

    response = client.get(
        "/items/export",
        headers=auth_headers,
        params={"format": "csv", "warehouse_id": warehouse_id},
    )

    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]

    parsed = list(csv.DictReader(StringIO(response.text)))
    row = next(entry for entry in parsed if entry["name"] == "Cola")
    assert row["warehouse_id"] == str(warehouse_id)
    assert row["category_name"] == "Бар"


def test_souschef_cannot_import(client, auth_headers_souschef, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    data = f"product_code,name,unit,warehouse_id\n10111,Tea,l,{warehouse_id}\n"

    response = client.post(
        "/items/import",
        headers=auth_headers_souschef,
        files={"file": ("items.csv", data.encode("utf-8"), "text/csv")},
    )

    assert response.status_code == 200
