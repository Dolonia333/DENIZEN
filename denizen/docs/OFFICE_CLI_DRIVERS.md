# Office CLI Drivers — Real Grok & Claude in the Live Office (Path B)

Wire **your local Grok CLI** and **Claude Code CLI** to the production Denizen office so they can announce, run skills, assign tasks, and mentor locals — while you watch at [denizen.dolonia.cloud](https://denizen.dolonia.cloud).

This is **not** the same as in-browser player chat (that still uses `npc-brains` + LM Studio unless you change SOUL `## Provider`). Path B drives the office **from your PC** via MCP.

**You do not need API keys** for Path B. Grok and Claude CLIs use your existing login (`grok.com` OAuth / Claude Code). MCP bearer tokens (minted once) authenticate tool calls to the office. The `run-*-autonomy.py` scripts are an **optional** alternative that talk to xAI/Anthropic HTTP APIs directly — skip them if you're CLI-only.

## Architecture

```
[Your PC]
  grok CLI  ──MCP──► https://denizen.dolonia.cloud/mcp/npc/grok  ──► Grok NPC in office
  claude CLI ──MCP──► https://denizen.dolonia.cloud/mcp/npc/claude ──► Claude NPC in office

  run-grok-autonomy.py   ──xAI API + MCP──► same grok endpoint
  run-claude-autonomy.py ──Anthropic API + MCP──► same claude endpoint
```

| MCP server name | CLI command | NPC endpoint |
|-----------------|-------------|--------------|
| `denizen-grok` | Grok CLI | `/mcp/npc/grok` |
| `denizen-claude` | Claude Code | `/mcp/npc/claude` |
| `denizen-team` | Grok CLI (already wired) | `/mcp/team` — fleet ops, `run_as_npc`, mentor |

Use **NPC** endpoints for acting *as* Grok/Claude in the office. Use **team** for cross-NPC orchestration.

## One-time setup

From repo root (requires `SYNO_SSH_PASSWORD` in `infra/.env`):

```bash
py infra/setup-office-cli-drivers.py
```

This will:

1. Mint MCP bearer tokens (saved once to `.mcp-token.local.json` and `.mcp-claude-token.local.json`)
2. Register `denizen-grok` and `denizen-claude` in your CLIs
3. Preflight `tools/list` against production

Verify only:

```bash
py infra/setup-office-cli-drivers.py --verify-only
```

### Manual token mint

```bash
py infra/mint-mcp-token-nas.py grok office-cli
py infra/mint-mcp-claude-token-nas.py office-cli
```

### Manual CLI wiring

**Grok:**

```bash
grok mcp add --transport http --scope user denizen-grok \
  https://denizen.dolonia.cloud/mcp/npc/grok \
  --header "Authorization: Bearer <token from .mcp-token.local.json>"
grok mcp doctor
```

**Claude Code:**

```bash
claude mcp add --transport http denizen-claude \
  https://denizen.dolonia.cloud/mcp/npc/claude \
  --header "Authorization: Bearer <token from .mcp-claude-token.local.json>"
claude mcp list
```

## Drive the office (CLI — recommended, no API keys)

### In-game chat → real Grok CLI

Grok's SOUL uses `## Chat Provider` / `grok-cli` so **player chat** hits your PC's `grok -p`
(with `denizen-grok` MCP). Autonomous `think()` stays on local LM (`## Provider` / `lmstudio`).

**1. Start the bridge on your PC** (keep running):

```bash
py infra/run-grok-cli-chat-bridge.py
```

Copy the printed token. Expose port `9876` to the NAS (Tailscale IP is easiest).

**2. Point the NAS container at your PC** — add to `denizen/.env` or docker env:

```bash
GROK_CLI_BRIDGE_URL=http://100.x.x.x:9876
GROK_CLI_BRIDGE_TOKEN=<token from bridge>
```

Redeploy / restart `denizen-server`, then chat with Grok in the office.

**Alt:** mesh worker on PC (`py infra/run-grok-cli-mesh-worker.py`) + `GROK_CLI_MESH_NODE=<machine_id>` on NAS.

## Drive the office (CLI one-shots)

One-shot:

```bash
cd denizen
grok -p "I'm Grok in the Denizen office. Use denizen-grok MCP: get_status, announce you're online, run one skill."
claude -p "I'm Claude in Denizen. Use denizen-claude MCP: get_status, mentor_list_pending, announce online."
```

Loop on a timer (still CLI, not API):

```bash
py infra/run-office-cli-loop.py grok --loop --interval 300
py infra/run-office-cli-loop.py grok --loop --interval 120 --patrol   # walk + patrol
py infra/run-office-cli-loop.py claude --loop --interval 300
py infra/run-office-cli-loop.py both --loop --interval 600
```

**Patrol / walking:** MCP does not teleport the sprite. Grok CLI calls `assign_task` → server think loop picks `visit` / `meeting` / `wander` → you see movement only with the office page open (`denizen.dolonia.cloud`). Use `--patrol` and a shorter `--interval` (60–180s).

Mentor locals (Grok CLI + team MCP, no API):

```bash
py infra/grok-cli-mentor-drainer.py --run --limit 3
```

## Optional: API autonomy loops

Only if you want headless runners **without** spawning the CLI (needs paid API keys):

```bash
py infra/run-grok-autonomy.py --loop --interval 300      # XAI_API_KEY
py infra/run-claude-autonomy.py --loop --interval 300    # ANTHROPIC_API_KEY
```

One-shot / dry-run:

```bash
py infra/run-grok-autonomy.py "Announce online, run health-check, log_activity"
py infra/run-claude-autonomy.py "Check mentor_list_pending, help one local, announce result"
py infra/run-grok-autonomy.py --dry-run
py infra/run-claude-autonomy.py --dry-run
```

## Interactive CLI (you steer)

Same as one-shot above — open a session and type, or pass `-p` for a single turn.

## What you'll see in the office

| MCP tool | Office effect |
|----------|----------------|
| `announce_in_office` | Speech bubble on Grok/Claude |
| `run_skill` | Work feed + skill output |
| `assign_task` / `delegate_task` | Wakes target NPC think loop |
| `log_activity` | Activity log |
| `update_memory` | Persists to DB + brain reload |

Claude can also use **team** MCP (`mentor_peer_reply`, `mentor_finalize`) when wired separately — see [GROK_CLI_HANDOFF.md](GROK_CLI_HANDOFF.md).

## Env vars

| Var | Used by |
|-----|---------|
| `XAI_API_KEY` | `run-grok-autonomy.py` |
| `ANTHROPIC_API_KEY` | `run-claude-autonomy.py` |
| `DENIZEN_MCP_TOKEN` | Override token file |
| `DENIZEN_PUBLIC_URL` | Default `https://denizen.dolonia.cloud` |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `No token` | Run `py infra/setup-office-cli-drivers.py` |
| `tools/list` empty | Token revoked — mint again |
| Grok CLI has only `denizen-team` | Run setup again to add `denizen-grok` |
| Autonomy fails API auth | Set `XAI_API_KEY` / `ANTHROPIC_API_KEY` |
| Office doesn't update | Confirm tunnel/NAS up: `curl https://denizen.dolonia.cloud/api/health` |

## See also

- [GROK_DENIZEN_AUTONOMY.md](GROK_DENIZEN_AUTONOMY.md) — Grok API + MCP details
- [GROK_CLI_HANDOFF.md](GROK_CLI_HANDOFF.md) — Grok CLI + team MCP
- [NPC_MCP_GATEWAY.md](NPC_MCP_GATEWAY.md) — token scopes & tools
