#!/bin/sh
set -e

python /app/scripts/check_migration_safety.py

python -m alembic upgrade head

exec gunicorn app.main:app \
  -k uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --workers ${WEB_CONCURRENCY:-2} \
  --timeout ${GUNICORN_TIMEOUT:-60}
