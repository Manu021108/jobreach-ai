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
start "JobReach API" cmd /k ".venv\Scripts\activate && python -m uvicorn main:app --host 127.0.0.1 --port 8000"
pushd frontend
npm run dev
popd
