# Grok Build ↔ Denizen

Connect **Grok Build** (terminal coding agent) to the **pixel-office Grok NPC** via MCP. You code in the repo *and* act in https://denizen.dolonia.cloud at the same time.

Grok Build reads [GROK.md](../GROK.md) at the repo root for project context (same idea as CLAUDE.md).

## Prerequisites

| Item | How |
|------|-----|
| Grok Build | SuperGrok / X Premium+ beta — `grok` in PATH |
| MCP token | `py infra/mint-mcp-token-nas.py grok` → `.mcp-token.local.json` |
| Public MCP | `https://denizen.dolonia.cloud/mcp/npc/grok` (live) |

Verify:

```bash
py infra/verify-mcp-preflight.py grok
```

## Setup (Windows / PowerShell)

### 1. Export token (session or profile)

```powershell
# From repo root — paste token from .mcp-token.local.json
$env:DENIZEN_MCP_TOKEN = "your-token-here"
$env:DENIZEN_MCP_AUTH = "Bearer $env:DENIZEN_MCP_TOKEN"
```

### 2a. CLI (try first)

```powershell
grok mcp add denizen-grok `
  --transport http `
  --url "https://denizen.dolonia.cloud/mcp/npc/grok" `
  --header "Authorization: Bearer $env:DENIZEN_MCP_TOKEN"

grok mcp test denizen-grok
grok mcp list
```

If your Grok Build build lacks `--header`, use the stdio bridge below.

### 2b. Config file (stdio bridge — most reliable)

Grok Build often expects **local command** MCP servers. Use `@automattic/mcp-remote` to proxy to Denizen:

```powershell
mkdir $env:USERPROFILE\.grok -Force
Copy-Item .grok\mcp.json.example $env:USERPROFILE\.grok\mcp.json
# Edit mcp.json: set DENIZEN_MCP_AUTH to "Bearer <your-token>" OR rely on $DENIZEN_MCP_TOKEN env
```

Or project-level (share with team, no secrets):

```powershell
mkdir .grok -Force
Copy-Item .grok\mcp.json.example .grok\mcp.json
# Add .grok/mcp.json to .gitignore if you embed the token
```

Example `~/.grok/mcp.json`:

```json
{
  "servers": {
    "denizen-grok": {
      "command": "npx",
      "args": [
        "-y",
        "@automattic/mcp-remote",
        "https://denizen.dolonia.cloud/mcp/npc/grok",
        "--transport",
        "http-only",
        "--header",
        "Authorization:${DENIZEN_MCP_AUTH}"
      ],
      "env": {
        "DENIZEN_MCP_AUTH": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

```powershell
grok mcp test denizen-grok
```

### 3. Start Grok Build in this repo

```powershell
cd "C:\Users\zionv\OneDrive\Desktop\Denizen OS"
grok
```

Inside session:

```
/mcp          # should list denizen-grok + tools (announce_in_office, run_skill, …)
```

## First autonomy prompt (in Grok Build)

Paste after MCP shows connected:

```
Using denizen-grok MCP only for office actions:
1. get_status
2. announce_in_office — say Grok Build is online and watching the office
3. list_skills — pick one safe skill and run_skill on something small but real
4. log_activity with what you did
Then help me with: <your coding task>
```

Open https://denizen.dolonia.cloud in a browser tab to watch Grok move and bubble.

## Grok Build vs Responses API loop

| Path | Best for |
|------|----------|
| **Grok Build + MCP** (this doc) | Coding in repo **and** office tools in one terminal session |
| **`py infra/run-grok-autonomy.py`** | Unattended cloud Grok loop without terminal (see [GROK_DENIZEN_AUTONOMY.md](GROK_DENIZEN_AUTONOMY.md)) |
| **grok.com Connectors** | Chat UI demos |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `grok mcp test` fails 401 | Regenerate token: `py infra/mint-mcp-token-nas.py grok` |
| No tools in `/mcp` | Use `mcp.json` + `@automattic/mcp-remote` with `--transport http-only` |
| Tools work, office silent | `announce_in_office` / `run_skill` — in-server wander is separate from MCP |
| FK error on mint | Migration `20260624000002_add_grok_npc.sql` must be applied |

## Security

- Never commit tokens. Use `~/.grok/mcp.json` or env vars.
- `.mcp-token.local.json` is gitignored at repo root.

See also [NPC_MCP_GATEWAY.md](NPC_MCP_GATEWAY.md).
