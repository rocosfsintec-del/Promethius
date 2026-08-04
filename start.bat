@echo off
REM Promethius one-command launcher (Windows)
REM Boots MongoDB, the FastAPI backend, and the React frontend together.
setlocal
set "ROOT=%~dp0"
echo Starting Promethius...

REM 1) MongoDB (installed as a Windows service named "MongoDB")
echo - Starting MongoDB...
net start MongoDB >nul 2>&1

REM 2) Backend (http://localhost:8001)
echo - Starting backend...
cd /d "%ROOT%backend"
if not exist venv (
    python -m venv venv
)
call venv\Scripts\activate.bat
pip install -q -r requirements.txt
start "Promethius Backend" cmd /k uvicorn server:app --host 0.0.0.0 --port 8001 --reload

REM 3) Frontend (http://localhost:3000)
echo - Starting frontend...
cd /d "%ROOT%frontend"
if not exist node_modules (
    yarn install
)
start "Promethius Frontend" cmd /k yarn start

echo.
echo Promethius is starting.
echo   Backend:  http://localhost:8001
echo   Frontend: http://localhost:3000
echo Close the two opened windows to stop Promethius.
endlocal
