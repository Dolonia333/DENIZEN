# Wire Cursor MCP to Denizen (per-NPC or team). Mirrors setup-grok-build-mcp.ps1.
param(
  [string]$NpcKey = "grok",
  [switch]$Team,
  [string]$TokenFile = "",
  [string]$BaseUrl = "https://denizen.dolonia.cloud"
)

$ErrorActionPreference = "Stop"
$CursorDir = Join-Path $env:USERPROFILE ".cursor"
$Target = Join-Path $CursorDir "mcp.json"

if (-not $TokenFile) {
  $TokenFile = if ($Team) {
    Join-Path $PSScriptRoot "..\.mcp-team-token.local.json"
  } else {
    Join-Path $PSScriptRoot "..\.mcp-token.local.json"
  }
}

if (-not (Test-Path $TokenFile)) {
  Write-Host "Missing $TokenFile" -ForegroundColor Red
  if ($Team) {
    Write-Host "Mint: py infra/mint-mcp-team-token-nas.py"
  } else {
    Write-Host "Mint: py infra/mint-mcp-token-nas.py $NpcKey"
  }
  exit 1
}

$data = Get-Content $TokenFile -Raw | ConvertFrom-Json
$tok = $data.token
if (-not $tok) { throw "No token in $TokenFile" }

$mcpUrl = if ($Team) { "$BaseUrl/mcp/team" } else { "$BaseUrl/mcp/npc/$NpcKey" }
$serverName = if ($Team) { "denizen-team" } else { "denizen-$NpcKey" }

$entry = @{
  url = $mcpUrl
  headers = @{ Authorization = "Bearer $tok" }
}

New-Item -ItemType Directory -Force -Path $CursorDir | Out-Null
$servers = @{}
if (Test-Path $Target) {
  try {
    $existing = Get-Content $Target -Raw | ConvertFrom-Json
    if ($existing.mcpServers) {
      foreach ($prop in $existing.mcpServers.PSObject.Properties) {
        $servers[$prop.Name] = @{
          url = $prop.Value.url
          headers = @{ Authorization = $prop.Value.headers.Authorization }
        }
      }
    }
  } catch { }
}
$servers[$serverName] = $entry
$cfg = @{ mcpServers = $servers }
$cfg | ConvertTo-Json -Depth 6 | Set-Content $Target -Encoding utf8

Write-Host "Wrote $Target" -ForegroundColor Green
Write-Host "  $serverName -> $mcpUrl"
Write-Host ""
Write-Host "Cursor: Settings -> MCP -> confirm $serverName is listed"
Write-Host "OAuth alt (no token): paste $mcpUrl only and authorize in browser"
