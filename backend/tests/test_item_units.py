def test_list_item_units_returns_catalog(client, auth_headers):
    response = client.get("/items/units", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == [
        {"code": "kg", "label": "кг"},
        {"code": "l", "label": "л"},
        {"code": "pcs", "label": "шт"},
        {"code": "pack", "label": "пач"},
        {"code": "bottle", "label": "бут"},
    ]


def test_list_item_units_requires_auth(client):
    response = client.get("/items/units")
    assert response.status_code in (401, 403)
