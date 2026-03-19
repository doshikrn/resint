from datetime import timedelta, timezone, datetime

from app.models.user import User


def test_online_users_returns_heartbeat_users_without_duplicates(
    client,
    auth_headers,
    auth_headers_souschef,
    seed_zone_warehouse_item,
):
    first = client.post("/users/heartbeat", headers=auth_headers)
    second = client.post("/users/heartbeat", headers=auth_headers_souschef)

    assert first.status_code == 204
    assert second.status_code == 204

    response = client.get("/users/online", headers=auth_headers)
    assert response.status_code == 200

    rows = response.json()
    usernames = [row["username"] for row in rows]
    assert usernames.count("testuser") == 1
    assert usernames.count("soususer") == 1


def test_online_users_excludes_presence_older_than_threshold(
    client,
    auth_headers,
    db_session,
    seed_admin_user,
    seed_zone_warehouse_item,
):
    seed_admin_user.last_seen_at = datetime.now(timezone.utc) - timedelta(seconds=180)
    db_session.add(seed_admin_user)
    db_session.commit()

    response = client.get("/users/online", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == []


def test_logout_clears_presence_immediately(
    client,
    db_session,
    seed_admin_user,
):
    login = client.post(
        "/auth/login",
        json={"username": "testuser", "password": "password"},
    )
    assert login.status_code == 200
    refresh_token = login.json()["refresh_token"]

    seed_admin_user.last_seen_at = datetime.now(timezone.utc)
    db_session.add(seed_admin_user)
    db_session.commit()

    logout = client.post("/auth/logout", json={"refresh_token": refresh_token})
    assert logout.status_code == 200

    db_session.refresh(seed_admin_user)
    assert seed_admin_user.last_seen_at is None