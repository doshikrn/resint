#!/bin/sh
set -e

# ── Step 1: Bootstrap DB (idempotent) ─────────────────────────────────────────
# On first deploy  : creates the full schema, stamps Alembic HEAD, creates admin.
# On re-deploy     : skips schema creation; ensures admin user exists.
python /app/scripts/init_db.py

# ── Step 2: Migration safety check ────────────────────────────────────────────
# Blocks only when there are PENDING destructive migrations that have not yet
# been applied to the database.  Already-applied migrations are ignored, so
# the guard will pass silently after a fresh first-deploy (all revisions are
# at HEAD) and after a re-deploy where destructive migrations were applied in
# a previous release.
python /app/scripts/check_migration_safety.py

# ── Step 3: Apply pending migrations ──────────────────────────────────────────
# No-op after a fresh init_db.py run (schema is already stamped at HEAD).
# On re-deploy: applies any new migrations added since the last release.
python -m alembic upgrade head

echo "[entrypoint] Initialisation complete. Starting server …"

exec gunicorn app.main:app \
  -k uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --workers ${WEB_CONCURRENCY:-2} \
  --timeout ${GUNICORN_TIMEOUT:-60}
