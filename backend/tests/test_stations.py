def test_list_stations_with_filters(client, auth_headers):
    response1 = client.post(
        "/stations",
        headers=auth_headers,
        json={"name": "Kitchen Main", "department": "kitchen", "is_active": True, "sort_order": 1},
    )
    assert response1.status_code == 201

    response2 = client.post(
        "/stations",
        headers=auth_headers,
        json={"name": "Bar Pass", "department": "bar", "is_active": True, "sort_order": 2},
    )
    assert response2.status_code == 201

    response3 = client.post(
        "/stations",
        headers=auth_headers,
        json={"name": "Kitchen Backup", "department": "kitchen", "is_active": False},
    )
    assert response3.status_code == 201

    filtered = client.get("/stations?department=kitchen&is_active=true", headers=auth_headers)
    assert filtered.status_code == 200

    payload = filtered.json()
    assert len(payload) == 1
    assert payload[0]["name"] == "Kitchen Main"
    assert payload[0]["department"] == "kitchen"
    assert payload[0]["is_active"] is True


def test_create_station_requires_chef_or_admin(client, auth_headers_chef, auth_headers_souschef):
    forbidden = client.post(
        "/stations",
        headers=auth_headers_souschef,
        json={"name": "No Access", "department": "bar"},
    )
    assert forbidden.status_code == 403

    allowed = client.post(
        "/stations",
        headers=auth_headers_chef,
        json={"name": "Chef Station", "department": "kitchen", "sort_order": 10},
    )
    assert allowed.status_code == 201

    body = allowed.json()
    assert body["name"] == "Chef Station"
    assert body["department"] == "kitchen"
    assert body["sort_order"] == 10
    assert body["is_active"] is True
