from app.models.inventory_session_event import InventorySessionEvent


def test_session_progress_shows_entered_items_and_last_activity(
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

    progress_before = client.get(
        f"/inventory/sessions/{session_id}/progress",
        headers=auth_headers,
    )
    assert progress_before.status_code == 200
    body_before = progress_before.json()
    assert body_before["total_counted_items"] == 0
    assert body_before["my_counted_items"] == 0
    assert body_before["last_activity_at"] is None

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item.id, "quantity": 2, "mode": "set"},
    )
    assert add.status_code == 200

    progress_after = client.get(
        f"/inventory/sessions/{session_id}/progress",
        headers=auth_headers,
    )
    assert progress_after.status_code == 200
    body_after = progress_after.json()
    assert body_after["total_counted_items"] == 1
    assert body_after["my_counted_items"] == 1
    assert body_after["last_activity_at"] is not None


def test_zone_complete_marks_progress_and_creates_session_event(
    client,
    auth_headers,
    db_session,
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
        json={"item_id": item.id, "quantity": 1, "mode": "set"},
    )
    assert add.status_code == 200

    complete = client.post(
        f"/inventory/sessions/{session_id}/zone-complete",
        headers=auth_headers,
    )
    assert complete.status_code == 200
    body = complete.json()
    assert body["is_completed"] is True
    assert body["completed_at"] is not None
    assert body["completed_by_username"] == "testuser"

    events = (
        db_session.query(InventorySessionEvent)
        .filter(
            InventorySessionEvent.session_id == session_id,
            InventorySessionEvent.action == "zone_completed",
        )
        .all()
    )
    assert len(events) >= 1


def test_progress_list_returns_zone_and_warehouse_status(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    zone = seed_zone_warehouse_item["zone"]
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
        json={"item_id": item.id, "quantity": 1, "mode": "set"},
    )
    assert add.status_code == 200

    complete = client.post(
        f"/inventory/sessions/{session_id}/zone-complete",
        headers=auth_headers,
    )
    assert complete.status_code == 200

    listing = client.get(
        f"/inventory/progress?zone_id={zone.id}",
        headers=auth_headers,
    )
    assert listing.status_code == 200
    rows = listing.json()
    assert len(rows) >= 1

    first = rows[0]
    assert first["zone_id"] == zone.id
    assert first["warehouse_id"] == warehouse.id
    assert isinstance(first["entered_items_count"], int)
    assert first["is_completed"] is True
