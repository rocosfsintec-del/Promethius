@echo off
REM =====================================================================
REM  Promethius — ONE-CLICK UPDATE
REM  Double-click this (or the "Update Promethius" desktop icon) to:
REM    pull the latest code -> update deps -> rebuild UI -> restart.
REM  No manual PowerShell needed.
REM =====================================================================
setlocal
set "ROOT=%~dp0"
title Promethius Update
echo ============================================
echo   Updating Promethius...
echo ============================================
echo.

cd /d "%ROOT%"

echo [1/5] Fetching latest code...
git checkout -- . >nul 2>&1
git pull
if errorlevel 1 (
    echo.
    echo Could not pull updates ^(check your internet / GitHub sign-in^) and try again.
    pause
    exit /b 1
)

echo.
echo [2/5] Updating backend dependencies...
cd /d "%ROOT%backend"
call venv\Scripts\activate.bat
pip install -q -r requirements.txt

echo.
echo [3/5] Installing frontend packages...
cd /d "%ROOT%frontend"
call yarn install

echo.
echo [4/5] Building the app...
call yarn build

echo.
echo [5/5] Restarting Promethius...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 2 >nul
wscript "%ROOT%promethius-hidden.vbs"

echo.
echo ============================================
echo   Update complete! Promethius is restarting.
echo   Open it and press Ctrl+Shift+R to refresh.
echo ============================================
timeout /t 4 >nul
endlocal
