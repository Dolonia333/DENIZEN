# Activate Denizen Desktop as a City Power mesh node on dolonia (.232).
# Run on the GPU PC after building: denizen/desktop/dist-build/Denizen-Setup.exe

param(
  [string]$Installer = "$PSScriptRoot\..\denizen\desktop\dist-build\Denizen-Setup.exe",
  [string]$ServerUrl = "http://192.168.1.237:8888",
  [string]$DenizenExe = "$env:LOCALAPPDATA\Programs\Denizen\Denizen.exe",
  [string]$SetupFile = "$env:APPDATA\Denizen\denizen-desktop-setup.json"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

if (-not (Test-Path $Installer)) {
  throw "Installer not found: $Installer`nRun: cd denizen/desktop && npm run build:win"
}

Write-Step "Silent install"
Start-Process -FilePath $Installer -ArgumentList "/S" -Wait

if (Test-Path $SetupFile) {
  Write-Step "Point desktop at $ServerUrl and ensure City Power opt-in"
  $setup = Get-Content $SetupFile -Raw | ConvertFrom-Json
  $setup.serverUrl = $ServerUrl
  $setup.optIn = $true
  if (-not $setup.capabilities) { $setup.capabilities = @{} }
  $setup.capabilities.contribute_compute = $true
  $setup | ConvertTo-Json -Depth 6 | Set-Content $SetupFile -Encoding UTF8
} else {
  Write-Host "No setup file yet - complete the wizard once, then re-run this script." -ForegroundColor Yellow
}

Write-Step "Launch Denizen Desktop"
if (-not (Test-Path $DenizenExe)) { throw "Denizen.exe not found at $DenizenExe" }
Start-Process $DenizenExe

Write-Step "Wait for mesh heartbeat (15s)"
Start-Sleep -Seconds 15

$healthUrl = "$ServerUrl/api/health"
try {
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 15
  $pool = $health.lmStudioPool.nodes
  $desktop = $pool | Where-Object { $_.role -eq "desktop" -or $_.node_id -like "desktop-*" }
  if ($desktop) {
    Write-Host "Mesh desktop node registered:" -ForegroundColor Green
    $desktop | Format-List node_id, label, role, heartbeat_at, rpc_capable, gpu_util
  } else {
    Write-Host "Desktop not in inference pool yet - keep Denizen running and check City Power tab." -ForegroundColor Yellow
    $pool | Format-Table node_id, role, reachable, heartbeat_at
  }
} catch {
  Write-Host "Health check failed: $_" -ForegroundColor Red
}

Write-Host "`nDone. Keep Denizen Desktop running for mesh jobs to claim." -ForegroundColor Green
