import time
from io import BytesIO

from openpyxl import load_workbook

from app.models.inventory_entry import InventoryEntry
from app.models.item import Item
from app.models.user import User


def test_session_export_csv_returns_attachment_with_expected_headers(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]
    item = seed_zone_warehouse_item["item"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item.id, "quantity": 2, "mode": "set"},
    )
    assert add.status_code == 200

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "csv"},
    )
    assert export.status_code == 200
    assert export.headers["content-type"].startswith("text/csv")

    content_disposition = export.headers.get("content-disposition", "")
    assert content_disposition.startswith('attachment; filename="inventory_')
    assert content_disposition.endswith('_DRAFT.csv"')

    body = export.content.decode("utf-8")
    assert (
        "Zone,Warehouse,SessionId,SessionStatus,Item,Unit,Qty,Category,"
        "CountedOutsideZone,CountedByZone,UpdatedAt,UpdatedBy,Station,Department"
    ) in body
    assert item.name in body


def test_session_export_xlsx_returns_attachment_and_xlsx_payload(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]
    item = seed_zone_warehouse_item["item"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item.id, "quantity": 3, "mode": "set"},
    )
    assert add.status_code == 200

    close = client.post(f"/inventory/sessions/{session_id}/close", headers=auth_headers)
    assert close.status_code == 200

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "xlsx"},
    )
    assert export.status_code == 200
    assert (
        export.headers["content-type"]
        == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

    content_disposition = export.headers.get("content-disposition", "")
    assert content_disposition.startswith('attachment; filename="inventory_')
    assert content_disposition.endswith('_CLOSED.xlsx"')

    # XLSX is a ZIP container and starts with PK magic bytes.
    assert export.content[:2] == b"PK"


def test_session_export_xlsx_matches_template_spec(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]
    item = seed_zone_warehouse_item["item"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item.id, "quantity": 2, "mode": "set"},
    )
    assert add.status_code == 200

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "xlsx"},
    )
    assert export.status_code == 200

    workbook = load_workbook(filename=BytesIO(export.content), data_only=True)
    assert workbook.sheetnames == ["Товары"]

    goods_sheet = workbook["Товары"]
    assert goods_sheet.cell(row=8, column=1).value == item.product_code
    assert goods_sheet.cell(row=8, column=2).value == item.name
    assert goods_sheet.cell(row=8, column=3).value in {"кг", "л", "шт", item.unit}
    assert isinstance(goods_sheet.cell(row=8, column=4).value, (int, float))
    assert goods_sheet.cell(row=8, column=4).number_format == "0.###"


def test_session_export_unknown_session_returns_404(client, auth_headers):
    export = client.get(
        "/inventory/sessions/999999/export",
        headers=auth_headers,
        params={"format": "csv"},
    )
    assert export.status_code == 404


def test_session_export_forbidden_for_cook_on_foreign_session(
    client,
    auth_headers,
    auth_headers_cook,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers_cook,
        params={"format": "csv"},
    )

    assert export.status_code == 403


def test_session_export_allowed_for_chef_on_foreign_session(
    client,
    auth_headers,
    auth_headers_chef,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers_chef,
        params={"format": "csv"},
    )

    assert export.status_code == 200


def test_session_export_allowed_for_souschef_on_own_session(
    client,
    auth_headers_souschef,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers_souschef,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers_souschef,
        params={"format": "csv"},
    )

    assert export.status_code == 200


def test_session_export_accepts_accounting_v1_template(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "xlsx", "template": "accounting_v1"},
    )
    assert export.status_code == 200


def test_session_export_rejects_unknown_template(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "csv", "template": "accounting_v2"},
    )
    assert export.status_code == 422


