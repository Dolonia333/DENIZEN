# Start Bouncer Kali investigation agent on dolonia (.232) for NAS proxy.
# The NAS delegates real security investigations (nmap/tshark/tcpdump) here.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Denizen = Join-Path $Root "denizen"
$Port = if ($env:BOUNCER_INVESTIGATION_PORT) { $env:BOUNCER_INVESTIGATION_PORT } else { "8890" }

# Shared token — MUST match the NAS's BOUNCER_INVESTIGATION_TOKEN or the NAS
# gets 401 on every investigation. Prefer the repo-local token file (gitignored,
# same value written into the NAS bundle .env) so both sides stay in sync.
$TokenFile = Join-Path $PSScriptRoot ".bouncer-token.local"
if (-not $env:BOUNCER_INVESTIGATION_TOKEN -and (Test-Path $TokenFile)) {
  $env:BOUNCER_INVESTIGATION_TOKEN = (Get-Content $TokenFile -Raw).Trim()
  Write-Host "Loaded shared BOUNCER_INVESTIGATION_TOKEN from $TokenFile" -ForegroundColor Green
}
if (-not $env:BOUNCER_INVESTIGATION_TOKEN) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $env:BOUNCER_INVESTIGATION_TOKEN = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','').Replace('/','').Substring(0,32)
  Write-Host "No shared token found — generated one. Save this to the NAS .env (BOUNCER_INVESTIGATION_TOKEN) or the NAS will get 401:" -ForegroundColor Yellow
  Write-Host $env:BOUNCER_INVESTIGATION_TOKEN
}

# Warm the blue-team toolchain so the first real investigation isn't slow / toolless.
Write-Host "Checking Kali WSL security tools (tshark/tcpdump/nmap)..." -ForegroundColor Cyan
try {
  wsl -d kali-linux bash -c "which tshark tcpdump nmap 2>/dev/null; command -v tshark >/dev/null || (echo 'installing tshark...'; sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y tshark 2>&1 | tail -2; sudo -n setcap cap_net_raw,cap_net_admin=eip \$(which dumpcap) 2>&1)"
} catch {
  Write-Host "WSL tool check skipped: $_" -ForegroundColor DarkYellow
}

Write-Host "Starting investigation agent on port $Port ..." -ForegroundColor Cyan
Set-Location $Denizen
node scripts/bouncer-investigation-agent.js
