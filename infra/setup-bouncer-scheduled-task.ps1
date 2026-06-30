# Setup scheduled task for Bouncer Investigation Agent on .232 (dolonia)
# Run this on the .232 machine after placing the Denizen source.

$ErrorActionPreference = "Stop"

$taskName = "DenizenBouncerInvestigationAgent"

# Adjust this to where Denizen source lives on this machine
$denizenRoot = "C:\Denizen"  # CHANGE ME to actual path on .232, e.g. the OneDrive or C:\Users\... path
$scriptPath = Join-Path $denizenRoot "infra\start-bouncer-investigation-agent.ps1"

if (-not (Test-Path $scriptPath)) {
    Write-Error "Cannot find $scriptPath. Copy the Denizen OS tree to this machine or update `$denizenRoot."
    exit 1
}

# Ensure token is set (generate if needed, or set your own)
if (-not $env:BOUNCER_INVESTIGATION_TOKEN) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $env:BOUNCER_INVESTIGATION_TOKEN = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','').Replace('/','').Substring(0,32)
    Write-Host "Generated BOUNCER_INVESTIGATION_TOKEN. Add to .env on NAS and here:" -ForegroundColor Yellow
    Write-Host $env:BOUNCER_INVESTIGATION_TOKEN
    [Environment]::SetEnvironmentVariable("BOUNCER_INVESTIGATION_TOKEN", $env:BOUNCER_INVESTIGATION_TOKEN, "User")
}

$action = New-ScheduledTaskAction -Execute "pwsh.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force

Write-Host "Scheduled task '$taskName' registered. It will start the Bouncer agent on boot."

# Start it immediately
Start-ScheduledTask -TaskName $taskName
Write-Host "Task started. Check logs or netstat for :8890"