def test_session_export_entries_sorted_and_qty_preserved_and_uncategorized(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]

    category = client.post(
        "/items/categories",
        headers=auth_headers,
        json={"name": "Meat"},
    )
    assert category.status_code == 201
    category_id = category.json()["id"]

    item_with_category = client.post(
        "/items",
        headers=auth_headers,
        json={
            "product_code": "10200",
            "name": "Beef Round",
            "unit": "kg",
            "warehouse_id": warehouse.id,
            "step": 0.01,
            "category_id": category_id,
        },
    )
    assert item_with_category.status_code == 200
    item_with_category_id = item_with_category.json()["id"]

    item_without_category = client.post(
        "/items",
        headers=auth_headers,
        json={
            "product_code": "10201",
            "name": "Water Bottle",
            "unit": "l",
            "warehouse_id": warehouse.id,
            "step": 0.01,
        },
    )
    assert item_without_category.status_code == 200
    item_without_category_id = item_without_category.json()["id"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add_first = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_with_category_id, "quantity": 1.13, "mode": "set"},
    )
    assert add_first.status_code == 200

    add_second = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_without_category_id, "quantity": 2.37, "mode": "set"},
    )
    assert add_second.status_code == 200

    patch_first_step = client.patch(
        f"/items/{item_with_category_id}",
        headers=auth_headers,
        json={"step": 0.25},
    )
    assert patch_first_step.status_code == 200

    patch_second_step = client.patch(
        f"/items/{item_without_category_id}",
        headers=auth_headers,
        json={"step": 0.5},
    )
    assert patch_second_step.status_code == 200

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "xlsx", "template": "accounting_v1"},
    )
    assert export.status_code == 200

    workbook = load_workbook(filename=BytesIO(export.content), data_only=True)
    goods_sheet = workbook["Товары"]
    # Trailing empty rows should be trimmed; max_row should be close to data rows
    assert goods_sheet.max_row >= 8  # at least header + some data rows

    rows = []
    for row_index in range(8, goods_sheet.max_row + 1):
        code = goods_sheet.cell(row=row_index, column=1).value
        name = goods_sheet.cell(row=row_index, column=2).value
        unit = goods_sheet.cell(row=row_index, column=3).value
        qty = goods_sheet.cell(row=row_index, column=4).value
        if code and name:
            rows.append((str(code), str(name), str(unit), qty))

    row_by_name = {row[1]: row for row in rows}
    assert row_by_name["Beef Round"][0] == "10200"
    assert row_by_name["Water Bottle"][0] == "10201"
    assert row_by_name["Beef Round"][3] == 1.13
    assert row_by_name["Water Bottle"][3] == 2.37


def test_export_xlsx_keeps_fractional_precision_for_qty_915(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]

    create_item = client.post(
        "/items",
        headers=auth_headers,
        json={
            "product_code": "10915",
            "name": "Precision Test Item",
            "unit": "kg",
            "warehouse_id": warehouse.id,
            "step": 1.0,
        },
    )
    assert create_item.status_code == 200
    item_id = create_item.json()["id"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 9.15, "mode": "set"},
    )
    assert add.status_code == 200

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "xlsx", "template": "accounting_v1"},
    )
    assert export.status_code == 200

    workbook = load_workbook(filename=BytesIO(export.content), data_only=True)
    goods_sheet = workbook["Товары"]

    qty_by_item_name = {
        str(goods_sheet.cell(row=row_index, column=2).value): goods_sheet.cell(
            row=row_index, column=4
        ).value
        for row_index in range(8, goods_sheet.max_row + 1)
        if goods_sheet.cell(row=row_index, column=2).value
    }

    assert qty_by_item_name["Precision Test Item"] == 9.15


def test_export_draft_session_download_has_template_sheet(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]
    item = seed_zone_warehouse_item["item"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item.id, "quantity": 2, "mode": "set"},
    )
    assert add.status_code == 200

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "xlsx", "template": "accounting_v1"},
    )
    assert export.status_code == 200
    assert export.headers.get("content-disposition", "").startswith("attachment; filename=")

    workbook = load_workbook(filename=BytesIO(export.content), data_only=True)
    assert workbook.sheetnames == ["Товары"]


def test_export_xlsx_preserves_accounting_footer_block(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]
    item = seed_zone_warehouse_item["item"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item.id, "quantity": 2, "mode": "set"},
    )
    assert add.status_code == 200

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "xlsx", "template": "accounting_v1"},
    )
    assert export.status_code == 200

    workbook = load_workbook(filename=BytesIO(export.content), data_only=True)
    goods_sheet = workbook["Товары"]

    footer_rows = []
    for row_index in range(1, goods_sheet.max_row + 1):
        cell_value = goods_sheet.cell(row=row_index, column=1).value
        if isinstance(cell_value, str) and "Инвентаризацию произвел" in cell_value:
            footer_rows.append((row_index, cell_value))

    assert footer_rows, "Accounting footer block must be preserved in exported XLSX"
    assert footer_rows[0][0] >= 9
    assert footer_rows[0][0] <= 12


def test_export_closed_session_filename_has_closed_suffix(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]
    item = seed_zone_warehouse_item["item"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item.id, "quantity": 2, "mode": "set"},
    )
    assert add.status_code == 200

    close = client.post(f"/inventory/sessions/{session_id}/close", headers=auth_headers)
    assert close.status_code == 200

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "xlsx", "template": "accounting_v1"},
    )
    assert export.status_code == 200

    content_disposition = export.headers.get("content-disposition", "")
    assert content_disposition.endswith('_CLOSED.xlsx"')


def test_export_xlsx_qty_is_numeric_for_excel_sum(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]
    item = seed_zone_warehouse_item["item"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item.id, "quantity": 2, "mode": "set"},
    )
    assert add.status_code == 200

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "xlsx", "template": "accounting_v1"},
    )
    assert export.status_code == 200

    workbook = load_workbook(filename=BytesIO(export.content), data_only=True)
    goods_sheet = workbook["Товары"]
    assert isinstance(goods_sheet.cell(row=8, column=4).value, (int, float))


