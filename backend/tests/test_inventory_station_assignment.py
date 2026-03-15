from app.models.station import Station, StationDepartment
from app.models.user import User


def test_create_entry_uses_explicit_station_id(client, auth_headers, seed_zone_warehouse_item):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_id = seed_zone_warehouse_item["item"].id

    station_resp = client.post(
        "/stations",
        headers=auth_headers,
        json={"name": "Kitchen Pass", "department": "kitchen", "is_active": True, "sort_order": 1},
    )
    assert station_resp.status_code == 201
    station_id = station_resp.json()["id"]

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 2, "mode": "set", "station_id": station_id},
    )
    assert add.status_code == 200
    body = add.json()
    assert body["station_id"] == station_id
    assert body["station_name"] == "Kitchen Pass"
    assert body["station_department"] == "kitchen"



def test_create_entry_uses_user_default_station_when_missing_in_payload(
    client,
    auth_headers,
    seed_zone_warehouse_item,
    db_session,
):
    warehouse_id = seed_zone_warehouse_item["warehouse"].id
    item_id = seed_zone_warehouse_item["item"].id

    station = Station(name="Bar Main", department=StationDepartment.bar, is_active=True, sort_order=2)
    db_session.add(station)
    db_session.commit()
    db_session.refresh(station)

    user = db_session.query(User).filter(User.username == "testuser").first()
    assert user is not None
    user.default_station_id = station.id
    db_session.add(user)
    db_session.commit()

    active = client.post(
        "/inventory/sessions/active",
        headers=auth_headers,
        json={"warehouse_id": warehouse_id},
    )
    assert active.status_code == 200
    session_id = active.json()["id"]

    add = client.post(
        f"/inventory/sessions/{session_id}/entries",
        headers=auth_headers,
        json={"item_id": item_id, "quantity": 1, "mode": "set"},
    )
    assert add.status_code == 200

    body = add.json()
    assert body["station_id"] == station.id
    assert body["station_name"] == "Bar Main"
    assert body["station_department"] == "bar"
