@echo off
REM =====================================================================
REM  Promethius — ONE-CLICK UPDATE (robust)
REM  Pulls the latest code from GitHub (even if history was force-pushed),
REM  updates deps, rebuilds the UI, and restarts. Writes update-log.txt.
REM =====================================================================
setlocal enabledelayedexpansion
set "ROOT=%~dp0"
set "LOG=%ROOT%update-log.txt"
title Promethius Update
echo ============================================
echo   Updating Promethius...
echo ============================================
echo.
cd /d "%ROOT%"
echo Promethius update started %date% %time% > "%LOG%"

REM --- 0) Must be a real git clone -------------------------------------
if not exist ".git" (
    echo ERROR: This folder is not a git clone ^(no .git folder found^).
    echo You probably downloaded a ZIP instead of cloning. To enable updates,
    echo re-clone the repo next to this folder, e.g.:
    echo     git clone https://github.com/rocosfsintec-del/Promethius.git
    echo.
    echo ERROR: no .git folder >> "%LOG%"
    pause
    exit /b 1
)

echo [1/6] Repository:
git remote -v
git remote -v >> "%LOG%" 2>&1
echo.

REM --- 1) Contact GitHub (fetch only — surfaces the REAL error) --------
echo [2/6] Contacting GitHub...
git fetch --all --prune >> "%LOG%" 2>&1
if errorlevel 1 (
    echo.
    echo Could not fetch from GitHub. The REAL error is:
    echo --------------------------------------------------------
    type "%LOG%"
    echo --------------------------------------------------------
    echo.
    echo If this is an AUTHENTICATION error ^(a 403 / "Authentication failed" /
    echo "could not read Username"^), it is NOT a network problem. Fix it once:
    echo     git config --global credential.helper manager
    echo     git fetch
    echo ...then sign in to GitHub when the window pops up, and re-run this updater.
    echo.
    echo If it is a real network error, check your internet/VPN/firewall.
    pause
    exit /b 1
)

REM --- 2) Figure out the default branch (usually main) ----------------
echo [3/6] Determining default branch...
set "BRANCH=main"
git remote set-head origin -a >> "%LOG%" 2>&1
for /f "tokens=2 delims=/" %%b in ('git rev-parse --abbrev-ref origin/HEAD 2^>nul') do set "BRANCH=%%b"
echo    default branch: %BRANCH%
echo default branch: %BRANCH% >> "%LOG%"

REM --- 3) Hard-sync to GitHub (handles force-pushed / diverged history)-
echo [4/6] Applying latest code (syncing to origin/%BRANCH%)...
git reset --hard "origin/%BRANCH%" >> "%LOG%" 2>&1
if errorlevel 1 (
    echo Failed to apply update. See update-log.txt below:
    type "%LOG%"
    pause
    exit /b 1
)
REM remove tracked-file leftovers but KEEP ignored files like backend\.env
git clean -fd >> "%LOG%" 2>&1

echo.
echo [5/6] Updating dependencies and rebuilding UI...
cd /d "%ROOT%backend"
if exist "venv\Scripts\activate.bat" call venv\Scripts\activate.bat
pip install -q -r requirements.txt >> "%LOG%" 2>&1
cd /d "%ROOT%frontend"
call yarn install >> "%LOG%" 2>&1
call yarn build >> "%LOG%" 2>&1

echo.
echo [6/6] Restarting Promethius...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 2 >nul
wscript "%ROOT%promethius-hidden.vbs"

echo.
echo ============================================
echo   Update complete! Promethius is restarting.
echo   Open it and press Ctrl+Shift+R to refresh.
echo   ^(Full details saved to update-log.txt^)
echo ============================================
timeout /t 4 >nul
endlocal
