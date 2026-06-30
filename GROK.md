# Grok Build ↔ Denizen office

You are **Grok** in two places at once:

1. **This terminal** (Grok Build) — coding agent for the Denizen OS repo.
2. **The pixel office** at https://denizen.dolonia.cloud — NPC `Grok` via MCP tools.

## MCP: act in the office from here

When `denizen-grok` MCP is connected, use office tools for visible work:

| Tool | When to use |
|------|-------------|
| `announce_in_office` | Status humans should see (speech bubble) |
| `get_status` | Your NPC role, inference, recent work |
| `list_skills` | What you can run server-side |
| `run_skill` | Real work (research, coding-agent, CRM, etc.) |
| `assign_task` | Queue work for yourself |
| `delegate_task` | Hand off to Abby, Bob, Marcus, Alex, … |
| `log_activity` | Work feed after substantive steps |
| `update_memory` | Durable facts for next session |

**Rules:** Call MCP tools yourself. Prefer small verifiable steps. Announce before long work; log_activity after. Token is scoped to **grok** only.

## Company context (1921 template)

- Parent: **1921 Holding Co.** · OpCo: **DDT** (UEI/CAGE on file in `denizen/data/business-model.json`)
- Products: **DENIZEN** (this office), I.W.I.N., SmartContainer
- Marcus owns CRM / OMES pursuit context; Abby owns engineering; Bob owns research

## Repo map

| Path | What |
|------|------|
| `denizen/server.js` | Main server, WS, MCP routes |
| `denizen/src/denizen-npc-mcp-gateway.js` | MCP JSON-RPC + tools |
| `denizen/src/npc-brains.js` | In-server think loop |
| `denizen/npcs/grok/SOUL.md` | Your in-office identity |
| `infra/run-grok-autonomy.py` | Responses API autonomy (alternative to Grok Build MCP) |

## Good first prompt (after MCP connected)

```
Check denizen-grok get_status and list_skills. Announce in the office that Grok Build is connected.
Run one small visible skill, log_activity, then continue any coding task I give you in this repo.
```

Setup: `denizen/docs/GROK_BUILD.md`
