import csv
import time
from io import BytesIO, StringIO

from openpyxl import load_workbook

from app.models.inventory_entry import InventoryEntry
from app.models.item import Item
from app.models.user import User
from app.services.export import (
    ACCOUNTING_SEMIFINISHED_SHEET_TITLE,
    is_semifinished_item,
    sort_export_rows_by_item_name,
)


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


def test_sort_export_rows_by_item_name_mixed_case_trim_and_stable_ties():
    rows = [
        {"Item": "  banana "},
        {"Item": "zebra"},
        {"Item": "Apple"},
        {"Item": "aPPle"},
    ]
    sort_export_rows_by_item_name(rows)
    assert [r["Item"] for r in rows] == ["Apple", "aPPle", "  banana ", "zebra"]


def test_is_semifinished_item_detects_pf_marker_any_case():
    for label in ("п/ф", "П/ф", "п/Ф", "П/Ф"):
        assert is_semifinished_item({"Item": label})
        assert is_semifinished_item({"Item": f"Заготовка {label} для супа"})
    assert not is_semifinished_item({"Item": "Milk"})
    assert not is_semifinished_item({"Item": "п ф без слэша"})


def _xlsx_goods_rows_on_sheet(content: bytes, sheet_title: str) -> list[tuple[str, str]]:
    workbook = load_workbook(filename=BytesIO(content), data_only=True)
    goods_sheet = workbook[sheet_title]
    rows_out: list[tuple[str, str]] = []
    for row_index in range(8, goods_sheet.max_row + 1):
        code = goods_sheet.cell(row=row_index, column=1).value
        name = goods_sheet.cell(row=row_index, column=2).value
        if code and name:
            rows_out.append((str(code), str(name)))
    return rows_out


def test_session_export_xlsx_semifinished_sheet_splits_pf_items(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]
    milk_name = seed_zone_warehouse_item["item"].name

    payloads = (
        {"product_code": "60101", "name": "Соус п/ф томат", "unit": "kg", "warehouse_id": warehouse.id, "step": 0.01},
        {"product_code": "60102", "name": "П/ф картофель", "unit": "kg", "warehouse_id": warehouse.id, "step": 0.01},
        {"product_code": "60103", "name": "п/Ф лук", "unit": "kg", "warehouse_id": warehouse.id, "step": 0.01},
        {"product_code": "60104", "name": "П/Ф рис", "unit": "kg", "warehouse_id": warehouse.id, "step": 0.01},
        {"product_code": "60105", "name": "Plain Sugar", "unit": "kg", "warehouse_id": warehouse.id, "step": 0.01},
    )
    created_ids: list[int] = []
    for payload in payloads:
        r = client.post("/items", headers=auth_headers, json=payload)
        assert r.status_code == 200
        created_ids.append(r.json()["id"])

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    for item_id in created_ids:
        add = client.post(
            f"/inventory/sessions/{session_id}/entries",
            headers=auth_headers,
            json={"item_id": item_id, "quantity": 1, "mode": "set"},
        )
        assert add.status_code == 200

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "xlsx", "template": "accounting_v1"},
    )
    assert export.status_code == 200

    workbook = load_workbook(filename=BytesIO(export.content), data_only=True)
    assert "Товары" in workbook.sheetnames
    assert ACCOUNTING_SEMIFINISHED_SHEET_TITLE in workbook.sheetnames
    assert workbook.sheetnames[0] == "Товары"

    main_rows = _xlsx_goods_rows_on_sheet(export.content, "Товары")
    pf_rows = _xlsx_goods_rows_on_sheet(export.content, ACCOUNTING_SEMIFINISHED_SHEET_TITLE)

    main_names = [n for _, n in main_rows]
    pf_names = [n for _, n in pf_rows]

    for name in main_names:
        assert not is_semifinished_item({"Item": name})
    for name in pf_names:
        assert is_semifinished_item({"Item": name})

    assert milk_name in main_names
    assert "Plain Sugar" in main_names
    assert set(pf_names) == {
        "Соус п/ф томат",
        "П/ф картофель",
        "п/Ф лук",
        "П/Ф рис",
    }
    assert main_names == sorted(main_names, key=lambda n: n.strip().lower())
    assert pf_names == sorted(pf_names, key=lambda n: n.strip().lower())


def test_session_export_xlsx_no_pf_sheet_when_no_semifinished_items(
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

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": seed_zone_warehouse_item["item"].id, "quantity": 2, "mode": "set"},
    )
    assert add.status_code == 200

    export = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "xlsx", "template": "accounting_v1"},
    )
    assert export.status_code == 200
    workbook = load_workbook(filename=BytesIO(export.content), data_only=True)
    assert workbook.sheetnames == ["Товары"]


def test_session_export_csv_still_lists_semifinished_items_on_single_export(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]

    semi = client.post(
        "/items",
        headers=auth_headers,
        json={
            "product_code": "60110",
            "name": "Соус П/ф для теста CSV",
            "unit": "l",
            "warehouse_id": warehouse.id,
            "step": 0.01,
        },
    )
    assert semi.status_code == 200

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
        json={"item_id": semi.json()["id"], "quantity": 2.5, "mode": "set"},
    )
    assert add.status_code == 200

    export_csv = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "csv"},
    )
    assert export_csv.status_code == 200
    body = export_csv.content.decode("utf-8")
    assert "Соус П/ф для теста CSV" in body


