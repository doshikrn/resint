def test_create_warehouse_assigns_zone(client, auth_headers, seed_zone_warehouse_item):
    zone_id = seed_zone_warehouse_item["zone"].id

    response = client.post(
        "/warehouses",
        headers=auth_headers,
        json={"name": "Kitchen Warehouse", "zone_id": zone_id},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Kitchen Warehouse"
    assert payload["zone_id"] == zone_id


def test_create_warehouse_rejects_missing_zone(client, auth_headers):
    response = client.post(
        "/warehouses",
        headers=auth_headers,
        json={"name": "Broken Warehouse", "zone_id": 999999},
    )

    assert response.status_code == 404
    assert response.json()["error"]["message"] == "Zone not found"
