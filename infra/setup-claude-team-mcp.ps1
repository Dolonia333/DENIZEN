# Wire Claude Desktop / Cursor to Team MCP (fleet operator).
# Mint token first:  py infra/mint-mcp-team-token-nas.py
# Run telemetry job:  py infra/run-telemetry-sidecar-nas.py
# Prune audit:        py infra/audit-prunes.py
param(
  [string]$TokenFile = "$PSScriptRoot\..\.mcp-team-token.local.json",
  [string]$BaseUrl = "https://denizen.dolonia.cloud",
  [string]$ServerName = "denizen-team"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $TokenFile)) {
  Write-Host "Missing $TokenFile" -ForegroundColor Red
  Write-Host "Mint: py infra/mint-mcp-team-token-nas.py"
  exit 1
}

$data = Get-Content $TokenFile -Raw | ConvertFrom-Json
$tok = $data.token
if (-not $tok) { throw "No token in $TokenFile" }

$mcpUrl = if ($data.mcp_url) { $data.mcp_url } else { "$BaseUrl/mcp/team" }

# Claude Desktop (Windows)
$ClaudeDir = Join-Path $env:APPDATA "Claude"
$Target = Join-Path $ClaudeDir "claude_desktop_config.json"

New-Item -ItemType Directory -Force -Path $ClaudeDir | Out-Null
$cfg = @{ mcpServers = @{} }
if (Test-Path $Target) {
  try {
    $existing = Get-Content $Target -Raw | ConvertFrom-Json -AsHashtable
    if ($existing -and $existing.mcpServers) {
      $cfg = $existing
    }
  } catch {
    $cfg = @{ mcpServers = @{} }
  }
  if (-not $cfg.ContainsKey('mcpServers') -or -not $cfg.mcpServers) {
    $cfg = @{ mcpServers = @{} }
  }
}

$cfg.mcpServers[$ServerName] = @{
  url     = $mcpUrl
  headers = @{ Authorization = "Bearer $tok" }
}

$cfg | ConvertTo-Json -Depth 6 | Set-Content $Target -Encoding utf8

Write-Host "Wrote $Target" -ForegroundColor Green
Write-Host "  $ServerName -> $mcpUrl"
Write-Host ""
Write-Host "Team MCP resources (use in Claude after restart):"
Write-Host "  telemetry://fleet/latest              — full office telemetry"
Write-Host "  telemetry://fleet/latest/bouncer      — filtered NPC debug"
Write-Host "  team://roster | team://handoffs"
Write-Host ""
Write-Host "Tools: team_status, run_as_npc, broadcast_task, mesh + CRM via run_as_npc"
Write-Host "Mentor panel: mentor_list_pending, mentor_peer_reply (agent claude), mentor_finalize"
Write-Host ""
Write-Host "Grok + Claude mentor loop (local NPCs get smarter + more human):"
Write-Host "  1. Local NPC calls consult-mentors skill"
Write-Host "  2. You: mentor_list_pending -> read session -> mentor_peer_reply agent claude"
Write-Host "  3. Grok CLI posts agent grok reply; py infra/grok-claude-mentor-loop.py run finalizes"
Write-Host ""
Write-Host "Restart Claude Desktop, then ask:"
Write-Host '  "Check mentor://dialogue/pending — reply as Claude peer to help the local NPC sound human."'
Write-Host ""
Write-Host "Verify: py infra/verify-mcp-team.py"
