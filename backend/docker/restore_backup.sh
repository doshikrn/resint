#!/bin/sh
set -eu

: "${POSTGRES_HOST:=db}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_DB:=inventory}"
: "${POSTGRES_USER:=inventory}"
: "${POSTGRES_PASSWORD:=inventory}"

usage() {
  echo "Usage: $0 <backup_file.sql>"
  echo ""
  echo "Restores the database from a plain SQL backup file."
  echo "WARNING: This drops and recreates the target database."
  exit 1
}

BACKUP_FILE="${1:-}"

if [ -z "${BACKUP_FILE}" ]; then
  usage
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "restore_failed reason=file_not_found file=${BACKUP_FILE}"
  exit 1
fi

export PGPASSWORD="${POSTGRES_PASSWORD}"

echo "Terminating active connections to ${POSTGRES_DB}..."
psql \
  --host "${POSTGRES_HOST}" \
  --port "${POSTGRES_PORT}" \
  --username "${POSTGRES_USER}" \
  --dbname postgres \
  --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POSTGRES_DB}' AND pid <> pg_backend_pid();" \
  >/dev/null 2>&1 || true

echo "Dropping database ${POSTGRES_DB}..."
psql \
  --host "${POSTGRES_HOST}" \
  --port "${POSTGRES_PORT}" \
  --username "${POSTGRES_USER}" \
  --dbname postgres \
  --command "DROP DATABASE IF EXISTS \"${POSTGRES_DB}\";"

echo "Creating database ${POSTGRES_DB}..."
psql \
  --host "${POSTGRES_HOST}" \
  --port "${POSTGRES_PORT}" \
  --username "${POSTGRES_USER}" \
  --dbname postgres \
  --command "CREATE DATABASE \"${POSTGRES_DB}\";"

echo "Restoring from ${BACKUP_FILE}..."
psql \
  --host "${POSTGRES_HOST}" \
  --port "${POSTGRES_PORT}" \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --file "${BACKUP_FILE}"

TABLES_COUNT="$(psql \
  --host "${POSTGRES_HOST}" \
  --port "${POSTGRES_PORT}" \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --tuples-only \
  --no-align \
  --command "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")"

echo "restore_complete file=${BACKUP_FILE} database=${POSTGRES_DB} public_tables=${TABLES_COUNT}"
