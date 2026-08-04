# Removes the Promethius boot task and Desktop icon.
$ErrorActionPreference = "SilentlyContinue"
Unregister-ScheduledTask -TaskName "Promethius" -Confirm:$false
$desktop = [Environment]::GetFolderPath("Desktop")
Remove-Item (Join-Path $desktop "Promethius.lnk") -Force
Write-Host "Promethius startup task and Desktop icon removed."
