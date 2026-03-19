def test_recent_entry_events_default_and_requested_limits(
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

    for quantity in range(1, 31):
        response = client.post(
            f"/inventory/sessions/{session_id}/entries",
            headers=auth_headers,
            json={"item_id": item.id, "quantity": quantity, "mode": "set"},
        )
        assert response.status_code == 200

    default_events = client.get(
        f"/inventory/sessions/{session_id}/entries/recent-events",
        headers=auth_headers,
    )
    assert default_events.status_code == 200
    default_body = default_events.json()
    assert len(default_body) == 20
    assert default_body[0]["qty_input"] == 30
    assert default_body[-1]["qty_input"] == 11

    expanded_events = client.get(
        f"/inventory/sessions/{session_id}/entries/recent-events?limit=25",
        headers=auth_headers,
    )
    assert expanded_events.status_code == 200
    expanded_body = expanded_events.json()
    assert len(expanded_body) == 25
    assert expanded_body[0]["qty_input"] == 30
    assert expanded_body[-1]["qty_input"] == 6

    first_ids = [row["id"] for row in expanded_body]
    assert first_ids == sorted(first_ids, reverse=True)