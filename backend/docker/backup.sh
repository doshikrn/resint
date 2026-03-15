#!/bin/sh
set -eu

: "${POSTGRES_HOST:=db}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_DB:=inventory}"
: "${POSTGRES_USER:=inventory}"
: "${POSTGRES_PASSWORD:=inventory}"
: "${BACKUP_DIR:=/backups}"
: "${BACKUP_RETENTION_DAYS:=30}"
: "${BACKUP_RETENTION_REVISION_DAYS:=90}"
: "${BACKUP_RETENTION_EMERGENCY_DAYS:=14}"

export PGPASSWORD="${POSTGRES_PASSWORD}"

mkdir -p "${BACKUP_DIR}"

DATE_STAMP="$(date -u +%Y-%m-%d)"
SQL_FILE="${BACKUP_DIR}/database_backup_${DATE_STAMP}.sql"
OUT_FILE="${SQL_FILE}.gz"

pg_dump \
  --host "${POSTGRES_HOST}" \
  --port "${POSTGRES_PORT}" \
  --username "${POSTGRES_USER}" \
  --format=plain \
  --no-owner \
  --no-privileges \
  "${POSTGRES_DB}" \
  | gzip -6 > "${OUT_FILE}"

# ── Retention: daily backups ──
find "${BACKUP_DIR}" -maxdepth 1 -type f -name "database_backup_*.sql"    -mtime +"${BACKUP_RETENTION_DAYS}" -print -delete
find "${BACKUP_DIR}" -maxdepth 1 -type f -name "database_backup_*.sql.gz" -mtime +"${BACKUP_RETENTION_DAYS}" -print -delete

# ── Retention: revision backups ──
find "${BACKUP_DIR}" -maxdepth 1 -type f -name "revision_backup_*.sql"    -mtime +"${BACKUP_RETENTION_REVISION_DAYS}" -print -delete
find "${BACKUP_DIR}" -maxdepth 1 -type f -name "revision_backup_*.sql.gz" -mtime +"${BACKUP_RETENTION_REVISION_DAYS}" -print -delete

# ── Retention: emergency/pre-restore backups ──
find "${BACKUP_DIR}" -maxdepth 1 -type f -name "backup_before_restore_*.sql"    -mtime +"${BACKUP_RETENTION_EMERGENCY_DAYS}" -print -delete
find "${BACKUP_DIR}" -maxdepth 1 -type f -name "backup_before_restore_*.sql.gz" -mtime +"${BACKUP_RETENTION_EMERGENCY_DAYS}" -print -delete

echo "backup_complete file=${OUT_FILE} retention_days=${BACKUP_RETENTION_DAYS}"