from app.models.item import Item


def test_error_code_session_closed_on_add_entry(
    client, auth_headers, auth_headers_cook, seed_zone_warehouse_item, seed_closed_session
):
    item_id = seed_zone_warehouse_item["item"].id

    # cook cannot add entries to a closed session
    rejected = client.post(
        f"/inventory/sessions/{seed_closed_session.id}/entries",
        headers=auth_headers_cook,
        json={"item_id": item_id, "quantity": 1, "mode": "add"},
    )
    assert rejected.status_code == 409
    assert rejected.json()["error"]["code"] == "SESSION_CLOSED"

    # admin (chef-equivalent) CAN add entries to closed session
    allowed = client.post(
        f"/inventory/sessions/{seed_closed_session.id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 1, "mode": "add"},
    )
    assert allowed.status_code == 200


def test_error_code_item_inactive(client, auth_headers, seed_zone_warehouse_item, db_session):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    inactive_item = Item(
        product_code="10050",
        name="Inactive Item",
        unit="kg",
        step=1.0,
        is_active=False,
        warehouse_id=warehouse_id,
    )
    db_session.add(inactive_item)
    db_session.commit()
    db_session.refresh(inactive_item)

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    session_id = active.json()["id"]

    response = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": inactive_item.id, "quantity": 1, "mode": "set"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ITEM_INACTIVE"


def test_error_code_version_conflict(client, auth_headers, seed_zone_warehouse_item):
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

    conflict = client.patch(
        f"/inventory/sessions/{session_id}/entries/{item_id}",
        headers={**auth_headers, "If-Match": "999"},
        json={"quantity": 2},
    )

    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "VERSION_CONFLICT"


def test_error_code_validation_step_mismatch(
    client, auth_headers, seed_zone_warehouse_item, db_session
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    item = Item(
        product_code="10051",
        name="Stepped",
        unit="pcs",
        step=0.25,
        is_active=True,
        warehouse_id=warehouse_id,
    )
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    session_id = active.json()["id"]

    bad = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item.id, "quantity": 0.3, "mode": "set"},
    )

    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "VALIDATION_STEP_MISMATCH"


def test_idempotency_replay_header_code(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_id = seed_zone_warehouse_item["item"].id

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    session_id = active.json()["id"]

    headers = {**auth_headers, "Idempotency-Key": "replay-code-1"}

    first = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=headers,
        json={"item_id": item_id, "quantity": 1, "mode": "set"},
    )
    assert first.status_code == 200

    second = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=headers,
        json={"item_id": item_id, "quantity": 1, "mode": "set"},
    )
    assert second.status_code == 200
    assert second.headers.get("x-idempotency-code") == "IDEMPOTENCY_REPLAY"
    assert second.headers.get("x-idempotency-replay") == "true"
