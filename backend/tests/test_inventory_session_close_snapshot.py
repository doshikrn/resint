def test_close_session_creates_snapshot_and_sets_closed_flags(
    client,
    auth_headers,
    seed_zone_warehouse_item,
    db_session,
):
    from app.models.inventory_session_event import InventorySessionEvent
    from app.models.inventory_session_total import InventorySessionTotal

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

    close = client.post(
        f"/inventory/sessions/{session_id}/close",
        headers={**auth_headers, "x-request-id": "close-req-1"},
    )
    assert close.status_code == 200
    body = close.json()
    assert body["status"] == "closed"
    assert body["is_closed"] is True

    totals = (
        db_session.query(InventorySessionTotal)
        .filter(InventorySessionTotal.session_id == session_id)
        .all()
    )
    assert len(totals) == 1
    assert totals[0].item_id == item_id
    assert totals[0].qty_final == 2.0

    session_events = (
        db_session.query(InventorySessionEvent)
        .filter(InventorySessionEvent.session_id == session_id)
        .all()
    )
    assert len(session_events) >= 1
    assert any(e.action == "session_closed" and e.request_id == "close-req-1" for e in session_events)


def test_post_entries_rejected_after_close(client, auth_headers, auth_headers_cook, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_id = seed_zone_warehouse_item["item"].id

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    session_id = active.json()["id"]

    close = client.post(f"/inventory/sessions/{session_id}/close", headers=auth_headers)
    assert close.status_code == 200

    # cook cannot add entries after close
    rejected = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers_cook,
        json={"item_id": item_id, "quantity": 1, "mode": "set"},
    )
    assert rejected.status_code == 409
    assert rejected.json()["error"]["message"] == "Session is closed"

    # admin (chef-equivalent) CAN still add entries after close
    allowed = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 1, "mode": "set"},
    )
    assert allowed.status_code == 200


def test_patch_after_close_requires_reason_and_marks_action(
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
    session_id = active.json()["id"]

    created = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 1, "mode": "set"},
    )
    assert created.status_code == 200

    close = client.post(f"/inventory/sessions/{session_id}/close", headers=auth_headers)
    assert close.status_code == 200

    no_reason = client.patch(
        f"/inventory/sessions/{session_id}/entries/{item_id}",
        headers={**auth_headers, "If-Match": "1"},
        json={"quantity": 2},
    )
    assert no_reason.status_code == 422
    assert no_reason.json()["error"]["message"] == "Reason is required for corrections after close"

    with_reason = client.patch(
        f"/inventory/sessions/{session_id}/entries/{item_id}",
        headers={**auth_headers, "If-Match": "1", "x-request-id": "patch-after-close-1"},
        json={"quantity": 2, "reason": "post-close correction"},
    )
    assert with_reason.status_code == 200

    audit = client.get(f"/inventory/entries/{session_id}/{item_id}/audit", headers=auth_headers)
    assert audit.status_code == 200
    actions = [row["action"] for row in audit.json() if row["reason"] == "post-close correction"]
    assert "correct_after_close" in actions
