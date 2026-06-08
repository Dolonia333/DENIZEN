# Provision + deploy Denizen NAS metrics agent (requires SYNO_SSH_PASSWORD)
param(
  [string]$SynoHost = "192.168.1.237",
  [string]$SynoUser = "admin"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$infraEnv = Join-Path $PSScriptRoot ".env"

if (Test-Path $infraEnv) {
  Get-Content -Path $infraEnv | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#') -or -not $line.Contains('=')) { return }
    $parts = $line -split '=', 2
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ($key -and [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($key, 'Process'))) {
      [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
  }
}

if (-not $env:SYNO_SSH_PASSWORD) {
  Write-Host "Set SYNO_SSH_PASSWORD in infra/.env or your shell:"
  Write-Host '  $env:SYNO_SSH_PASSWORD = "your-test-password"'
  exit 1
}

$env:SYNO_HOST = $SynoHost
$env:SYNO_USER = $SynoUser
$env:DENIZEN_URL = "http://127.0.0.1:8081"

Write-Host "==> Provisioning fleet agent credentials on Denizen host..."
py "$root\infra\provision-nas-agent.py"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Deploying headless agent to NAS..."
py "$root\infra\deploy-nas-agent.py"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Probing NAS agent + fleet metrics..."
py "$root\infra\probe-nas-agent.py"
exit $LASTEXITCODE
