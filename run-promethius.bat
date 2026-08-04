@echo off
REM Starts the Promethius backend which ALSO serves the built UI on port 8001.
REM Logs everything to backend\promethius.log so hidden/boot failures are diagnosable.
setlocal
set "ROOT=%~dp0"
set "LOG=%ROOT%backend\promethius.log"

REM --- Self-heal: make sure both desktop icons exist (even if install-promethius.ps1 was never run). ---
powershell -NoProfile -Command "$ws=New-Object -ComObject WScript.Shell; $d=[Environment]::GetFolderPath('Desktop'); $ico=Join-Path '%ROOT%' 'promethius.ico'; $l=$ws.CreateShortcut((Join-Path $d 'Promethius.lnk')); $l.TargetPath=(Join-Path '%ROOT%' 'launch-promethius.bat'); $l.WorkingDirectory='%ROOT%'; $l.WindowStyle=7; $l.Description='Launch Promethius (fullscreen)'; if(Test-Path $ico){$l.IconLocation=$ico}; $l.Save(); $u=$ws.CreateShortcut((Join-Path $d 'Update Promethius.lnk')); $u.TargetPath=(Join-Path '%ROOT%' 'update-promethius.bat'); $u.WorkingDirectory='%ROOT%'; $u.Description='Pull the latest Promethius, rebuild, and restart'; if(Test-Path $ico){$u.IconLocation=$ico}; $u.Save()" >nul 2>&1

REM --- Is it already serving on 8001? If so, don't start a second copy. ---
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:8001/api/)|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if %errorlevel%==0 (
    echo Promethius is already running at http://localhost:8001
    goto end
)

REM --- Make sure MongoDB is up (installed as an auto-start service). ---
net start MongoDB >nul 2>&1

cd /d "%ROOT%backend"
if not exist "venv\Scripts\activate.bat" (
    echo [ERROR] Python venv missing. Run: python -m venv venv ^&^& venv\Scripts\pip install -r requirements.txt
    echo [ERROR] venv missing at %date% %time% >> "%LOG%"
    goto end
)
call venv\Scripts\activate.bat

echo ================ Promethius start %date% %time% ================ >> "%LOG%"
REM Bind to "localhost" (hostname) so it listens on BOTH IPv4 (127.0.0.1) and
REM IPv6 (::1) — Windows/Chrome resolve localhost to ::1 first, so 0.0.0.0 alone gets refused.
python -m uvicorn server:app --host localhost --port 8001 >> "%LOG%" 2>&1

:end
endlocal
