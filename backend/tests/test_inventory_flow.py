def test_active_session_returns_same_session(client, auth_headers, seed_zone_warehouse_item):
    headers = auth_headers
    warehouse_id = seed_zone_warehouse_item["warehouse"].id

    first = client.post(
        "/inventory/sessions/active", headers=headers, json={"warehouse_id": warehouse_id}
    )
    second = client.post(
        "/inventory/sessions/active", headers=headers, json={"warehouse_id": warehouse_id}
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]


def test_duplicate_add_entry_no_duplicates(client, auth_headers, seed_zone_warehouse_item):
    headers = auth_headers
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_id = seed_zone_warehouse_item["item"].id

    active = client.post(
        "/inventory/sessions/active", headers=headers, json={"warehouse_id": warehouse_id}
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    first_add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=headers,
        json={"item_id": item_id, "quantity": 1, "mode": "add"},
    )
    second_add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=headers,
        json={"item_id": item_id, "quantity": 1, "mode": "add"},
    )

    assert first_add.status_code == 200
    assert second_add.status_code == 200
    assert first_add.json()["id"] == second_add.json()["id"]

    entries = client.get(f"/inventory/sessions/{session_id}/entries", headers=headers)
    assert entries.status_code == 200
    body = entries.json()

    same_item_entries = [entry for entry in body if entry["item_id"] == item_id]
    assert len(same_item_entries) == 1
    assert same_item_entries[0]["quantity"] == 2.0


def test_entry_response_contains_item_metadata(client, auth_headers, seed_zone_warehouse_item):
    headers = auth_headers
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item = seed_zone_warehouse_item["item"]

    active = client.post(
        "/inventory/sessions/active", headers=headers, json={"warehouse_id": warehouse_id}
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=headers,
        json={"item_id": item.id, "quantity": 3, "mode": "set"},
    )
    assert add.status_code == 200

    payload = add.json()
    assert payload["item_name"] == item.name
    assert payload["unit"] == item.unit
    assert payload["updated_at"]


def test_active_session_collaborative_writes_and_manager_close(
    client,
    auth_headers,
    auth_headers_souschef,
    seed_zone_warehouse_item,
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_id = seed_zone_warehouse_item["item"].id

    owner_active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    assert owner_active.status_code == 200
    session_id = owner_active.json()["id"]

    owner_add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 1, "mode": "set"},
    )
    assert owner_add.status_code == 200

    other_active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers_souschef,
        json={"warehouse_id": warehouse_id},
    )
    assert other_active.status_code == 200
    assert other_active.json()["id"] == session_id

    read_entries = client.get(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers_souschef,
    )
    assert read_entries.status_code == 200

    other_add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers_souschef,
        json={"item_id": item_id, "quantity": 2, "mode": "set"},
    )
    assert other_add.status_code == 200

    other_patch = client.patch(
        f"/inventory/sessions/{session_id}/entries/{item_id}",
        headers={**auth_headers_souschef, "If-Match": "2"},
        json={"quantity": 2},
    )
    assert other_patch.status_code == 200

    other_close = client.post(
        f"/inventory/sessions/{session_id}/close",
        headers=auth_headers_souschef,
    )
    assert other_close.status_code == 200

    owner_close = client.post(
        f"/inventory/sessions/{session_id}/close",
        headers=auth_headers,
    )
    assert owner_close.status_code == 200