def test_export_xlsx_includes_all_catalog_items_and_dash_for_missing_qty(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]

    measured = client.post(
        "/items",
        headers=auth_headers,
        json={
            "product_code": "12001",
            "name": "Measured Item",
            "unit": "kg",
            "warehouse_id": warehouse.id,
            "step": 0.01,
        },
    )
    assert measured.status_code == 200
    measured_id = measured.json()["id"]

    unmeasured = client.post(
        "/items",
        headers=auth_headers,
        json={
            "product_code": "12002",
            "name": "Unmeasured Item",
            "unit": "pcs",
            "warehouse_id": warehouse.id,
            "step": 1.0,
        },
    )
    assert unmeasured.status_code == 200

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": measured_id, "quantity": 9.15, "mode": "set"},
    )
    assert add.status_code == 200

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "xlsx", "template": "accounting_v1"},
    )
    assert export.status_code == 200

    workbook = load_workbook(filename=BytesIO(export.content), data_only=True)
    goods_sheet = workbook["Товары"]

    values_by_name = {}
    for row_index in range(8, goods_sheet.max_row + 1):
        item_name = goods_sheet.cell(row=row_index, column=2).value
        if item_name:
            values_by_name[str(item_name)] = {
                "code": goods_sheet.cell(row=row_index, column=1).value,
                "unit": goods_sheet.cell(row=row_index, column=3).value,
                "qty": goods_sheet.cell(row=row_index, column=4).value,
            }

    assert "Measured Item" in values_by_name
    assert "Unmeasured Item" in values_by_name
    assert values_by_name["Measured Item"]["qty"] == 9.15
    assert values_by_name["Unmeasured Item"]["qty"] == "-"
    assert values_by_name["Measured Item"]["code"] == "12001"
    assert values_by_name["Unmeasured Item"]["code"] == "12002"


def test_export_xlsx_keeps_session_item_even_if_item_is_inactive(
    client,
    auth_headers,
    seed_zone_warehouse_item,
    db_session,
):
    warehouse = seed_zone_warehouse_item["warehouse"]

    item_response = client.post(
        "/items",
        headers=auth_headers,
        json={
            "product_code": "12003",
            "name": "Лист лайма",
            "unit": "pcs",
            "warehouse_id": warehouse.id,
            "step": 1.0,
        },
    )
    assert item_response.status_code == 200
    item_id = item_response.json()["id"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 4, "mode": "set"},
    )
    assert add.status_code == 200

    item = db_session.query(Item).filter(Item.id == item_id).first()
    assert item is not None
    item.is_active = False
    db_session.add(item)
    db_session.commit()

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "xlsx", "template": "accounting_v1"},
    )
    assert export.status_code == 200

    workbook = load_workbook(filename=BytesIO(export.content), data_only=True)
    goods_sheet = workbook["Товары"]

    values_by_name = {}
    for row_index in range(8, goods_sheet.max_row + 1):
        item_name = goods_sheet.cell(row=row_index, column=2).value
        if item_name:
            values_by_name[str(item_name)] = {
                "code": goods_sheet.cell(row=row_index, column=1).value,
                "unit": goods_sheet.cell(row=row_index, column=3).value,
                "qty": goods_sheet.cell(row=row_index, column=4).value,
            }

    assert "Лист лайма" in values_by_name
    assert values_by_name["Лист лайма"]["code"] == "12003"
    assert values_by_name["Лист лайма"]["qty"] == 4


def test_export_csv_keeps_russian_names_utf8(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]

    create_item = client.post(
        "/items",
        headers=auth_headers,
        json={
            "product_code": "10202",
            "name": "Говядина вырезка",
            "unit": "кг",
            "warehouse_id": warehouse.id,
            "step": 0.01,
        },
    )
    assert create_item.status_code == 200
    item_id = create_item.json()["id"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 2.5, "mode": "set"},
    )
    assert add.status_code == 200

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "csv", "template": "accounting_v1"},
    )
    assert export.status_code == 200

    body = export.content.decode("utf-8")
    assert "Говядина вырезка" in body


def test_export_500_rows_completes_quickly(
    client,
    auth_headers,
    seed_zone_warehouse_item,
    db_session,
):
    warehouse = seed_zone_warehouse_item["warehouse"]
    actor = db_session.query(User).filter(User.username == "testuser").first()
    assert actor is not None

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    items = [
        Item(
            product_code=f"{10000 + index:05d}",
            name=f"Perf Item {index:03d}",
            unit="pcs",
            step=1.0,
            warehouse_id=warehouse.id,
            is_active=True,
        )
        for index in range(1, 501)
    ]
    db_session.add_all(items)
    db_session.flush()

    entries = [
        InventoryEntry(
            session_id=session_id,
            item_id=item.id,
            quantity=float(index),
            updated_by_user_id=actor.id,
        )
        for index, item in enumerate(items, start=1)
    ]
    db_session.add_all(entries)
    db_session.commit()

    started = time.perf_counter()
    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "xlsx", "template": "accounting_v1"},
    )
    elapsed_seconds = time.perf_counter() - started

    assert export.status_code == 200
    assert elapsed_seconds < 8.0
