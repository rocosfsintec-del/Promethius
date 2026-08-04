# =====================================================================
#  Promethius — ONE-TIME SETUP (run once, as Administrator)
#  Right-click PowerShell -> "Run as administrator", then:
#     cd C:\Users\rocos\Documents\promethius
#     .\install-promethius.ps1
#
#  After this you NEVER need to keep windows open or restart anything:
#   - The backend serves the whole app on http://localhost:8001
#   - It starts automatically (hidden) every time you log in
#   - A "Promethius" desktop icon opens it FULLSCREEN
# =====================================================================
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Promethius setup starting in $root" -ForegroundColor Cyan

# --- 1. Build the UI if it hasn't been built yet ---------------------
$buildIndex = Join-Path $root "frontend\build\index.html"
if (-not (Test-Path $buildIndex)) {
    Write-Host "Building the UI (first time only, a few minutes)..." -ForegroundColor Yellow
    Push-Location (Join-Path $root "frontend")
    & yarn install
    & yarn build
    Pop-Location
} else {
    Write-Host "UI build found." -ForegroundColor Green
}

# --- 2. Make sure passkeys work on the served port (8001) ------------
$envPath = Join-Path $root "backend\.env"
if (Test-Path $envPath) {
    $lines = Get-Content $envPath
    if ($lines -match '^WEBAUTHN_EXPECTED_ORIGIN=') {
        $lines = $lines -replace '^WEBAUTHN_EXPECTED_ORIGIN=.*', 'WEBAUTHN_EXPECTED_ORIGIN=http://localhost:8001'
    } else {
        $lines += 'WEBAUTHN_EXPECTED_ORIGIN=http://localhost:8001'
    }
    if (-not ($lines -match '^WEBAUTHN_RP_ID=')) { $lines += 'WEBAUTHN_RP_ID=localhost' }
    Set-Content -Path $envPath -Value $lines
    Write-Host "backend\.env passkey origin set to http://localhost:8001" -ForegroundColor Green
} else {
    Write-Host "WARNING: backend\.env not found — create it before running Promethius." -ForegroundColor Red
}

# --- 3. Start the backend automatically on logon (hidden) ------------
$vbs = Join-Path $root "promethius-hidden.vbs"
$action   = New-ScheduledTaskAction -Execute "wscript.exe" -Argument ('"' + $vbs + '"')
$trigger  = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "Promethius" -Action $action -Trigger $trigger -Settings $settings `
    -Description "Start the Promethius backend on logon" -Force | Out-Null
Write-Host "Boot task registered (starts hidden on every logon)." -ForegroundColor Green

# --- 4. Desktop icon that opens Promethius fullscreen ----------------
$desktop  = [Environment]::GetFolderPath("Desktop")
$lnkPath  = Join-Path $desktop "Promethius.lnk"
$ico      = Join-Path $root "promethius.ico"
$launcher = Join-Path $root "launch-promethius.bat"
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnkPath)
$sc.TargetPath = $launcher
$sc.WorkingDirectory = $root
$sc.WindowStyle = 7
$sc.Description = "Launch Promethius (fullscreen)"
if (Test-Path $ico) { $sc.IconLocation = $ico }
$sc.Save()
Write-Host "Desktop icon created." -ForegroundColor Green

# --- 4b. "Update Promethius" desktop icon (one-click updater) --------
$updLnk = Join-Path $desktop "Update Promethius.lnk"
$updBat = Join-Path $root "update-promethius.bat"
$sc2 = $ws.CreateShortcut($updLnk)
$sc2.TargetPath = $updBat
$sc2.WorkingDirectory = $root
$sc2.Description = "Pull the latest Promethius, rebuild, and restart"
if (Test-Path $ico) { $sc2.IconLocation = $ico }
$sc2.Save()
Write-Host "Update icon created." -ForegroundColor Green

# --- 5. Start it right now (hidden) so you don't have to reboot ------
Start-Process "wscript.exe" -ArgumentList ('"' + $vbs + '"')
Write-Host ""
Write-Host "DONE. Promethius is starting in the background." -ForegroundColor Cyan
Write-Host "Give it ~15 seconds, then double-click the Promethius icon on your Desktop." -ForegroundColor Cyan
Write-Host "From now on it runs on its own at http://localhost:8001 — no windows needed." -ForegroundColor Cyan
