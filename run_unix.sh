#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then python3 -m venv .venv; fi
source .venv/bin/activate
pip install -r requirements.txt
if [ ! -d frontend/node_modules ]; then (cd frontend && npm install); fi
if command -v docker >/dev/null 2>&1; then
    docker compose up -d postgres redis
else
    echo "Docker not found. Start PostgreSQL and Redis manually, then run alembic upgrade head."
fi
alembic upgrade head
python -m uvicorn main:app --host 127.0.0.1 --port 8000 &
api_pid=$!
celery -A app.services.worker:celery_app worker --loglevel=info --concurrency=1 --queues jobreach &
worker_pid=$!
celery -A app.services.worker:celery_app beat --loglevel=info &
beat_pid=$!
trap 'kill "$api_pid" "$worker_pid" "$beat_pid" 2>/dev/null || true' EXIT
npm --prefix frontend run dev
