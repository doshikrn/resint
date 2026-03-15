import os
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("JWT_ALG", "HS256")
os.environ.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "120")

if os.getenv("RUN_POSTGRES_TESTS") != "1":
    os.environ["DATABASE_URL"] = "sqlite://"

from app.core.security import hash_password
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.item import Item
from app.models.user import User
from app.models.warehouse import Warehouse
from app.models.zone import Zone

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def reset_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture(autouse=True)
def reset_rate_limit_state():
    from app.core.rate_limit import reset_rate_limits_for_tests

    reset_rate_limits_for_tests()
    yield
    reset_rate_limits_for_tests()


@pytest.fixture
def client():
    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def db_session():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def auth_headers(client, seed_admin_user):
    login = client.post(
        "/auth/login",
        json={"username": "testuser", "password": "password"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def seed_admin_user():
    db = TestingSessionLocal()
    try:
        user = User(
            username="testuser",
            password_hash=hash_password("password"),
            role="admin",
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    finally:
        db.close()


@pytest.fixture
def seed_chef_user():
    db = TestingSessionLocal()
    try:
        user = User(
            username="chefuser",
            password_hash=hash_password("password"),
            role="chef",
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    finally:
        db.close()


@pytest.fixture
def seed_souschef_user():
    db = TestingSessionLocal()
    try:
        user = User(
            username="soususer",
            password_hash=hash_password("password"),
            role="souschef",
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    finally:
        db.close()


@pytest.fixture
def auth_headers_chef(client, seed_chef_user):
    login = client.post(
        "/auth/login",
        json={"username": "chefuser", "password": "password"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers_souschef(client, seed_souschef_user):
    login = client.post(
        "/auth/login",
        json={"username": "soususer", "password": "password"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def seed_cook_user():
    db = TestingSessionLocal()
    try:
        user = User(
            username="cookuser",
            password_hash=hash_password("password"),
            role="cook",
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    finally:
        db.close()


@pytest.fixture
def auth_headers_cook(client, seed_cook_user):
    login = client.post(
        "/auth/login",
        json={"username": "cookuser", "password": "password"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def seed_zone_warehouse_item():
    db = TestingSessionLocal()
    try:
        zone = Zone(name="Main Zone", description="Test zone")
        db.add(zone)
        db.flush()

        warehouse = Warehouse(name="Main Warehouse", zone_id=zone.id)
        db.add(warehouse)
        db.flush()

        db.query(User).update(
            {
                User.warehouse_id: warehouse.id,
                User.default_warehouse_id: warehouse.id,
            }
        )

        item = Item(
            product_code="00001", name="Milk", unit="l", is_active=True, warehouse_id=warehouse.id
        )
        db.add(item)
        db.commit()

        db.refresh(zone)
        db.refresh(warehouse)
        db.refresh(item)

        return {
            "zone": zone,
            "warehouse": warehouse,
            "item": item,
            "created_at": datetime.now(UTC),
        }
    finally:
        db.close()


@pytest.fixture
def seed_closed_session(seed_admin_user, seed_zone_warehouse_item):
    from app.models.inventory_session import InventorySession

    db = TestingSessionLocal()
    try:
        session = InventorySession(
            warehouse_id=seed_zone_warehouse_item["warehouse"].id,
            created_by_user_id=seed_admin_user.id,
            status="closed",
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return session
    finally:
        db.close()
