#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Wire Grok Build to Denizen MCP (denizen-grok server via mcp-remote).

.DESCRIPTION
  Copies .grok/mcp.json.example to ~/.grok/mcp.json and injects bearer token
  from .mcp-token.local.json (repo root). Then runs grok mcp test if available.

.EXAMPLE
  pwsh infra/setup-grok-build-mcp.ps1
#>
$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent

$TokenFile = Join-Path $RepoRoot ".mcp-token.local.json"
$Example = Join-Path $RepoRoot ".grok\mcp.json.example"
$GrokDir = Join-Path $env:USERPROFILE ".grok"
$Target = Join-Path $GrokDir "mcp.json"

if (-not (Test-Path $TokenFile)) {
    Write-Host "Missing $TokenFile — run: py infra/mint-mcp-token-nas.py grok" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $Example)) {
    Write-Host "Missing $Example" -ForegroundColor Red
    exit 1
}

$tok = (Get-Content $TokenFile -Raw | ConvertFrom-Json).token
if (-not $tok) {
    Write-Host "No token in $TokenFile" -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force -Path $GrokDir | Out-Null
$cfg = Get-Content $Example -Raw | ConvertFrom-Json
$cfg.servers."denizen-grok".env.DENIZEN_MCP_AUTH = "Bearer $tok"
$cfg | ConvertTo-Json -Depth 6 | Set-Content $Target -Encoding utf8

Write-Host "Wrote $Target" -ForegroundColor Green
Write-Host "MCP URL: https://denizen.dolonia.cloud/mcp/npc/grok"
Write-Host ""
Write-Host "Next:"
Write-Host "  cd `"$RepoRoot`""
Write-Host "  grok"
Write-Host "  /mcp    # verify denizen-grok tools"
Write-Host ""
Write-Host "Office: https://denizen.dolonia.cloud"

if (Get-Command grok -ErrorAction SilentlyContinue) {
    Write-Host ""
    Write-Host "Running: grok mcp test denizen-grok"
    & grok mcp test denizen-grok
}
