from datetime import datetime, timezone

from app.models.inventory_session import InventorySession


def test_session_report_returns_snapshot_for_closed_session(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_id = seed_zone_warehouse_item["item"].id

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 2, "mode": "set"},
    )
    assert add.status_code == 200

    close = client.post(f"/inventory/sessions/{session_id}/close", headers=auth_headers)
    assert close.status_code == 200

    report = client.get(f"/inventory/reports/session/{session_id}", headers=auth_headers)
    assert report.status_code == 200
    body = report.json()
    assert body["session_id"] == session_id
    assert body["warehouse_id"] == warehouse_id
    assert body["is_closed"] is True
    assert body["status"] == "closed"
    assert len(body["items"]) == 1
    assert body["items"][0]["item_id"] == item_id
    assert body["items"][0]["quantity"] == 2.0


def test_diff_report_compares_previous_and_current_windows(
    client,
    auth_headers,
    seed_zone_warehouse_item,
    db_session,
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_id = seed_zone_warehouse_item["item"].id

    prev_session_resp = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    assert prev_session_resp.status_code == 200
    prev_session_id = prev_session_resp.json()["id"]

    prev_add = client.post(
        f"/inventory/sessions/{prev_session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 5, "mode": "set"},
    )
    assert prev_add.status_code == 200
    assert client.post(f"/inventory/sessions/{prev_session_id}/close", headers=auth_headers).status_code == 200

    cur_session_resp = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    assert cur_session_resp.status_code == 200
    cur_session_id = cur_session_resp.json()["id"]

    cur_add = client.post(
        f"/inventory/sessions/{cur_session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 8, "mode": "set"},
    )
    assert cur_add.status_code == 200
    assert client.post(f"/inventory/sessions/{cur_session_id}/close", headers=auth_headers).status_code == 200

    prev_session = db_session.query(InventorySession).filter(InventorySession.id == prev_session_id).first()
    cur_session = db_session.query(InventorySession).filter(InventorySession.id == cur_session_id).first()
    prev_session.created_at = datetime(2026, 2, 21, 12, 0, tzinfo=timezone.utc)
    cur_session.created_at = datetime(2026, 2, 22, 12, 0, tzinfo=timezone.utc)
    db_session.commit()

    report = client.get(
        "/inventory/reports/diff",
        headers=auth_headers,
        params={
            "warehouse_id": warehouse_id,
            "from": "2026-02-22T00:00:00Z",
            "to": "2026-02-23T00:00:00Z",
        },
    )
    assert report.status_code == 200
    body = report.json()

    assert body["warehouse_id"] == warehouse_id
    assert body["from"].startswith("2026-02-22")
    assert body["to"].startswith("2026-02-23")

    item_row = next(row for row in body["items"] if row["item_id"] == item_id)
    assert item_row["previous_quantity"] == 5.0
    assert item_row["current_quantity"] == 8.0
    assert item_row["diff_quantity"] == 3.0

    assert body["totals"]["previous_quantity"] == 5.0
    assert body["totals"]["current_quantity"] == 8.0
    assert body["totals"]["diff_quantity"] == 3.0


def test_diff_report_rejects_invalid_range(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    report = client.get(
        "/inventory/reports/diff",
        headers=auth_headers,
        params={
            "warehouse_id": warehouse_id,
            "from": "2026-02-23T00:00:00Z",
            "to": "2026-02-22T00:00:00Z",
        },
    )
    assert report.status_code == 422


def test_diff_report_day_to_day_mode_with_tz_offset(
    client,
    auth_headers,
    seed_zone_warehouse_item,
    db_session,
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_id = seed_zone_warehouse_item["item"].id

    prev_session_resp = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    prev_session_id = prev_session_resp.json()["id"]
    assert client.post(
        f"/inventory/sessions/{prev_session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 2, "mode": "set"},
    ).status_code == 200
    assert client.post(f"/inventory/sessions/{prev_session_id}/close", headers=auth_headers).status_code == 200

    cur_session_resp = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    cur_session_id = cur_session_resp.json()["id"]
    assert client.post(
        f"/inventory/sessions/{cur_session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 7, "mode": "set"},
    ).status_code == 200
    assert client.post(f"/inventory/sessions/{cur_session_id}/close", headers=auth_headers).status_code == 200

    prev_session = db_session.query(InventorySession).filter(InventorySession.id == prev_session_id).first()
    cur_session = db_session.query(InventorySession).filter(InventorySession.id == cur_session_id).first()
    prev_session.created_at = datetime(2026, 2, 21, 9, 0, tzinfo=timezone.utc)
    cur_session.created_at = datetime(2026, 2, 22, 9, 0, tzinfo=timezone.utc)
    db_session.commit()

    report = client.get(
        "/inventory/reports/diff",
        headers=auth_headers,
        params={
            "warehouse_id": warehouse_id,
            "mode": "day_to_day",
            "day_local": "2026-02-22",
            "tz_offset_minutes": 180,
        },
    )
    assert report.status_code == 200
    body = report.json()
    assert body["mode"] == "day_to_day"
    assert body["tz_offset_minutes"] == 180
    assert body["day_local"] == "2026-02-22"

    item_row = next(row for row in body["items"] if row["item_id"] == item_id)
    assert item_row["previous_quantity"] == 2.0
    assert item_row["current_quantity"] == 7.0
    assert item_row["diff_quantity"] == 5.0


def test_diff_report_range_requires_from_to(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    report = client.get(
        "/inventory/reports/diff",
        headers=auth_headers,
        params={"warehouse_id": warehouse_id, "mode": "range"},
    )
    assert report.status_code == 422


def test_diff_today_shortcut_matches_day_to_day_mode(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    shortcut = client.get(
        "/inventory/reports/diff/today",
        headers=auth_headers,
        params={"warehouse_id": warehouse_id, "day_local": "2026-02-22", "tz_offset_minutes": 180},
    )
    assert shortcut.status_code == 200
    body = shortcut.json()

    assert body["mode"] == "day_to_day"
    assert body["day_local"] == "2026-02-22"
    assert body["tz_offset_minutes"] == 180
    assert "from" in body and "to" in body


def test_diff_today_shortcut_unknown_warehouse_returns_404(client, auth_headers):
    response = client.get(
        "/inventory/reports/diff/today",
        headers=auth_headers,
        params={"warehouse_id": 99999},
    )
    assert response.status_code == 404
