def test_session_audit_returns_events_with_before_after_and_reason(
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

    first = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers={**auth_headers, "x-request-id": "req-1"},
        json={"item_id": item_id, "quantity": 1, "mode": "set", "reason": "initial count"},
    )
    assert first.status_code == 200

    second = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers={**auth_headers, "x-request-id": "req-2"},
        json={"item_id": item_id, "quantity": 2, "mode": "set", "reason": "recount"},
    )
    assert second.status_code == 200

    audit = client.get(f"/inventory/sessions/{session_id}/audit", headers=auth_headers)
    assert audit.status_code == 200
    events = audit.json()

    assert len(events) >= 2
    newest = events[0]
    older = events[1]

    assert newest["reason"] == "recount"
    assert newest["request_id"] == "req-2"
    assert newest["actor_username"] == "testuser"
    assert newest["before_quantity"] == 1.0
    assert newest["after_quantity"] == 2.0

    assert older["reason"] == "initial count"
    assert older["request_id"] == "req-1"
    assert older["actor_username"] == "testuser"
    assert older["before_quantity"] is None
    assert older["after_quantity"] == 1.0


def test_entry_audit_returns_only_selected_item(
    client, auth_headers, seed_zone_warehouse_item, db_session
):
    from app.models.item import Item

    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_1_id = seed_zone_warehouse_item["item"].id

    item_2 = Item(
        product_code="10060",
        name="Salt",
        unit="kg",
        step=1.0,
        is_active=True,
        warehouse_id=warehouse_id,
    )
    db_session.add(item_2)
    db_session.commit()
    db_session.refresh(item_2)

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    session_id = active.json()["id"]

    add_1 = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_1_id, "quantity": 1, "mode": "set"},
    )
    assert add_1.status_code == 200

    add_2 = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_2.id, "quantity": 1, "mode": "set"},
    )
    assert add_2.status_code == 200

    audit_item_1 = client.get(
        f"/inventory/entries/{session_id}/{item_1_id}/audit",
        headers=auth_headers,
    )
    assert audit_item_1.status_code == 200

    events = audit_item_1.json()
    assert len(events) >= 1
    assert all(event["item_id"] == item_1_id for event in events)


def test_idempotent_replay_does_not_create_extra_audit_event(
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

    headers = {**auth_headers, "Idempotency-Key": "audit-idem-1", "x-request-id": "req-idem"}

    first = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=headers,
        json={"item_id": item_id, "quantity": 3, "mode": "set", "reason": "idem test"},
    )
    assert first.status_code == 200

    second = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=headers,
        json={"item_id": item_id, "quantity": 3, "mode": "set", "reason": "idem test"},
    )
    assert second.status_code == 200

    audit = client.get(f"/inventory/entries/{session_id}/{item_id}/audit", headers=auth_headers)
    assert audit.status_code == 200
    events = [e for e in audit.json() if e["reason"] == "idem test"]
    assert len(events) == 1


def test_global_audit_endpoint_filters_by_session_and_item(
    client,
    auth_headers_chef,
    seed_zone_warehouse_item,
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_id = seed_zone_warehouse_item["item"].id

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers_chef,
        json={"warehouse_id": warehouse_id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers_chef,
        json={"item_id": item_id, "quantity": 2, "mode": "set", "reason": "chef audit"},
    )
    assert add.status_code == 200

    audit = client.get(
        f"/inventory/audit?warehouse_id={warehouse_id}&session_id={session_id}&item_id={item_id}",
        headers=auth_headers_chef,
    )
    assert audit.status_code == 200
    events = audit.json()
    assert len(events) >= 1
    assert all(row["session_id"] == session_id for row in events)
    assert all(row["item_id"] == item_id for row in events)
    assert all(row["actor_username"] == "chefuser" for row in events)


def test_audit_endpoints_forbidden_for_cook(
    client,
    auth_headers,
    auth_headers_cook,
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

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 1, "mode": "set"},
    )
    assert add.status_code == 200

    session_audit = client.get(
        f"/inventory/sessions/{session_id}/audit",
        headers=auth_headers_cook,
    )
    assert session_audit.status_code == 403

    entry_audit = client.get(
        f"/inventory/entries/{session_id}/{item_id}/audit",
        headers=auth_headers_cook,
    )
    assert entry_audit.status_code == 403

    global_audit = client.get(
        "/inventory/audit",
        headers=auth_headers_cook,
    )
    assert global_audit.status_code == 403
