#!/bin/sh
set -eu

: "${POSTGRES_HOST:=db}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_USER:=inventory}"
: "${POSTGRES_PASSWORD:=inventory}"
: "${BACKUP_DIR:=/backups}"

export PGPASSWORD="${POSTGRES_PASSWORD}"

LATEST_DUMP="$(ls -1t "${BACKUP_DIR}"/database_backup_*.sql.gz 2>/dev/null | head -n 1 || true)"
if [ -z "${LATEST_DUMP}" ]; then
  echo "restore_check_failed reason=no_dump_found backup_dir=${BACKUP_DIR}"
  exit 1
fi

# Decompress for restore
SQL_FILE="${LATEST_DUMP%.gz}"
gunzip -k "${LATEST_DUMP}"
LATEST_DUMP="${SQL_FILE}"

TMP_DB="restore_check_$(date -u +%Y%m%d%H%M%S)"

cleanup() {
  psql \
    --host "${POSTGRES_HOST}" \
    --port "${POSTGRES_PORT}" \
    --username "${POSTGRES_USER}" \
    --dbname postgres \
    --command "DROP DATABASE IF EXISTS \"${TMP_DB}\";" >/dev/null 2>&1 || true
  rm -f "${SQL_FILE}" 2>/dev/null || true
}
trap cleanup EXIT

psql \
  --host "${POSTGRES_HOST}" \
  --port "${POSTGRES_PORT}" \
  --username "${POSTGRES_USER}" \
  --dbname postgres \
  --command "CREATE DATABASE \"${TMP_DB}\";"

psql \
  --host "${POSTGRES_HOST}" \
  --port "${POSTGRES_PORT}" \
  --username "${POSTGRES_USER}" \
  --dbname "${TMP_DB}" \
  --file "${LATEST_DUMP}"

TABLES_COUNT="$(psql \
  --host "${POSTGRES_HOST}" \
  --port "${POSTGRES_PORT}" \
  --username "${POSTGRES_USER}" \
  --dbname "${TMP_DB}" \
  --tuples-only \
  --no-align \
  --command "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")"

if [ "${TABLES_COUNT}" = "0" ]; then
  echo "restore_check_failed reason=no_public_tables dump=${LATEST_DUMP}"
  exit 1
fi

echo "restore_check_ok dump=${LATEST_DUMP} restored_db=${TMP_DB} public_tables=${TABLES_COUNT}"