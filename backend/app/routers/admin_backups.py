"""Admin endpoints for backup management: list, download, restore."""

import logging
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.roles import USER_MANAGE_ROLES
from app.db.session import get_db
from app.models.user import User

router = APIRouter(prefix="/admin/backups", tags=["admin-backups"])

log = logging.getLogger("app")

BACKUP_DIR = os.environ.get("BACKUP_DIR", "/backups")
BACKUP_FILE_PATTERN = re.compile(
    r"^(database_backup_\d{4}-\d{2}-\d{2}(_\d{6})?"
    r"|backup_before_restore_\d{4}-\d{2}-\d{2}"
    r"|revision_backup_s\d+_r\d+_\d{4}-\d{2}-\d{2})"
    r"\.sql(\.gz)?$"
)
_REVISION_BACKUP_RE = re.compile(r"^revision_backup_s(\d+)_r(\d+)_")

from app.core.maintenance import is_maintenance_mode, set_maintenance_mode


def _require_manager(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in USER_MANAGE_ROLES:
        raise HTTPException(status_code=403, detail="Manager role required")
    return current_user


# ── Schemas ────────────────────────────────────────────────────

class BackupFileInfo(BaseModel):
    filename: str
    size_bytes: int
    created_at: str
    session_id: int | None = None
    revision_no: int | None = None
    checksum: str | None = None
    uploaded_to_s3: bool = False
    s3_key: str | None = None
    upload_error: str | None = None
    download_url: str | None = None


class RestoreRequest(BaseModel):
    file: str


class RestoreResponse(BaseModel):
    status: str
    emergency_backup: str | None = None
    restored_from: str
    tables_count: int | None = None


# ── Helpers ────────────────────────────────────────────────────

def _safe_filename(name: str) -> str:
    """Validate filename against allowed pattern to prevent path traversal."""
    base = os.path.basename(name)
    if not BACKUP_FILE_PATTERN.match(base):
        raise HTTPException(status_code=400, detail="Invalid backup filename")
    return base


def _cleanup_all_backups() -> dict[str, int]:
    """Run retention cleanup for all backup types."""
    from app.core.backup_storage import cleanup_old_backups
    return cleanup_old_backups()


def _list_backup_files() -> list[BackupFileInfo]:
    from app.core.backup_storage import (
        is_s3_configured, list_s3_objects, read_checksum, read_s3_status,
    )

    seen: dict[str, BackupFileInfo] = {}

    # 1. Scan local directory
    if os.path.isdir(BACKUP_DIR):
        for entry in os.scandir(BACKUP_DIR):
            if entry.is_file() and BACKUP_FILE_PATTERN.match(entry.name):
                stat = entry.stat()
                created = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
                session_id: int | None = None
                revision_no: int | None = None
                m = _REVISION_BACKUP_RE.match(entry.name)
                if m:
                    session_id = int(m.group(1))
                    revision_no = int(m.group(2))

                checksum = read_checksum(entry.path)

                s3_status = read_s3_status(entry.path)
                uploaded_to_s3 = False
                s3_key: str | None = None
                upload_error: str | None = None
                if s3_status:
                    uploaded_to_s3 = s3_status.get("uploaded", False)
                    s3_key = s3_status.get("s3_key")
                    upload_error = s3_status.get("error")

                seen[entry.name] = BackupFileInfo(
                    filename=entry.name,
                    size_bytes=stat.st_size,
                    created_at=created,
                    session_id=session_id,
                    revision_no=revision_no,
                    checksum=checksum,
                    uploaded_to_s3=uploaded_to_s3,
                    s3_key=s3_key,
                    upload_error=upload_error,
                    download_url=f"/admin/backups/download/{entry.name}",
                )

    # 2. Merge S3 objects (adds backups that exist only in S3)
    if is_s3_configured():
        try:
            for obj in list_s3_objects():
                name = obj["name"]
                if not BACKUP_FILE_PATTERN.match(name):
                    continue
                if name in seen:
                    # Already have local entry — just ensure S3 flag is set
                    if not seen[name].uploaded_to_s3:
                        seen[name].uploaded_to_s3 = True
                        seen[name].s3_key = obj["key"]
                    continue
                # S3-only backup
                session_id_s3: int | None = None
                revision_no_s3: int | None = None
                m2 = _REVISION_BACKUP_RE.match(name)
                if m2:
                    session_id_s3 = int(m2.group(1))
                    revision_no_s3 = int(m2.group(2))
                seen[name] = BackupFileInfo(
                    filename=name,
                    size_bytes=obj["size"],
                    created_at=obj["last_modified"].isoformat(),
                    session_id=session_id_s3,
                    revision_no=revision_no_s3,
                    uploaded_to_s3=True,
                    s3_key=obj["key"],
                )
        except Exception as exc:
            log.error("Failed to list S3 backups: %s", exc)

    results = list(seen.values())
    results.sort(key=lambda b: b.filename, reverse=True)
    return results


def _get_db_params() -> dict[str, str]:
    """Resolve DB connection params from DATABASE_URL or individual env vars."""
    db_url = os.environ.get("DATABASE_URL", "")
    if db_url:
        parsed = urlparse(db_url.replace("+psycopg", ""))
        return {
            "host": parsed.hostname or "127.0.0.1",
            "port": str(parsed.port or 5432),
            "user": parsed.username or "inventory",
            "password": parsed.password or "inventory",
            "dbname": parsed.path.lstrip("/") or "inventory",
        }
    return {
        "host": os.environ.get("POSTGRES_HOST", "db"),
        "port": os.environ.get("POSTGRES_PORT", "5432"),
        "user": os.environ.get("POSTGRES_USER", "inventory"),
        "password": os.environ.get("POSTGRES_PASSWORD", "inventory"),
        "dbname": os.environ.get("POSTGRES_DB", "inventory"),
    }


def _has_local_pg_dump() -> bool:
    return shutil.which("pg_dump") is not None


def _find_db_container() -> str | None:
    """Find a running Postgres container name for docker exec fallback."""
    try:
        result = subprocess.run(
            ["docker", "ps", "--filter", "ancestor=postgres:16",
             "--format", "{{.Names}}"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip().splitlines()[0]
    except Exception:
        pass
    return None


def _run_pg_dump(out_path: str) -> subprocess.CompletedProcess:
    """Run pg_dump locally or via docker exec. Returns CompletedProcess."""
    params = _get_db_params()
    log.info("pg_dump: resolving — host=%s port=%s dbname=%s",
             params["host"], params["port"], params["dbname"])

    if _has_local_pg_dump():
        env = {**os.environ, "PGPASSWORD": params["password"]}
        cmd = [
            "pg_dump",
            "--host", params["host"],
            "--port", params["port"],
            "--username", params["user"],
            "--format=plain", "--no-owner", "--no-privileges",
            "--file", out_path,
            params["dbname"],
        ]
        log.info("pg_dump: running locally -> %s", os.path.basename(out_path))
        return subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=120)

    container = _find_db_container()
    if not container:
        log.error("pg_dump: no local pg_dump and no running Postgres container")
        raise FileNotFoundError(
            "pg_dump not found on PATH and no running Postgres container detected"
        )

    log.info("pg_dump: via docker exec %s -> %s", container, os.path.basename(out_path))
    dump_cmd = (
        f"PGPASSWORD={params['password']} pg_dump "
        f"--host 127.0.0.1 --port 5432 "
        f"--username {params['user']} "
        f"--format=plain --no-owner --no-privileges "
        f"{params['dbname']}"
    )
    result = subprocess.run(
        ["docker", "exec", container, "bash", "-c", dump_cmd],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode == 0:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(result.stdout)
        log.info("pg_dump: wrote %d bytes to %s", len(result.stdout), out_path)
    else:
        log.error("pg_dump: docker exec failed rc=%s stderr=%s",
                  result.returncode, (result.stderr or "")[:500])
    return result


def create_revision_backup(session_id: int, revision_no: int) -> str | None:
    """Create a backup after successful revision close. Non-raising."""
    log.info("revision_backup: started session=%s revision=%s", session_id, revision_no)

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"revision_backup_s{session_id}_r{revision_no}_{stamp}.sql"
    out_path = os.path.join(BACKUP_DIR, filename)

    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
    except Exception:
        log.exception("revision_backup: cannot create BACKUP_DIR=%s", BACKUP_DIR)
        return None

    try:
        result = _run_pg_dump(out_path)
        if result.returncode != 0:
            log.error("revision_backup: pg_dump failed rc=%s stderr=%s",
                      result.returncode, (result.stderr or "")[:2000])
            return None
        fsize = os.path.getsize(out_path) if os.path.isfile(out_path) else 0
        log.info("revision_backup: dump created %s (%d bytes)", filename, fsize)
        if fsize == 0:
            log.error("revision_backup: dump file is empty")
            return None
    except Exception:
        log.exception("revision_backup: pg_dump exception session=%s", session_id)
        return None

    try:
        from app.core.backup_storage import postprocess_backup
        final_path = postprocess_backup(out_path)
        log.info("revision_backup: complete %s", os.path.basename(final_path))
        return os.path.basename(final_path)
    except Exception:
        log.exception("revision_backup: postprocess exception session=%s", session_id)
        return os.path.basename(out_path)


def _create_emergency_backup() -> str:
    """Create an emergency backup of the current database before restore."""
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"backup_before_restore_{stamp}.sql"
    out_path = os.path.join(BACKUP_DIR, filename)

    try:
        result = _run_pg_dump(out_path)
    except FileNotFoundError as exc:
        log.error("Emergency backup failed: %s", exc)
        raise HTTPException(status_code=500, detail="Emergency backup failed: pg_dump not available")
    if result.returncode != 0:
        log.error("Emergency backup failed: %s", result.stderr)
        raise HTTPException(status_code=500, detail="Emergency backup failed")

    log.info("Emergency backup created: %s", out_path)

    from app.core.backup_storage import compress_backup, compute_checksum
    gz_path = compress_backup(out_path)
    final_path = gz_path if gz_path else out_path
    compute_checksum(final_path)
    return os.path.basename(final_path)


def _upload_emergency_to_s3(filename: str) -> None:
    """Background task: upload emergency backup to S3."""
    from app.core.backup_storage import upload_to_s3
    filepath = os.path.join(BACKUP_DIR, filename)
    if os.path.isfile(filepath):
        upload_to_s3(filepath)


def _restore_from_file(filepath: str) -> int | None:
    """Restore database from SQL backup file. Returns count of public tables."""
    params = _get_db_params()
    host, port, user, password, db_name = (
        params["host"], params["port"], params["user"],
        params["password"], params["dbname"],
    )

    env = {**os.environ, "PGPASSWORD": password}
    psql_base = ["psql", "--host", host, "--port", port, "--username", user]

    # Terminate active connections
    subprocess.run(
        [*psql_base, "--dbname", "postgres", "--command",
         f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
         f"WHERE datname = '{db_name}' AND pid <> pg_backend_pid();"],
        capture_output=True, text=True, env=env, timeout=30,
    )

    # Drop database
    result = subprocess.run(
        [*psql_base, "--dbname", "postgres", "--command",
         f'DROP DATABASE IF EXISTS "{db_name}";'],
        capture_output=True, text=True, env=env, timeout=30,
    )
    if result.returncode != 0:
        log.error("Drop database failed: %s", result.stderr)
        raise HTTPException(status_code=500, detail="Failed to drop database")

    # Create database
    result = subprocess.run(
        [*psql_base, "--dbname", "postgres", "--command",
         f'CREATE DATABASE "{db_name}";'],
        capture_output=True, text=True, env=env, timeout=30,
    )
    if result.returncode != 0:
        log.error("Create database failed: %s", result.stderr)
        raise HTTPException(status_code=500, detail="Failed to create database")

    # Restore from file (support both .sql and .sql.gz)
    if filepath.endswith(".gz"):
        # Decompress on-the-fly: gunzip -c file.sql.gz | psql ...
        gunzip = subprocess.Popen(
            ["gunzip", "-c", filepath], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        result = subprocess.run(
            [*psql_base, "--dbname", db_name],
            stdin=gunzip.stdout, capture_output=True, text=True, env=env, timeout=300,
        )
        gunzip.wait()
    else:
        result = subprocess.run(
            [*psql_base, "--dbname", db_name, "--file", filepath],
            capture_output=True, text=True, env=env, timeout=300,
        )
    if result.returncode != 0:
        log.error("Restore failed: %s", result.stderr)
        raise HTTPException(status_code=500, detail="Database restore failed")

    # Count tables
    result = subprocess.run(
        [*psql_base, "--dbname", db_name, "--tuples-only", "--no-align", "--command",
         "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';"],
        capture_output=True, text=True, env=env, timeout=10,
    )
    tables_count = int(result.stdout.strip()) if result.returncode == 0 else None

    return tables_count


# ── Endpoints ──────────────────────────────────────────────────

@router.get("", response_model=list[BackupFileInfo])
def list_backups(
    current_user: User = Depends(_require_manager),
):
    """List available backup files."""
    return _list_backup_files()


@router.post("/create", response_model=BackupFileInfo)
def create_manual_backup(
    current_user: User = Depends(_require_manager),
):
    """Create a database backup manually."""
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
    filename = f"database_backup_{stamp}.sql"
    out_path = os.path.join(BACKUP_DIR, filename)

    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
    except Exception:
        log.exception("manual_backup: cannot create BACKUP_DIR=%s", BACKUP_DIR)
        raise HTTPException(status_code=500, detail="Cannot create backup directory")

    try:
        result = _run_pg_dump(out_path)
        if result.returncode != 0:
            log.error("manual_backup: pg_dump failed rc=%s stderr=%s",
                      result.returncode, (result.stderr or "")[:2000])
            raise HTTPException(status_code=500, detail="Database dump failed")
        fsize = os.path.getsize(out_path) if os.path.isfile(out_path) else 0
        if fsize == 0:
            raise HTTPException(status_code=500, detail="Database dump is empty")
    except HTTPException:
        raise
    except Exception:
        log.exception("manual_backup: pg_dump exception")
        raise HTTPException(status_code=500, detail="Database dump failed")

    try:
        from app.core.backup_storage import postprocess_backup
        final_path = postprocess_backup(out_path)
        filename = os.path.basename(final_path)
    except Exception:
        log.exception("manual_backup: postprocess exception")
        filename = os.path.basename(out_path)

    log.info("manual_backup: created %s by user=%s", filename, current_user.username)

    # Return the created backup info
    filepath = os.path.join(BACKUP_DIR, filename)
    stat = os.stat(filepath)
    from app.core.backup_storage import read_checksum, read_s3_status
    checksum = read_checksum(filepath)
    s3_status = read_s3_status(filepath)

    return BackupFileInfo(
        filename=filename,
        size_bytes=stat.st_size,
        created_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        checksum=checksum,
        uploaded_to_s3=bool(s3_status and s3_status.get("uploaded")),
        s3_key=s3_status.get("s3_key") if s3_status else None,
        upload_error=s3_status.get("error") if s3_status else None,
        download_url=f"/admin/backups/download/{filename}",
    )


@router.delete("/{filename}")
def delete_backup(
    filename: str,
    current_user: User = Depends(_require_manager),
):
    """Delete a backup file."""
    safe = _safe_filename(filename)
    filepath = os.path.join(BACKUP_DIR, safe)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Backup file not found")

    os.remove(filepath)
    # Clean up sidecar files (.sha256, .s3)
    for ext in (".sha256", ".s3"):
        sidecar = filepath + ext
        if os.path.isfile(sidecar):
            os.remove(sidecar)

    log.info("backup_deleted: %s by user=%s", safe, current_user.username)
    return {"status": "ok", "deleted": safe}


@router.get("/download/{filename}")
def download_backup(
    filename: str,
    current_user: User = Depends(_require_manager),
):
    """Download a backup file."""
    safe = _safe_filename(filename)
    filepath = os.path.join(BACKUP_DIR, safe)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Backup file not found")
    media = "application/gzip" if safe.endswith(".gz") else "application/sql"
    return FileResponse(
        path=filepath,
        filename=safe,
        media_type=media,
    )


@router.get("/status")
def backup_status(
    current_user: User = Depends(_require_manager),
):
    """Check maintenance mode status."""
    from app.core.backup_storage import is_s3_configured
    return {"maintenance_mode": is_maintenance_mode(), "s3_configured": is_s3_configured()}


@router.post("/cleanup")
def run_cleanup(
    current_user: User = Depends(_require_manager),
):
    """Manually trigger retention cleanup for all backup types."""
    deleted = _cleanup_all_backups()
    total = sum(deleted.values())
    log.info("Manual retention cleanup by user=%s: deleted=%s", current_user.username, deleted)
    return {"status": "ok", "deleted": deleted, "total": total}


@router.post("/restore", response_model=RestoreResponse)
def restore_backup(
    body: RestoreRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(_require_manager),
    db: Session = Depends(get_db),
):
    """Restore database from a backup file.

    1. Enable maintenance mode
    2. Create emergency backup of current DB
    3. Restore from selected backup
    4. Disable maintenance mode
    """
    safe = _safe_filename(body.file)
    filepath = os.path.join(BACKUP_DIR, safe)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Backup file not found")

    if is_maintenance_mode():
        raise HTTPException(status_code=409, detail="Restore already in progress")

    log.info("Restore initiated by user=%s from file=%s", current_user.username, safe)

    set_maintenance_mode(True)
    emergency_file: str | None = None
    try:
        # 1. Emergency backup
        emergency_file = _create_emergency_backup()

        # 2. Close current DB session to release connections
        db.close()

        # 3. Restore
        tables_count = _restore_from_file(filepath)

        log.info("Restore completed: file=%s tables=%s", safe, tables_count)

        # Schedule async S3 upload for the emergency backup
        if emergency_file:
            background_tasks.add_task(_upload_emergency_to_s3, emergency_file)

        return RestoreResponse(
            status="ok",
            emergency_backup=emergency_file,
            restored_from=safe,
            tables_count=tables_count,
        )
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("Restore failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Restore failed: {exc}")
    finally:
        set_maintenance_mode(False)
