# Grok ↔ Denizen autonomy

Wire **real Grok** (xAI Responses API) to the **pixel-office Grok NPC** via public MCP. xAI executes tools server-side; you watch results in [https://denizen.dolonia.cloud](https://denizen.dolonia.cloud).

## Prerequisites

| Item | How |
|------|-----|
| Public MCP | `https://denizen.dolonia.cloud/mcp/npc/grok` (tunnel live) |
| MCP bearer token | `py infra/mint-mcp-token-nas.py grok` → `.mcp-token.local.json` |
| xAI API key | `XAI_API_KEY` in `denizen/.env` or `infra/.env` |

Verify MCP only:

```bash
py infra/verify-mcp-preflight.py grok
# DENIZEN_MCP_BASE=https://denizen.dolonia.cloud py infra/verify-mcp-preflight.py grok
```

## One-shot autonomy (recommended first run)

```bash
# From repo root — loads token from .mcp-token.local.json
py infra/run-grok-autonomy.py
```

Custom goal:

```bash
py infra/run-grok-autonomy.py "Announce you're online, list_skills, run one research skill on 1921 GovCon pursuits, log_activity"
```

Dry-run (prints payload, no API call):

```bash
py infra/run-grok-autonomy.py --dry-run
```

## Sustained autonomy loop

Runs every 5 minutes, continues from `previous_response_id`:

```bash
py infra/run-grok-autonomy.py --loop --interval 300 --max 10
```

Restrict tools (optional):

```bash
py infra/run-grok-autonomy.py --tools announce_in_office,get_status,list_skills,run_skill,log_activity
```

## Manual wiring (Responses API)

```python
from openai import OpenAI
import os

client = OpenAI(api_key=os.environ["XAI_API_KEY"], base_url="https://api.x.ai/v1")

resp = client.responses.create(
    model="grok-4.3",
    input=[{
        "role": "user",
        "content": "Using MCP tools: announce in office, get_status, run one visible skill, log_activity.",
    }],
    tools=[{
        "type": "mcp",
        "server_url": "https://denizen.dolonia.cloud/mcp/npc/grok",
        "server_label": "denizen-grok",
        "authorization": f"Bearer {os.environ['DENIZEN_MCP_TOKEN']}",
    }],
)
print(resp)
```

## grok.com Connectors

- **Server URL:** `https://denizen.dolonia.cloud/mcp/npc/grok`
- **Auth:** Bearer + token from mint script or Connect AI UI

Good for chat demos; **Grok Build + MCP** is better for coding + office in one terminal — see [GROK_BUILD.md](GROK_BUILD.md).

## Cursor

```json
{
  "mcpServers": {
    "denizen-grok": {
      "url": "https://denizen.dolonia.cloud/mcp/npc/grok",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

## What you'll see in the office

| MCP tool | Office effect |
|----------|----------------|
| `announce_in_office` | Speech bubble on Grok |
| `run_skill` | Work feed / skill output |
| `assign_task` / `delegate_task` | Think loop wakes target NPC |
| `log_activity` | Activity log + work feed |
| `update_memory` | Persists to DB + MEMORY.md path |
| `get_market_quote` / `market_watch` | Market data (shared with Roki) |
| `place_equity_order` | Live Robinhood fill when host enables trading |

## Robinhood trading via Denizen MCP

Grok is a **market NPC**: `/mcp/npc/grok` lists the same market tools as Roki (`denizen-mcp-market-tools.js`).

1. Connect Robinhood OAuth on the Denizen host ([ROBINHOOD_LIVE.md](ROBINHOOD_LIVE.md)).
2. Set `ROBINHOOD_LIVE_TRADING=1` on the server (off by default).
3. Mint a Grok token with **Full** scope (includes `trade`) or add `trade` explicitly.
4. Call `review_equity_order`, then `place_equity_order` with `confirm: true`.

Without the env flag, place stays disabled; Grok can still quote, watch, and paper-suggest via `trade-suggest`.

Autonomy goal example:

```bash
py infra/run-grok-autonomy.py "Get a quote for AAPL, review a $25 market buy, place only if live trading is enabled and confirm=true, announce the result"
```

## Security

- `.mcp-token.local.json` is gitignored — never commit tokens.
- Rotate: mint new token, revoke old via `/api/mcp/tokens/revoke` or Connect AI.
- Token is scoped to **grok** only — cannot call Abby/Lucy privileged tools.
- Live trades need host `ROBINHOOD_LIVE_TRADING=1` **and** MCP `trade` scope **and** `confirm=true`.

## Code map

| File | Role |
|------|------|
| `denizen/scripts/grok-denizen-autonomy.js` | Autonomy runner |
| `infra/run-grok-autonomy.py` | Env loader + entrypoint |
| `infra/mint-mcp-token-nas.py` | Mint bearer token on NAS |
| `infra/verify-mcp-preflight.py` | initialize + tools/list gate |
| `src/denizen-npc-mcp-gateway.js` | MCP server implementation |

See also [NPC_MCP_GATEWAY.md](NPC_MCP_GATEWAY.md).
