"""Auth, account lifecycle, and role-guard tests (complement test_auth_and_health)."""

from datetime import UTC, datetime

from app.core.security import hash_password
from app.models.user import User


def test_login_rejects_inactive_user(client, db_session, seed_zone_warehouse_item):
    wh = seed_zone_warehouse_item["warehouse"]
    u = User(
        username="inactive_x",
        password_hash=hash_password("secret12345"),
        role="cook",
        is_active=False,
        warehouse_id=wh.id,
        default_warehouse_id=wh.id,
    )
    db_session.add(u)
    db_session.commit()

    r = client.post("/auth/login", json={"username": "inactive_x", "password": "secret12345"})
    assert r.status_code == 403


def test_login_rejects_soft_deleted_user(client, db_session, seed_zone_warehouse_item):
    wh = seed_zone_warehouse_item["warehouse"]
    u = User(
        username="deleted_x",
        password_hash=hash_password("secret12345"),
        role="cook",
        is_active=True,
        warehouse_id=wh.id,
        default_warehouse_id=wh.id,
        deleted_at=datetime.now(UTC),
    )
    db_session.add(u)
    db_session.commit()

    r = client.post("/auth/login", json={"username": "deleted_x", "password": "secret12345"})
    assert r.status_code == 401


def test_jwt_rejected_after_user_soft_deleted(
    client, auth_headers, db_session, seed_zone_warehouse_item
):
    wh = seed_zone_warehouse_item["warehouse"]
    victim = User(
        username="victim_jwt",
        password_hash=hash_password("secret12345"),
        role="cook",
        is_active=True,
        warehouse_id=wh.id,
        default_warehouse_id=wh.id,
    )
    db_session.add(victim)
    db_session.commit()
    db_session.refresh(victim)

    login = client.post(
        "/auth/login",
        json={"username": "victim_jwt", "password": "secret12345"},
    )
    assert login.status_code == 200
    victim_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    ok = client.get("/auth/me", headers=victim_headers)
    assert ok.status_code == 200

    victim.deleted_at = datetime.now(UTC)
    db_session.add(victim)
    db_session.commit()

    blocked = client.get("/auth/me", headers=victim_headers)
    assert blocked.status_code == 401


def test_jwt_rejected_after_user_deactivated(
    client, auth_headers, db_session, seed_zone_warehouse_item
):
    wh = seed_zone_warehouse_item["warehouse"]
    victim = User(
        username="victim_off",
        password_hash=hash_password("secret12345"),
        role="cook",
        is_active=True,
        warehouse_id=wh.id,
        default_warehouse_id=wh.id,
    )
    db_session.add(victim)
    db_session.commit()

    login = client.post(
        "/auth/login",
        json={"username": "victim_off", "password": "secret12345"},
    )
    assert login.status_code == 200
    victim_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    victim.is_active = False
    db_session.add(victim)
    db_session.commit()

    assert client.get("/auth/me", headers=victim_headers).status_code == 401


def test_refresh_rejected_after_user_soft_deleted(
    client, auth_headers, db_session, seed_zone_warehouse_item
):
    wh = seed_zone_warehouse_item["warehouse"]
    victim = User(
        username="victim_refresh",
        password_hash=hash_password("secret12345"),
        role="cook",
        is_active=True,
        warehouse_id=wh.id,
        default_warehouse_id=wh.id,
    )
    db_session.add(victim)
    db_session.commit()

    tokens = client.post(
        "/auth/login",
        json={"username": "victim_refresh", "password": "secret12345"},
    ).json()

    victim.deleted_at = datetime.now(UTC)
    db_session.add(victim)
    db_session.commit()

    refresh = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refresh.status_code == 401


def test_password_change_requires_current_password(client, auth_headers):
    bad = client.post(
        "/users/me/password",
        headers=auth_headers,
        json={"current_password": "wrong", "new_password": "newpass9999"},
    )
    assert bad.status_code == 400

    ok = client.post(
        "/users/me/password",
        headers=auth_headers,
        json={"current_password": "password", "new_password": "newpass9999"},
    )
    assert ok.status_code == 204

    assert (
        client.post("/auth/login", json={"username": "testuser", "password": "password"}).status_code
        == 401
    )
    relogin = client.post(
        "/auth/login",
        json={"username": "testuser", "password": "newpass9999"},
    )
    assert relogin.status_code == 200


def test_refresh_token_still_valid_after_password_change_documents_risk(
    client, auth_headers, seed_admin_user
):
    """Password change does not revoke existing refresh tokens (product decision / risk)."""
    login = client.post("/auth/login", json={"username": "testuser", "password": "password"})
    refresh_token = login.json()["refresh_token"]

    ch = client.post(
        "/users/me/password",
        headers=auth_headers,
        json={"current_password": "password", "new_password": "rotatedpass1"},
    )
    assert ch.status_code == 204

    refresh = client.post("/auth/refresh", json={"refresh_token": refresh_token})
    assert refresh.status_code == 200


def test_cook_forbidden_user_list_and_create(client, auth_headers_cook):
    assert client.get("/users", headers=auth_headers_cook).status_code == 403
    assert (
        client.post(
            "/users",
            headers=auth_headers_cook,
            json={
                "username": "hacker",
                "password": "longenough1",
                "role": "cook",
            },
        ).status_code
        == 403
    )


def test_manager_can_create_user(client, auth_headers_manager, seed_zone_warehouse_item):
    wh_id = seed_zone_warehouse_item["warehouse"].id
    r = client.post(
        "/users",
        headers=auth_headers_manager,
        json={
            "username": "newcook1",
            "password": "longenough1",
            "role": "cook",
            "warehouse_id": wh_id,
        },
    )
    assert r.status_code == 201
    assert r.json()["username"] == "newcook1"
    assert r.json()["role"] == "cook"


def test_manager_reset_password_cook_forbidden(client, auth_headers_cook, seed_cook_user):
    assert (
        client.post(
            f"/users/{seed_cook_user.id}/reset-password",
            headers=auth_headers_cook,
            json={"password": "otherlong1"},
        ).status_code
        == 403
    )


def test_manager_reset_password_ok(client, auth_headers_manager, seed_cook_user):
    r = client.post(
        f"/users/{seed_cook_user.id}/reset-password",
        headers=auth_headers_manager,
        json={"password": "resetlongpass1"},
    )
    assert r.status_code == 204
    login = client.post(
        "/auth/login",
        json={"username": "cookuser", "password": "resetlongpass1"},
    )
    assert login.status_code == 200


def test_patch_me_ignores_role_field(client, auth_headers, db_session, seed_admin_user):
    """Role cannot be escalated via /users/me (payload has no role; extras ignored)."""
    before = seed_admin_user.role
    r = client.patch(
        "/users/me",
        headers=auth_headers,
        json={"full_name": "X", "role": "manager"},
    )
    assert r.status_code == 200
    row = db_session.query(User).filter(User.id == seed_admin_user.id).first()
    assert row is not None
    assert row.role == before


def test_admin_cannot_delete_self(client, auth_headers, seed_admin_user):
    r = client.delete(f"/users/{seed_admin_user.id}", headers=auth_headers)
    assert r.status_code == 409
