@echo off
REM Opens Promethius in a chromeless, FULLSCREEN browser window (feels like a native app).
REM Assumes the backend is already running (run-promethius.bat or the boot task).
setlocal
set "URL=http://localhost:8001"

REM --- Wait briefly for the backend to be reachable (handy right after boot) ---
set /a tries=0
:waitloop
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:8001/api/)|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if %errorlevel%==0 goto launch
set /a tries+=1
if %tries% geq 45 goto launch
timeout /t 1 >nul
goto waitloop

:launch
REM Prefer Google Chrome, then Microsoft Edge, in app + fullscreen mode.
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
    start "" "%CHROME%" --app=%URL% --start-fullscreen --new-window
    goto done
)
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
    start "" "%EDGE%" --app=%URL% --start-fullscreen --new-window
    goto done
)
start "" %URL%

:done
endlocal
