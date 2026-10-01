@echo off
REM =====================================================================
REM  Promethius — RESTORE LAST GOOD VERSION
REM  Resets to the commit the backend last started cleanly on, then
REM  rebuilds the UI and restarts. Safe to run even when the app is down.
REM =====================================================================

REM --- Self-relaunch from TEMP so 'git reset --hard' can safely overwrite
REM     this very file mid-run (otherwise cmd.exe re-reads it and corrupts). -
if "%~1"=="__inplace__" goto :__run
copy /y "%~f0" "%TEMP%\promethius-restore.bat" >nul 2>&1
"%TEMP%\promethius-restore.bat" __inplace__ "%~dp0"
exit /b
:__run
setlocal enabledelayedexpansion
set "ROOT=%~2"
set "LOG=%ROOT%restore-log.txt"
cd /d "%ROOT%"
echo Promethius restore started %date% %time% > "%LOG%"

set "GIT_TERMINAL_PROMPT=0"
set "GIT_SSH_COMMAND=ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"

echo ================================================
echo   Restoring Promethius to last good version...
echo ================================================

echo [1/4] Reading last-good commit...
set "COMMIT="
if exist "%ROOT%backend\.last_good_commit" set /p COMMIT=<"%ROOT%backend\.last_good_commit"
if "%COMMIT%"=="" (
  echo    No recorded good commit — aborting.
  echo no good commit >> "%LOG%"
  timeout /t 5 >nul
  endlocal
  exit
)
echo    target: %COMMIT%
echo target: %COMMIT% >> "%LOG%"

echo [2/4] Resetting code...
git reset --hard %COMMIT% >> "%LOG%" 2>&1

echo [3/4] Rebuilding UI...
cd /d "%ROOT%backend"
if exist "venv\Scripts\python.exe" (
    venv\Scripts\python.exe -m pip install -q -r requirements.txt >> "%LOG%" 2>&1
) else (
    pip install -q -r requirements.txt >> "%LOG%" 2>&1
)
cd /d "%ROOT%frontend"
call yarn install >> "%LOG%" 2>&1
call yarn build >> "%LOG%" 2>&1

echo [4/4] Restarting Promethius...
cd /d "%ROOT%"
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8001 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }" >> "%LOG%" 2>&1
timeout /t 2 >nul
if exist "%ROOT%promethius-hidden.vbs" wscript "%ROOT%promethius-hidden.vbs"

echo ================================================
echo   Restored to %COMMIT%. Reload http://localhost:8001
echo ================================================
timeout /t 4 >nul
endlocal
exit