def test_session_export_xlsx_fallback_semifinished_on_pf_sheet(
    client,
    auth_headers,
    seed_zone_warehouse_item,
    db_session,
):
    warehouse = seed_zone_warehouse_item["warehouse"]

    semi = client.post(
        "/items",
        headers=auth_headers,
        json={
            "product_code": "60120",
            "name": "Заготовка п/ф inactive",
            "unit": "pcs",
            "warehouse_id": warehouse.id,
            "step": 1.0,
        },
    )
    assert semi.status_code == 200
    semi_id = semi.json()["id"]

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
        json={"item_id": semi_id, "quantity": 7, "mode": "set"},
    )
    assert add.status_code == 200

    item = db_session.query(Item).filter(Item.id == semi_id).first()
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
    assert ACCOUNTING_SEMIFINISHED_SHEET_TITLE in workbook.sheetnames

    pf_rows = _xlsx_goods_rows_on_sheet(export.content, ACCOUNTING_SEMIFINISHED_SHEET_TITLE)
    assert any("Заготовка п/ф inactive" == name for _, name in pf_rows)
    assert all(is_semifinished_item({"Item": name}) for _, name in pf_rows)


def _session_export_csv_item_names(body: str) -> list[str]:
    reader = csv.reader(StringIO(body))
    rows = list(reader)
    if not rows:
        return []
    header = rows[0]
    item_idx = header.index("Item")
    return [r[item_idx] for r in rows[1:] if len(r) > item_idx]


def _session_export_xlsx_item_names(content: bytes) -> list[str]:
    workbook = load_workbook(filename=BytesIO(content), data_only=True)
    goods_sheet = workbook["Товары"]
    names: list[str] = []
    for row_index in range(8, goods_sheet.max_row + 1):
        name = goods_sheet.cell(row=row_index, column=2).value
        code = goods_sheet.cell(row=row_index, column=1).value
        if name and code:
            names.append(str(name))
    return names


def test_session_export_csv_and_xlsx_share_alphabetical_item_order(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse = seed_zone_warehouse_item["warehouse"]

    created: dict[str, int] = {}
    for payload in (
        {"product_code": "50101", "name": "Zulu row", "unit": "kg", "warehouse_id": warehouse.id, "step": 0.01},
        {"product_code": "50102", "name": "alpha mixed", "unit": "kg", "warehouse_id": warehouse.id, "step": 0.01},
        {"product_code": "50103", "name": "Mike", "unit": "kg", "warehouse_id": warehouse.id, "step": 0.01},
    ):
        r = client.post("/items", headers=auth_headers, json=payload)
        assert r.status_code == 200
        created[payload["name"]] = r.json()["id"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    for item_name in ("Zulu row", "Mike", "alpha mixed"):
        add = client.post(
            f"/inventory/sessions/{session_id}/entries",
            headers=auth_headers,
            json={"item_id": created[item_name], "quantity": 1, "mode": "set"},
        )
        assert add.status_code == 200

    exp_csv = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "csv"},
    )
    exp_xlsx = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "xlsx"},
    )
    assert exp_csv.status_code == 200
    assert exp_xlsx.status_code == 200

    subset = frozenset({"Zulu row", "alpha mixed", "Mike"})
    csv_subset = [n for n in _session_export_csv_item_names(exp_csv.content.decode("utf-8")) if n in subset]
    xlsx_subset = [n for n in _session_export_xlsx_item_names(exp_xlsx.content) if n in subset]
    expected = sorted(subset, key=lambda n: n.strip().lower())
    assert csv_subset == expected
    assert xlsx_subset == expected
    assert csv_subset == xlsx_subset


def test_session_export_fallback_row_sorted_by_item_name_with_catalog_rows(
    client,
    auth_headers,
    seed_zone_warehouse_item,
    db_session,
):
    warehouse = seed_zone_warehouse_item["warehouse"]
    milk_name = seed_zone_warehouse_item["item"].name

    banana = client.post(
        "/items",
        headers=auth_headers,
        json={
            "product_code": "50201",
            "name": "Banana line",
            "unit": "pcs",
            "warehouse_id": warehouse.id,
            "step": 1.0,
        },
    )
    assert banana.status_code == 200
    apple = client.post(
        "/items",
        headers=auth_headers,
        json={
            "product_code": "50200",
            "name": "Apple gap",
            "unit": "pcs",
            "warehouse_id": warehouse.id,
            "step": 1.0,
        },
    )
    assert apple.status_code == 200
    apple_id = apple.json()["id"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse.id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    for item_id, qty in (
        (seed_zone_warehouse_item["item"].id, 1),
        (banana.json()["id"], 2),
        (apple_id, 3),
    ):
        add = client.post(
            f"/inventory/sessions/{session_id}/entries",
            headers=auth_headers,
            json={"item_id": item_id, "quantity": qty, "mode": "set"},
        )
        assert add.status_code == 200

    item = db_session.query(Item).filter(Item.id == apple_id).first()
    assert item is not None
    item.is_active = False
    db_session.add(item)
    db_session.commit()

    exp_csv = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "csv"},
    )
    exp_xlsx = client.get(
        f"/inventory/sessions/{session_id}/export",
        headers=auth_headers,
        params={"format": "xlsx"},
    )
    assert exp_csv.status_code == 200
    assert exp_xlsx.status_code == 200

    subset = frozenset({"Apple gap", "Banana line", milk_name})
    csv_subset = [n for n in _session_export_csv_item_names(exp_csv.content.decode("utf-8")) if n in subset]
    xlsx_subset = [n for n in _session_export_xlsx_item_names(exp_xlsx.content) if n in subset]
    expected = sorted(subset, key=lambda n: n.strip().lower())
    assert csv_subset == expected
    assert xlsx_subset == expected
    assert csv_subset == xlsx_subset


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
    assert [row[1] for row in rows] == ["Beef Round", "Milk", "Water Bottle"]


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
