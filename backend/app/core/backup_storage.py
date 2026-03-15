"""Backup post-processing: gzip compression, sha256 checksum, optional S3 upload."""

import gzip
import hashlib
import logging
import os
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

log = logging.getLogger("app")

BACKUP_DIR = os.environ.get("BACKUP_DIR", "/backups")

# ── Retention defaults (days) ──────────────────────────────────
RETENTION_DAILY_DAYS = int(os.environ.get("BACKUP_RETENTION_DAYS", "30"))
RETENTION_REVISION_DAYS = int(os.environ.get("BACKUP_RETENTION_REVISION_DAYS", "90"))
RETENTION_EMERGENCY_DAYS = int(os.environ.get("BACKUP_RETENTION_EMERGENCY_DAYS", "14"))

# ── S3 config (all optional — disabled when BACKUP_S3_BUCKET is empty) ──
S3_BUCKET = os.environ.get("BACKUP_S3_BUCKET", "")
S3_PREFIX = os.environ.get("BACKUP_S3_PREFIX", "backups/")
S3_ENDPOINT_URL = os.environ.get("BACKUP_S3_ENDPOINT_URL", "")
S3_ACCESS_KEY = os.environ.get("BACKUP_S3_ACCESS_KEY", "")
S3_SECRET_KEY = os.environ.get("BACKUP_S3_SECRET_KEY", "")
S3_REGION = os.environ.get("BACKUP_S3_REGION", "us-east-1")


def is_s3_configured() -> bool:
    return bool(S3_BUCKET and S3_ACCESS_KEY and S3_SECRET_KEY)


def _get_s3_client():
    """Lazy-create boto3 S3 client. Returns None if boto3 is not installed."""
    try:
        import boto3
        from botocore.config import Config as BotoConfig
    except ImportError:
        log.warning("boto3 not installed — S3 upload disabled")
        return None

    kwargs = {
        "aws_access_key_id": S3_ACCESS_KEY,
        "aws_secret_access_key": S3_SECRET_KEY,
        "region_name": S3_REGION,
        "config": BotoConfig(connect_timeout=10, read_timeout=60, retries={"max_attempts": 2}),
    }
    if S3_ENDPOINT_URL:
        kwargs["endpoint_url"] = S3_ENDPOINT_URL
    return boto3.client("s3", **kwargs)


# ── SHA-256 checksum ───────────────────────────────────────────

