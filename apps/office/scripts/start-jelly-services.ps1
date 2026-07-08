# Start Jelly sidecar services (your tech — no OpenClaw required)
# Usage: .\denizen\scripts\start-jelly-services.ps1

$ErrorActionPreference = "Stop"
$denizen = Split-Path $PSScriptRoot -Parent
$svc = Join-Path $denizen "jelly\services"

Write-Host "[Jelly 🪼] Starting sidecar services..." -ForegroundColor Cyan

# Supabase secure bridge (:18790)
$bridge = Join-Path $svc "supabase-bridge\secure-bridge.py"
if (Test-Path $bridge) {
  Start-Process python -ArgumentList "`"$bridge`"" -WorkingDirectory (Split-Path $bridge) -WindowStyle Minimized
  Write-Host "  ✓ Supabase bridge → http://127.0.0.1:18790" -ForegroundColor Green
} else {
  Write-Host "  ✗ Supabase bridge not found at $bridge" -ForegroundColor Yellow
}

# BrowserClaw server (:18792)
$bcDir = Join-Path $svc "browserclaw"
$bcServer = Join-Path $bcDir "server.mjs"
if (Test-Path $bcServer) {
  if (-not (Test-Path (Join-Path $bcDir "node_modules"))) {
    Write-Host "  → Installing BrowserClaw deps (first run)..." -ForegroundColor Yellow
    Push-Location $bcDir; npm install --omit=dev; Pop-Location
  }
  Start-Process node -ArgumentList "`"$bcServer`"" -WorkingDirectory $bcDir -WindowStyle Minimized
  Write-Host "  ✓ BrowserClaw → http://127.0.0.1:18792" -ForegroundColor Green
} else {
  Write-Host "  ✗ BrowserClaw server not found at $bcServer" -ForegroundColor Yellow
}

Write-Host "[Jelly 🪼] Sidecars launched. Start Denizen: cd apps/office && npm start" -ForegroundColor Cyan
