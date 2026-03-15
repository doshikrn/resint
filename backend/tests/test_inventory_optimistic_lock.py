def test_patch_entry_with_if_match_updates_and_increments_version(
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

    created = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 1, "mode": "set"},
    )
    assert created.status_code == 200
    assert created.json()["version"] == 1

    patched = client.patch(
        f"/inventory/sessions/{session_id}/entries/{item_id}",
        headers={**auth_headers, "If-Match": "1"},
        json={"quantity": 2, "reason": "manual adjust"},
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["quantity"] == 2.0
    assert body["version"] == 2


def test_patch_entry_version_conflict_returns_409(
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

    conflict = client.patch(
        f"/inventory/sessions/{session_id}/entries/{item_id}",
        headers={**auth_headers, "If-Match": "999"},
        json={"quantity": 2},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["message"] == "Version conflict. Refresh and retry"


def test_patch_entry_accepts_body_version_when_header_missing(
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

    patched = client.patch(
        f"/inventory/sessions/{session_id}/entries/{item_id}",
        headers=auth_headers,
        json={"quantity": 3, "version": 1},
    )
    assert patched.status_code == 200
    assert patched.json()["version"] == 2


def test_patch_entry_requires_version_signal(
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

    missing = client.patch(
        f"/inventory/sessions/{session_id}/entries/{item_id}",
        headers=auth_headers,
        json={"quantity": 2},
    )
    assert missing.status_code == 422
    assert missing.json()["error"]["message"] == "Provide If-Match header or version in request body"


# ── POST upsert expected_version tests ──────────────────────────


def test_post_set_with_correct_expected_version_succeeds(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    """POST set upsert with matching expected_version updates the entry."""
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_id = seed_zone_warehouse_item["item"].id

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    session_id = active.json()["id"]

    # Create initial entry (version=1)
    created = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers={**auth_headers, "Idempotency-Key": "ev-ok-1"},
        json={"item_id": item_id, "quantity": 5, "mode": "set"},
    )
    assert created.status_code == 200
    assert created.json()["version"] == 1

    # Upsert with correct expected_version=1
    updated = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers={**auth_headers, "Idempotency-Key": "ev-ok-2"},
        json={"item_id": item_id, "quantity": 10, "mode": "set", "expected_version": 1},
    )
    assert updated.status_code == 200
    assert updated.json()["quantity"] == 10.0
    assert updated.json()["version"] == 2


def test_post_set_with_stale_expected_version_returns_409(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    """POST set upsert with stale expected_version returns VERSION_CONFLICT."""
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_id = seed_zone_warehouse_item["item"].id

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    session_id = active.json()["id"]

    # Create entry (version=1)
    created = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers={**auth_headers, "Idempotency-Key": "stale-1"},
        json={"item_id": item_id, "quantity": 5, "mode": "set"},
    )
    assert created.status_code == 200
    assert created.json()["version"] == 1

    # Upsert again so version=2
    updated = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers={**auth_headers, "Idempotency-Key": "stale-2"},
        json={"item_id": item_id, "quantity": 8, "mode": "set", "expected_version": 1},
    )
    assert updated.status_code == 200
    assert updated.json()["version"] == 2

    # Upsert with stale expected_version=1 (current is 2) → 409
    conflict = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers={**auth_headers, "Idempotency-Key": "stale-3"},
        json={"item_id": item_id, "quantity": 99, "mode": "set", "expected_version": 1},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "VERSION_CONFLICT"


def test_post_add_mode_ignores_expected_version(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    """POST add mode always succeeds regardless of expected_version."""
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_id = seed_zone_warehouse_item["item"].id

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    session_id = active.json()["id"]

    # Create entry (version=1)
    created = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers={**auth_headers, "Idempotency-Key": "add-ign-1"},
        json={"item_id": item_id, "quantity": 5, "mode": "set"},
    )
    assert created.status_code == 200

    # Add mode with wrong expected_version still succeeds
    added = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers={**auth_headers, "Idempotency-Key": "add-ign-2"},
        json={"item_id": item_id, "quantity": 3, "mode": "add", "expected_version": 999},
    )
    assert added.status_code == 200
    assert added.json()["quantity"] == 8.0  # 5 + 3


def test_post_set_without_expected_version_is_backward_compatible(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    """POST set upsert without expected_version still overwrites (backward compat)."""
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_id = seed_zone_warehouse_item["item"].id

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    session_id = active.json()["id"]

    # Create entry
    created = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers={**auth_headers, "Idempotency-Key": "bk-1"},
        json={"item_id": item_id, "quantity": 5, "mode": "set"},
    )
    assert created.status_code == 200

    # Overwrite without expected_version — should succeed
    updated = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers={**auth_headers, "Idempotency-Key": "bk-2"},
        json={"item_id": item_id, "quantity": 20, "mode": "set"},
    )
    assert updated.status_code == 200
    assert updated.json()["quantity"] == 20.0