def compute_checksum(filepath: str) -> str | None:
    """Compute SHA-256 of a file and write a .sha256 sidecar. Returns hex digest."""
    try:
        h = hashlib.sha256()
        with open(filepath, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        digest = h.hexdigest()
        sha_path = filepath + ".sha256"
        with open(sha_path, "w") as sf:
            sf.write(digest)
        log.info("Checksum written: %s  %s", digest[:12], os.path.basename(filepath))
        return digest
    except Exception as exc:
        log.error("Checksum computation failed for %s: %s", filepath, exc)
        return None


def read_checksum(filepath: str) -> str | None:
    """Read .sha256 sidecar file if it exists."""
    sha_path = filepath + ".sha256"
    try:
        if os.path.isfile(sha_path):
            return open(sha_path).read().strip()
    except OSError:
        pass
    return None


# ── Gzip ───────────────────────────────────────────────────────

def compress_backup(sql_path: str) -> str | None:
    """Gzip-compress an .sql file in-place. Returns .sql.gz path or None on error."""
    gz_path = sql_path + ".gz"
    try:
        with open(sql_path, "rb") as f_in, gzip.open(gz_path, "wb", compresslevel=6) as f_out:
            shutil.copyfileobj(f_in, f_out)
        os.remove(sql_path)
        log.info("Compressed backup: %s -> %s", os.path.basename(sql_path), os.path.basename(gz_path))
        return gz_path
    except Exception as exc:
        log.error("Failed to compress %s: %s", sql_path, exc)
        if os.path.isfile(gz_path):
            try:
                os.remove(gz_path)
            except OSError:
                pass
        return None


# ── S3 upload ──────────────────────────────────────────────────

def _s3_key_for(filepath: str) -> str:
    return S3_PREFIX.rstrip("/") + "/" + os.path.basename(filepath)


def upload_to_s3(filepath: str) -> bool:
    """Upload a local backup file to S3 and write .s3 status sidecar. Returns True on success."""
    if not is_s3_configured():
        return False

    client = _get_s3_client()
    if client is None:
        return False

    filename = os.path.basename(filepath)
    key = _s3_key_for(filepath)
    try:
        client.upload_file(filepath, S3_BUCKET, key)
        log.info("Uploaded backup to S3: s3://%s/%s", S3_BUCKET, key)
        _write_s3_status(filepath, key, None)
        return True
    except Exception as exc:
        log.error("S3 upload failed for %s: %s", filename, exc)
        _write_s3_status(filepath, None, str(exc))
        return False


def _write_s3_status(filepath: str, s3_key: str | None, error: str | None) -> None:
    """Write a .s3 sidecar JSON with upload status."""
    import json
    status_path = filepath + ".s3"
    data = {
        "uploaded": s3_key is not None,
        "s3_key": s3_key,
        "error": error,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    try:
        with open(status_path, "w") as f:
            json.dump(data, f)
    except OSError as exc:
        log.error("Failed to write S3 status sidecar: %s", exc)


def read_s3_status(filepath: str) -> dict | None:
    """Read .s3 sidecar file if it exists. Returns dict or None."""
    import json
    s3_path = filepath + ".s3"
    try:
        if os.path.isfile(s3_path):
            with open(s3_path) as f:
                return json.load(f)
    except (OSError, json.JSONDecodeError):
        pass
    return None


# ── Post-process (compress + upload) ───────────────────────────

def postprocess_backup(sql_path: str) -> str:
    """Compress, checksum, and optionally upload a backup file. Returns final local path."""
    final_path = sql_path
    gz_path = compress_backup(sql_path)
    if gz_path:
        final_path = gz_path

    compute_checksum(final_path)

    if is_s3_configured():
        upload_to_s3(final_path)

    return final_path


# ── S3 listing ─────────────────────────────────────────────────

def list_s3_objects() -> list[dict]:
    """List backup objects in S3. Returns list of dicts with name, size, last_modified, key."""
    if not is_s3_configured():
        return []
    client = _get_s3_client()
    if client is None:
        return []
    prefix = S3_PREFIX.rstrip("/") + "/"
    results: list[dict] = []
    try:
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                name = key.rsplit("/", 1)[-1]
                if not name:
                    continue
                results.append({
                    "name": name,
                    "size": obj["Size"],
                    "last_modified": obj["LastModified"],
                    "key": key,
                })
    except Exception as exc:
        log.error("Failed to list S3 objects: %s", exc)
    return results


# ── Retention cleanup ──────────────────────────────────────────

def cleanup_old_backups() -> dict[str, int]:
    """Remove old backup files based on per-type retention policy.

    Returns dict with counts of deleted files per category.
    """
    if not os.path.isdir(BACKUP_DIR):
        return {}

    now = datetime.now(timezone.utc)
    deleted: dict[str, int] = {"daily": 0, "revision": 0, "emergency": 0}

    cutoffs = {
        "daily": now - timedelta(days=RETENTION_DAILY_DAYS),
        "revision": now - timedelta(days=RETENTION_REVISION_DAYS),
        "emergency": now - timedelta(days=RETENTION_EMERGENCY_DAYS),
    }

    for entry in os.scandir(BACKUP_DIR):
        if not entry.is_file():
            continue
        name = entry.name

        # Skip sidecar files — they are cleaned up together with the main file
        if name.endswith(".sha256") or name.endswith(".s3"):
            continue

        # Determine category
        if name.startswith("database_backup_"):
            category = "daily"
        elif name.startswith("revision_backup_"):
            category = "revision"
        elif name.startswith("backup_before_restore_"):
            category = "emergency"
        else:
            continue

        mtime = datetime.fromtimestamp(entry.stat().st_mtime, tz=timezone.utc)
        if mtime < cutoffs[category]:
            try:
                os.remove(entry.path)
                # Also remove sidecar files
                for ext in (".sha256", ".s3"):
                    sidecar = entry.path + ext
                    if os.path.isfile(sidecar):
                        os.remove(sidecar)
                deleted[category] += 1
                log.info("Retention cleanup: deleted %s (age: %s)", name, now - mtime)
            except OSError as exc:
                log.error("Failed to delete old backup %s: %s", name, exc)

    # Also clean S3 if configured (list + delete old objects)
    if is_s3_configured() and any(v > 0 for v in deleted.values()):
        _cleanup_s3_old_backups(cutoffs)

    return deleted


def _cleanup_s3_old_backups(cutoffs: dict[str, datetime]) -> None:
    """Remove files from S3 that exceed retention. Best-effort."""
    client = _get_s3_client()
    if client is None:
        return

    prefix = S3_PREFIX.rstrip("/") + "/"
    try:
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                name = key.rsplit("/", 1)[-1]
                last_modified = obj["LastModified"]

                if name.startswith("database_backup_"):
                    cat = "daily"
                elif name.startswith("revision_backup_"):
                    cat = "revision"
                elif name.startswith("backup_before_restore_"):
                    cat = "emergency"
                else:
                    continue

                if last_modified < cutoffs[cat]:
                    client.delete_object(Bucket=S3_BUCKET, Key=key)
                    log.info("S3 retention cleanup: deleted %s", key)
    except Exception as exc:
        log.error("S3 retention cleanup failed: %s", exc)
