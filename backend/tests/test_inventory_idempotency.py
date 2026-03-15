from datetime import datetime, timedelta, timezone
import json


def test_idempotency_replay_returns_same_response_and_no_double_add(
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

    idem_headers = {**auth_headers, "Idempotency-Key": "entry-add-1"}

    first = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=idem_headers,
        json={"item_id": item_id, "quantity": 1, "mode": "add"},
    )
    second = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=idem_headers,
        json={"item_id": item_id, "quantity": 1, "mode": "add"},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()
    assert second.headers.get("x-idempotency-replay") == "true"
    assert second.headers.get("x-idempotency-code") == "IDEMPOTENCY_REPLAY"

    entries = client.get(f"/inventory/sessions/{session_id}/entries", headers=auth_headers)
    assert entries.status_code == 200
    same_item_entries = [entry for entry in entries.json() if entry["item_id"] == item_id]
    assert len(same_item_entries) == 1
    assert same_item_entries[0]["quantity"] == 1.0

    metrics = client.get("/metrics", headers=auth_headers)
    assert metrics.status_code == 200
    assert "app_idempotency_replays_total" in metrics.text


def test_idempotency_same_key_different_payload_returns_409(
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

    idem_headers = {**auth_headers, "Idempotency-Key": "entry-set-1"}

    first = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=idem_headers,
        json={"item_id": item_id, "quantity": 2, "mode": "set"},
    )
    assert first.status_code == 200

    second = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=idem_headers,
        json={"item_id": item_id, "quantity": 3, "mode": "set"},
    )

    assert second.status_code == 409
    assert second.json()["error"]["message"] == "Idempotency-Key reused with different payload"


def test_empty_idempotency_key_returns_422(
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

    headers = {**auth_headers, "Idempotency-Key": "   "}
    response = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=headers,
        json={"item_id": item_id, "quantity": 1, "mode": "set"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["message"] == "Idempotency-Key cannot be empty"


def test_idempotency_ttl_expired_key_does_not_block_new_request(
    client,
    db_session,
    seed_admin_user,
    auth_headers,
    seed_zone_warehouse_item,
):
    from app.models.idempotency_key import IdempotencyKey

    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_id = seed_zone_warehouse_item["item"].id

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    endpoint = "POST /inventory/sessions/{session_id}/entries"
    idempotency_key = "ttl-expired-key"
    old_created_at = datetime.now(timezone.utc) - timedelta(days=5)
    db_session.add(
        IdempotencyKey(
            user_id=seed_admin_user.id,
            endpoint=endpoint,
            idempotency_key=idempotency_key,
            request_hash="obsolete-hash",
            response_status=200,
            response_body=json.dumps({"ok": True}),
            created_at=old_created_at,
        )
    )
    db_session.commit()

    response = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers={**auth_headers, "Idempotency-Key": idempotency_key},
        json={"item_id": item_id, "quantity": 2, "mode": "set"},
    )
    assert response.status_code == 200
    assert response.headers.get("x-idempotency-replay") is None
    assert response.json()["quantity"] == 2.0

    metrics = client.get("/metrics", headers=auth_headers)
    assert metrics.status_code == 200
    assert "app_idempotency_ttl_cleanup_deleted_total" in metrics.text
