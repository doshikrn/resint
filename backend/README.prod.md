# Production runbook (Docker)

## 1) Prepare environment

1. Copy the template:

```powershell
Copy-Item .env.example .env
```

2. Set a strong `JWT_SECRET` in `.env`.
3. Set strict `CORS_ALLOW_ORIGINS` (comma-separated, no `*`).
4. Configure DB credentials:
	- `POSTGRES_USER`/`POSTGRES_PASSWORD` — admin user (used for init/ops)
	- `APP_DB_USER`/`APP_DB_PASSWORD` — app runtime user (non-superuser)
5. Put TLS certs into `docker/nginx/certs/`:
	- `fullchain.pem`
	- `privkey.pem`

## 2) Start services

From `backend/` run:

```powershell
docker compose -f docker-compose.prod.yml up -d --build
```

What happens on start:
- `db` starts and waits until healthy.
- `db` init script creates/updates `APP_DB_USER` with non-superuser privileges.
- `api` runs `alembic upgrade head` automatically.
- `api` starts with `gunicorn` + `uvicorn` worker on internal port `8000`.
- `proxy` terminates HTTPS (443) and forwards to `api`.
- `backup` runs `pg_dump` every `BACKUP_INTERVAL_SECONDS` (default daily) and keeps dumps for `BACKUP_RETENTION_DAYS`.

## 3) Verify

```powershell
docker compose -f docker-compose.prod.yml ps
Invoke-WebRequest https://localhost/health -UseBasicParsing
```

Expected health response:

```json
{"ok": true}
```

## 4) Logs

```powershell
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f db
docker compose -f docker-compose.prod.yml logs -f backup
```

## 5) Backup and retention

Backups are stored in Docker volume `pgbackups` as `*.dump` (custom pg_dump format).

Defaults:
- interval: `86400` seconds (daily)
- retention: `14` days

Override in `.env`:

```dotenv
BACKUP_INTERVAL_SECONDS=86400
BACKUP_RETENTION_DAYS=14
```

You can trigger a manual backup run:

```powershell
docker compose -f docker-compose.prod.yml exec backup /bin/sh /scripts/backup.sh
```

## 6) One-time restore check (mandatory)

Run once after enabling backups and repeat after major infrastructure changes:

```powershell
docker compose -f docker-compose.prod.yml --profile ops run --rm restore_check
```

Expected output contains `restore_check_ok`.

## 7) Migration safety policy

`api` startup runs migration safety guard before Alembic upgrade.
- CI also runs migration safety guard on every PR touching migrations via `.github/workflows/migration-guard.yml`.

- Dangerous migrations (`drop column/table/constraint`, raw SQL `DROP COLUMN`) are blocked by default.
- To run a reviewed dangerous migration, require explicit confirmation flags in `.env`:

```dotenv
MIGRATION_BACKUP_CONFIRMED=1
MIGRATION_RESTORE_CHECK_CONFIRMED=1
```

After migration completes, revert both values back to `0`.

## 8) Security checklist (minimal)

- CORS is strict via `CORS_ALLOW_ORIGINS` (explicit origins only).
- HTTPS is terminated at `proxy` (Nginx reverse proxy), API is not exposed directly.
- Secrets are loaded from environment variables only (`.env` is gitignored; do not commit real values).
- External errors never include stack traces (`EXPOSE_STACKTRACE=false` in production).
- API uses `APP_DB_USER` (non-superuser) instead of admin DB account.

## 9) Stop

```powershell
docker compose -f docker-compose.prod.yml down
```

## 10) Reset database (danger)

```powershell
docker compose -f docker-compose.prod.yml down -v
```

## 11) Inventory export contract

Inventory session export (`GET /inventory/sessions/{session_id}/export`) returns `csv`/`xlsx`
with the following entry columns in order:

1. `Zone`
2. `Warehouse`
3. `SessionId`
4. `SessionStatus`
5. `Item`
6. `Unit`
7. `Qty`
8. `Category`
9. `CountedOutsideZone`
10. `CountedByZone`
11. `UpdatedAt`
12. `UpdatedBy`

Notes:
- `CountedOutsideZone` is filled with `⚠ outside zone` only when `counted_outside_zone=true` for the entry.
- `CountedByZone` contains the zone name where counting happened for outside-zone entries; otherwise it is empty.

## 12) Outside-zone API fields

For inventory entry write operations:
- `POST /inventory/sessions/{session_id}/entries`
- `PATCH /inventory/sessions/{session_id}/entries/{item_id}`

Request fields:
- `counted_outside_zone: boolean` (default `false`)
- `outside_zone_note: string | null` (optional, max 500)

Behavior:
- If `counted_outside_zone=false`, backend stores `counted_by_zone_id=null` and `outside_zone_note=null`.
- If `counted_outside_zone=true`, backend resolves `counted_by_zone_id` from the session warehouse zone.

`InventoryEntryOut` response includes:
- `counted_outside_zone`
- `counted_by_zone_id`
- `counted_by_zone`
- `outside_zone_note`

`InventoryEntryEventOut` (audit endpoints) includes:
- `counted_outside_zone`
- `counted_by_zone_id`
- `outside_zone_note`

Example request:

```json
{
	"item_id": 42,
	"quantity": 3,
	"mode": "set",
	"counted_outside_zone": true,
	"outside_zone_note": "Moved from adjacent prep area"
}
```

Example response fragment:

```json
{
	"id": 101,
	"item_id": 42,
	"counted_outside_zone": true,
	"counted_by_zone_id": 7,
	"counted_by_zone": "Main Zone",
	"outside_zone_note": "Moved from adjacent prep area"
}
```

## 13) Bulk user creation (roles + stations)

Use CSV-driven upsert script to create/update accounts with role, department and default station:

```powershell
cd backend
.venv\Scripts\python.exe scripts\bulk_create_users.py --csv scripts\users_seed_template.csv --dry-run
```

When dry-run output looks correct, commit changes:

```powershell
cd backend
.venv\Scripts\python.exe scripts\bulk_create_users.py --csv path\to\users.csv
```

CSV columns (all required in header):
- `username`
- `full_name` (optional display name)
- `password` (required for new users, optional for existing users)
- `role` (`cook|souschef|chef|admin`)
- `station_name` (or `station_id`)
- `station_id` (or `station_name`)
- `department` (`kitchen|bar`, optional if it should be derived from station)
- `default_warehouse_id` (optional)
- `is_active` (`true|false`, defaults to `true`)
