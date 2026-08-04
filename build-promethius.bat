@echo off
REM Build the Promethius UI once so the backend can serve it (production mode).
REM Re-run this whenever you pull updates to the frontend.
setlocal
set "ROOT=%~dp0"
echo Building Promethius UI (this can take a few minutes)...
cd /d "%ROOT%frontend"
call yarn install
call yarn build
echo.
echo Build complete. The backend now serves the full app at http://localhost:8001
endlocal
