# Register Bouncer Kali investigation agent to start at logon (dolonia .232).
# NAS sets BOUNCER_INVESTIGATION_URL=http://<PC_LAN_IP>:8890

$ErrorActionPreference = "Stop"

$TaskName = "DenizenBouncerInvestigationAgent"
$ScriptPath = Join-Path $PSScriptRoot "start-bouncer-investigation-agent.ps1"

if (-not (Test-Path $ScriptPath)) {
    Write-Error "Missing $ScriptPath"
    exit 1
}

$tokenFile = Join-Path $env:APPDATA "Denizen\bouncer-investigation-token.txt"
if (-not $env:BOUNCER_INVESTIGATION_TOKEN) {
    if (Test-Path $tokenFile) {
        $env:BOUNCER_INVESTIGATION_TOKEN = (Get-Content $tokenFile -Raw).Trim()
    } else {
        $bytes = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $env:BOUNCER_INVESTIGATION_TOKEN = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '').Replace('/', '').Substring(0, 32)
        New-Item -ItemType Directory -Force -Path (Split-Path $tokenFile) | Out-Null
        Set-Content -Path $tokenFile -Value $env:BOUNCER_INVESTIGATION_TOKEN -NoNewline
        Write-Host "Generated BOUNCER_INVESTIGATION_TOKEN (save to NAS .env):" -ForegroundColor Yellow
        Write-Host $env:BOUNCER_INVESTIGATION_TOKEN
    }
}
[Environment]::SetEnvironmentVariable("BOUNCER_INVESTIGATION_TOKEN", $env:BOUNCER_INVESTIGATION_TOKEN, "User")

$shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh.exe" } else { "powershell.exe" }
$action = New-ScheduledTaskAction -Execute $shell -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Registered scheduled task: $TaskName" -ForegroundColor Green

Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8890/api/health" -TimeoutSec 5
    Write-Host "Agent health: ok=$($health.ok) wsl=$($health.wsl)" -ForegroundColor Green
} catch {
    Write-Host "Agent not responding yet on :8890 - check Task Scheduler" -ForegroundColor Yellow
}
