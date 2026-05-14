"""Tests for inventory revision analytics (closed sessions + totals)."""


def _close_session(client, auth_headers, warehouse_id, item_qty_pairs: list[tuple[int, float]]):
    """Create active session, set entries, close. Returns session_id."""
    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id, "create_if_missing": True},
    )
    assert active.status_code == 200
    sid = active.json()["id"]
    for item_id, qty in item_qty_pairs:
        r = client.post(
            f"/inventory/sessions/{sid}/entries",
            headers=auth_headers,
            json={"item_id": item_id, "quantity": qty, "mode": "set"},
        )
        assert r.status_code == 200, r.text
    close = client.post(
        f"/inventory/sessions/{sid}/close",
        headers=auth_headers,
        json={"reason": "analytics-test"},
    )
    assert close.status_code == 200, close.text
    return sid


def test_analytics_summary_and_diff_between_two_closed_sessions(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_a = seed_zone_warehouse_item["item"].id

    item_b = client.post(
        "/items",
        headers=auth_headers,
        json={
            "name": "Analytics Item B",
            "unit": "pcs",
            "warehouse_id": warehouse_id,
            "step": 1,
        },
    )
    assert item_b.status_code == 200
    item_b_id = item_b.json()["id"]

    s1 = _close_session(client, auth_headers, warehouse_id, [(item_a, 10.0)])
    s2 = _close_session(client, auth_headers, warehouse_id, [(item_a, 15.0), (item_b_id, 3.0)])

    summary = client.get(
        "/analytics/inventory/summary",
        headers=auth_headers,
        params={"warehouse_id": warehouse_id},
    )
    assert summary.status_code == 200
    body = summary.json()
    assert body["closed_sessions_count"] >= 2
    assert body["last_session"]["id"] == s2
    assert body["total_abs_delta_qty"] > 0

    diff = client.get(
        "/analytics/inventory/diff",
        headers=auth_headers,
        params={
            "warehouse_id": warehouse_id,
            "session_previous_id": s1,
            "session_current_id": s2,
        },
    )
    assert diff.status_code == 200
    rows = {r["item_id"]: r for r in diff.json()["rows"]}
    assert rows[item_a]["classification"] == "increased"
    assert rows[item_a]["delta_qty"] == 5.0
    assert rows[item_a]["delta_percent"] == 50.0
    assert rows[item_b_id]["classification"] == "new"
    assert rows[item_b_id]["delta_percent"] is None


def test_analytics_diff_disappeared_item(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_a = seed_zone_warehouse_item["item"].id
    item_b = client.post(
        "/items",
        headers=auth_headers,
        json={
            "name": "Analytics Disappear B",
            "unit": "pcs",
            "warehouse_id": warehouse_id,
            "step": 1,
        },
    )
    assert item_b.status_code == 200
    item_b_id = item_b.json()["id"]

    s1 = _close_session(client, auth_headers, warehouse_id, [(item_a, 1.0), (item_b_id, 4.0)])
    s2 = _close_session(client, auth_headers, warehouse_id, [(item_a, 2.0)])

    diff = client.get(
        "/analytics/inventory/diff",
        headers=auth_headers,
        params={
            "warehouse_id": warehouse_id,
            "session_previous_id": s1,
            "session_current_id": s2,
        },
    )
    assert diff.status_code == 200
    rows = {r["item_id"]: r for r in diff.json()["rows"]}
    assert rows[item_b_id]["classification"] == "disappeared"
    assert rows[item_b_id]["delta_qty"] == -4.0


def test_analytics_diff_unchanged_same_qty(
    client,
    auth_headers,
    seed_zone_warehouse_item,
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_a = seed_zone_warehouse_item["item"].id
    s1 = _close_session(client, auth_headers, warehouse_id, [(item_a, 1.0)])
    s2 = _close_session(client, auth_headers, warehouse_id, [(item_a, 1.0)])
    diff = client.get(
        "/analytics/inventory/diff",
        headers=auth_headers,
        params={
            "warehouse_id": warehouse_id,
            "session_previous_id": s1,
            "session_current_id": s2,
        },
    )
    assert diff.status_code == 200
    row = diff.json()["rows"][0]
    assert row["classification"] == "unchanged"
    assert row["delta_qty"] == 0.0
    assert row["delta_percent"] == 0.0


def test_analytics_diff_zero_to_zero_totals_delta_percent(
    client,
    auth_headers,
    seed_zone_warehouse_item,
    seed_admin_user,
    db_session,
):
    """Snapshots can hold qty 0 (not creatable via entry API); analytics must treat as unchanged."""
    from app.models.inventory_session import InventorySession
    from app.models.inventory_session_total import InventorySessionTotal

    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_a = seed_zone_warehouse_item["item"].id

    s1 = InventorySession(
        warehouse_id=warehouse_id,
        created_by_user_id=seed_admin_user.id,
        revision_no=10,
        status="closed",
        is_closed=True,
    )
    s2 = InventorySession(
        warehouse_id=warehouse_id,
        created_by_user_id=seed_admin_user.id,
        revision_no=11,
        status="closed",
        is_closed=True,
    )
    db_session.add_all([s1, s2])
    db_session.commit()
    db_session.refresh(s1)
    db_session.refresh(s2)

    db_session.add_all(
        [
            InventorySessionTotal(
                session_id=s1.id, item_id=item_a, qty_final=0.0, unit="l"
            ),
            InventorySessionTotal(
                session_id=s2.id, item_id=item_a, qty_final=0.0, unit="l"
            ),
        ]
    )
    db_session.commit()

    diff = client.get(
        "/analytics/inventory/diff",
        headers=auth_headers,
        params={
            "warehouse_id": warehouse_id,
            "session_previous_id": s1.id,
            "session_current_id": s2.id,
        },
    )
    assert diff.status_code == 200
    row = diff.json()["rows"][0]
    assert row["classification"] == "unchanged"
    assert row["delta_qty"] == 0.0
    assert row["delta_percent"] == 0.0


def test_analytics_pf_flag(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    pf = client.post(
        "/items",
        headers=auth_headers,
        json={
            "name": "Соус п/ф тест",
            "unit": "kg",
            "warehouse_id": warehouse_id,
            "step": 0.01,
        },
    )
    assert pf.status_code == 200
    pf_id = pf.json()["id"]
    s1 = _close_session(client, auth_headers, warehouse_id, [(pf_id, 1.0)])
    s2 = _close_session(client, auth_headers, warehouse_id, [(pf_id, 2.0)])
    diff = client.get(
        "/analytics/inventory/diff",
        headers=auth_headers,
        params={
            "warehouse_id": warehouse_id,
            "session_previous_id": s1,
            "session_current_id": s2,
            "only_pf": True,
        },
    )
    assert diff.status_code == 200
    assert len(diff.json()["rows"]) == 1
    assert diff.json()["rows"][0]["is_pf"] is True


def test_analytics_cook_forbidden(client, auth_headers_cook, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    r = client.get(
        "/analytics/inventory/summary",
        headers=auth_headers_cook,
        params={"warehouse_id": warehouse_id},
    )
    assert r.status_code == 403


def test_analytics_diff_rejects_wrong_revision_order(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_a = seed_zone_warehouse_item["item"].id
    s1 = _close_session(client, auth_headers, warehouse_id, [(item_a, 1.0)])
    s2 = _close_session(client, auth_headers, warehouse_id, [(item_a, 2.0)])
    bad = client.get(
        "/analytics/inventory/diff",
        headers=auth_headers,
        params={
            "warehouse_id": warehouse_id,
            "session_previous_id": s2,
            "session_current_id": s1,
        },
    )
    assert bad.status_code == 400


def test_analytics_trends_and_problem_items(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_a = seed_zone_warehouse_item["item"].id
    s1 = _close_session(client, auth_headers, warehouse_id, [(item_a, 1.0)])
    s2 = _close_session(client, auth_headers, warehouse_id, [(item_a, 3.0)])

    trends = client.get(
        "/analytics/inventory/trends",
        headers=auth_headers,
        params={"warehouse_id": warehouse_id},
    )
    assert trends.status_code == 200
    pts = trends.json()["sessions"]
    assert len(pts) >= 2

    prob = client.get(
        "/analytics/inventory/problem-items",
        headers=auth_headers,
        params={
            "warehouse_id": warehouse_id,
            "session_previous_id": s1,
            "session_current_id": s2,
        },
    )
    assert prob.status_code == 200
    assert len(prob.json()["top_abs_delta"]) >= 1
