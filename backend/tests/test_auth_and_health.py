from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text


def _head_revision() -> str:
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    script = ScriptDirectory.from_config(config)
    return script.get_current_head()


def test_login_success_and_failure(client, seed_admin_user):
    ok = client.post(
        "/auth/login",
        json={"username": "testuser", "password": "password"},
    )
    assert ok.status_code == 200
    payload = ok.json()
    assert payload["token_type"] == "bearer"
    assert payload["access_token"]
    assert payload["refresh_token"]

    bad = client.post(
        "/auth/login",
        json={"username": "testuser", "password": "wrong"},
    )
    assert bad.status_code == 401


def test_refresh_rotates_token_and_old_refresh_becomes_invalid(client, seed_admin_user):
    login = client.post(
        "/auth/login",
        json={"username": "testuser", "password": "password"},
    )
    assert login.status_code == 200
    first_tokens = login.json()

    refresh = client.post(
        "/auth/refresh",
        json={"refresh_token": first_tokens["refresh_token"]},
    )
    assert refresh.status_code == 200
    second_tokens = refresh.json()
    assert second_tokens["access_token"]
    assert second_tokens["refresh_token"]
    assert second_tokens["refresh_token"] != first_tokens["refresh_token"]

    reuse = client.post(
        "/auth/refresh",
        json={"refresh_token": first_tokens["refresh_token"]},
    )
    assert reuse.status_code == 401


def test_logout_revokes_refresh_token(client, seed_admin_user):
    login = client.post(
        "/auth/login",
        json={"username": "testuser", "password": "password"},
    )
    assert login.status_code == 200
    refresh_token = login.json()["refresh_token"]

    logout = client.post(
        "/auth/logout",
        json={"refresh_token": refresh_token},
    )
    assert logout.status_code == 200
    assert logout.json()["status"] == "ok"

    refresh_after_logout = client.post(
        "/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert refresh_after_logout.status_code == 401


def test_auth_me_returns_extended_user_fields(client, auth_headers):
    response = client.get("/auth/me", headers=auth_headers)
    assert response.status_code == 200

    payload = response.json()
    assert payload["username"] == "testuser"
    assert payload["role"] == "admin"
    assert payload["role_label"] == "Шеф-повар"
    assert "department" in payload
    assert "default_station_id" in payload
    assert "default_warehouse_id" in payload


def test_login_rate_limit_by_ip_and_username(client, seed_admin_user):
    for _ in range(5):
        bad = client.post(
            "/auth/login",
            json={"username": "testuser", "password": "wrong"},
        )
        assert bad.status_code == 401

    limited = client.post(
        "/auth/login",
        json={"username": "testuser", "password": "wrong"},
    )
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "AUTH_RATE_LIMIT_EXCEEDED"


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_live_endpoint(client):
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_ready_endpoint(client, db_session):
    db_session.execute(text("CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL)"))
    db_session.execute(text("DELETE FROM alembic_version"))
    db_session.execute(text("INSERT INTO alembic_version(version_num) VALUES (:v)"), {"v": _head_revision()})
    db_session.commit()

    response = client.get("/health/ready")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["service_version"]
    assert payload["build_sha"]
    assert payload["checks"]["db"] == "ok"
    assert payload["checks"]["migrations"] == "ok"
    assert isinstance(payload["db_latency_ms"], int)


def test_ready_alias_endpoint(client, db_session):
    db_session.execute(text("CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL)"))
    db_session.execute(text("DELETE FROM alembic_version"))
    db_session.execute(text("INSERT INTO alembic_version(version_num) VALUES (:v)"), {"v": _head_revision()})
    db_session.commit()

    response = client.get("/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"


def test_metrics_endpoint(client, auth_headers):
    _ = client.get("/health")
    response = client.get("/metrics", headers=auth_headers)
    assert response.status_code == 200
    assert "text/plain" in response.headers["content-type"]
    body = response.text
    assert "app_build_info" in body
    assert "app_http_requests_total" in body
    assert "app_http_errors_total" in body
    assert "app_http_request_duration_ms_sum" in body
