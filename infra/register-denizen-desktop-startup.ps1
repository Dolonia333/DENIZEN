# Register Denizen Desktop to start at logon (City Power mesh on dolonia).
$ErrorActionPreference = "Stop"
$DenizenExe = "$env:LOCALAPPDATA\Programs\Denizen\Denizen.exe"
$TaskName = "DenizenDesktopMesh"
if (-not (Test-Path $DenizenExe)) {
  Write-Host "Denizen.exe not found - run activate-denizen-desktop-mesh.ps1 first" -ForegroundColor Yellow
  exit 1
}
$action = New-ScheduledTaskAction -Execute $DenizenExe
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Registered scheduled task: $TaskName -> $DenizenExe" -ForegroundColor Green
