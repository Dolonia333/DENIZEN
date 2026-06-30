# Start Bouncer Kali investigation agent on dolonia (.232) for NAS proxy.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Denizen = Join-Path $Root "denizen"
$Port = if ($env:BOUNCER_INVESTIGATION_PORT) { $env:BOUNCER_INVESTIGATION_PORT } else { "8890" }

if (-not $env:BOUNCER_INVESTIGATION_TOKEN) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $env:BOUNCER_INVESTIGATION_TOKEN = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','').Replace('/','').Substring(0,32)
  Write-Host "Generated BOUNCER_INVESTIGATION_TOKEN (save to NAS .env):" -ForegroundColor Yellow
  Write-Host $env:BOUNCER_INVESTIGATION_TOKEN
}

Write-Host "Starting investigation agent on port $Port ..."
Set-Location $Denizen
node scripts/bouncer-investigation-agent.js
