import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
import time

from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from app.core.metrics import render_prometheus
from app.core.config import settings
from app.core.deps import get_current_user
from app.core.roles import USER_MANAGE_ROLES
from app.db.session import get_db
from app.models.enums import SessionStatus
from app.models.inventory_session import InventorySession
from app.models.user import User

log = logging.getLogger("app")

_app_start_time = datetime.now(timezone.utc)

router = APIRouter(tags=["health"])


def _expected_alembic_heads() -> set[str]:
    backend_root = Path(__file__).resolve().parents[2]
    alembic_ini = backend_root / "alembic.ini"
    config = Config(str(alembic_ini))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    return set(heads)


def _db_ping(db: Session, timeout_ms: int = 1000) -> int:
    start = time.perf_counter()
    try:
        if db.bind is not None and db.bind.dialect.name == "postgresql":
            db.execute(text(f"SET LOCAL statement_timeout = {int(timeout_ms)}"))
        db.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="database not ready") from exc
    return int((time.perf_counter() - start) * 1000)


def _migrations_ready(db: Session) -> bool:
    try:
        rows = db.execute(text("SELECT version_num FROM alembic_version")).fetchall()
    except SQLAlchemyError:
        return False

    db_heads = {str(row[0]) for row in rows if row and row[0]}
    expected_heads = _expected_alembic_heads()
    return bool(db_heads) and db_heads == expected_heads


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/live")
@router.get("/health/live")
def health_live():
    return {"status": "ok"}


@router.get("/health/ready")
@router.get("/ready")
def health_ready(db: Session = Depends(get_db)):
    from app.core.maintenance import is_maintenance_mode

    latency_ms = _db_ping(db)
    migrations_ok = _migrations_ready(db)
    maintenance = is_maintenance_mode()

    if not migrations_ok:
        raise HTTPException(status_code=503, detail="migrations not applied")

    status = "maintenance" if maintenance else "ready"
    status_code = 503 if maintenance else 200

    if maintenance:
        return Response(
            status_code=503,
            content='{"status":"maintenance","maintenance_mode":true}',
            media_type="application/json",
        )

    return {
        "status": status,
        "maintenance_mode": maintenance,
        "service_version": settings.service_version,
        "build_sha": settings.build_sha,
        "checks": {
            "db": "ok",
            "migrations": "ok",
        },
        "db_latency_ms": latency_ms,
    }


@router.get("/admin/system-status")
def system_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in USER_MANAGE_ROLES:
        raise HTTPException(status_code=403, detail="Manager role required")

    from app.core.maintenance import is_maintenance_mode

    now = datetime.now(timezone.utc)
    uptime_seconds = int((now - _app_start_time).total_seconds())

    # DB check
    try:
        db_latency = _db_ping(db)
        db_status = "ok"
    except Exception:
        db_latency = None
        db_status = "error"

    # Active revisions
    try:
        active_revisions = (
            db.query(func.count(InventorySession.id))
            .filter(
                InventorySession.status == SessionStatus.DRAFT,
                InventorySession.deleted_at.is_(None),
            )
            .scalar()
        ) or 0
    except Exception:
        active_revisions = None

    # Online users (seen in last 60s)
    try:
        cutoff = now - timedelta(seconds=60)
        online_users_count = (
            db.query(func.count(User.id))
            .filter(
                User.is_active.is_(True),
                User.deleted_at.is_(None),
                User.last_seen_at >= cutoff,
            )
            .scalar()
        ) or 0
    except Exception:
        online_users_count = None

    return {
        "status": "ok",
        "app_env": settings.app_env,
        "uptime_seconds": uptime_seconds,
        "started_at": _app_start_time.isoformat(),
        "service_version": settings.service_version,
        "build_sha": settings.build_sha,
        "maintenance_mode": is_maintenance_mode(),
        "db_status": db_status,
        "db_latency_ms": db_latency,
        "active_revisions": active_revisions,
        "online_users": online_users_count,
    }


@router.get("/metrics")
def metrics(
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in USER_MANAGE_ROLES:
        raise HTTPException(status_code=403, detail="Manager role required")
    return Response(
        content=render_prometheus(service_version=settings.service_version, build_sha=settings.build_sha),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )
