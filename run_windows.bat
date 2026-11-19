@echo off
cd /d "%~dp0"
if not exist .venv python -m venv .venv
call .venv\Scripts\activate
pip install -r requirements.txt
if not exist frontend\node_modules (
    pushd frontend
    npm install
    popd
)
where docker >nul 2>nul
if not errorlevel 1 (
    docker compose up -d postgres redis
    if errorlevel 1 exit /b 1
) else (
    echo Docker not found. Start PostgreSQL and Redis manually, then run alembic upgrade head.
)
.venv\Scripts\alembic.exe upgrade head
if errorlevel 1 exit /b 1
start "JobReach API" cmd /k ".venv\Scripts\activate && python -m uvicorn main:app --host 127.0.0.1 --port 8000"
start "JobReach Celery Worker" cmd /k ".venv\Scripts\activate && celery -A app.services.worker:celery_app worker --loglevel=info --concurrency=1 --queues jobreach"
start "JobReach Celery Beat" cmd /k ".venv\Scripts\activate && celery -A app.services.worker:celery_app beat --loglevel=info"
pushd frontend
npm run dev
popd
