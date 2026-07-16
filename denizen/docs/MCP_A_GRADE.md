# MCP / BYO-AI — A-grade ops (P3.2)

Connect Cursor, Claude, or any MCP client to Denizen’s per-NPC and team gateways. This doc covers **how to connect**, **health fields**, and **common 401 fixes**. No secrets belong in configs checked into git.

Full gateway reference: [NPC_MCP_GATEWAY.md](./NPC_MCP_GATEWAY.md). Grok-specific: [GROK_BUILD.md](./GROK_BUILD.md).

---

## Connect Cursor

1. In the Denizen office UI open **Connect AI** (or Settings → MCP).
2. Claim / select an NPC (e.g. `roki`, `grok`) on a **team** session.
3. Create a token: UI **Create token** or `POST /api/mcp/tokens` (visitor session). Plaintext is shown **once**.
4. Cursor → **Settings → MCP** → add a server:

```json
{
  "mcpServers": {
    "denizen-roki": {
      "url": "https://denizen.dolonia.cloud/mcp/npc/roki",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

5. Or use stdio proxy (`npx -y @automattic/mcp-remote …`) if your Cursor build expects a local command.
6. Confirm tools appear (`get_status`, `list_skills`, …).

**Team operator** (whole office): mint via `POST /api/mcp/team-tokens`, URL `https://<host>/mcp/team`.

---

## Connect Claude (Desktop / Claude.ai)

### Claude Desktop (config file)

Edit Claude MCP config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "denizen": {
      "command": "npx",
      "args": [
        "-y",
        "@automattic/mcp-remote",
        "https://denizen.dolonia.cloud/mcp/npc/YOUR_NPC",
        "--transport",
        "http-only",
        "--header",
        "Authorization:Bearer YOUR_TOKEN_HERE"
      ]
    }
  }
}
```

### Claude.ai (OAuth / connector)

1. Host must set a non-local **`DENIZEN_PUBLIC_URL`** (e.g. `https://denizen.dolonia.cloud`).
2. Office **Connect AI → Claude.ai** tab → copy connector URL.
3. Claude.ai → Settings → Integrations → add MCP connector.
4. OAuth discovery paths (automatic when public URL is set):
   - `/.well-known/oauth-protected-resource`
   - `/.well-known/oauth-authorization-server`
   - `/mcp/oauth/authorize`, `/mcp/oauth/token`, `/mcp/oauth/register`

If OAuth is unavailable, use the bearer-token path above (same as Cursor).

---

## Health fields

### `GET /api/health` → `mcp`

Built by `src/denizen-mcp-health.js` → `summarizeMcpSurface()`. Safe for public polling — **never** includes tokens or auth header values.

| Field | Type | Meaning |
|-------|------|---------|
| `npcGateway` | bool | Per-NPC gateway module loaded (`/mcp/npc/:npcKey`) |
| `teamGateway` | bool | Team gateway module loaded (`/mcp/team`) |
| `oauthConfigured` | bool | OAuth module present **and** non-local public base URL |
| `paths` | object | Canonical HTTP path shapes (npc, team, oauth, tokens, …) |
| `scopesCount` | number | Count of `ALL_SCOPES` (read, skills, crm_write, …) |
| `serversFromFile` | object | `data/mcp-servers.json` presence, counts, ids (no secrets) |
| `env.publicUrlConfigured` | bool | `DENIZEN_PUBLIC_URL` / `DENIZEN_URL` non-local |
| `env.publicBaseHint` | string\|null | Hostname only (or `localhost`) |
| `env.mcpTokenEnvPresent` | bool | `DENIZEN_MCP_TOKEN` or `DENIZEN_MCP_AUTH` set in process |
| `env.mcpUrlEnvPresent` | bool | `DENIZEN_MCP_URL` set |
| `env.rateLimit` | number\|null | `DENIZEN_MCP_RATE_LIMIT` if numeric |
| `notes` | string[] | Soft diagnostics (see below) |

### `GET /api/harness` / `/api/harness/status` → `mcp`

Same optional object. `null` only if the health module fails to load.

### Example shape

```json
{
  "npcGateway": true,
  "teamGateway": true,
  "oauthConfigured": true,
  "paths": {
    "npc": "/mcp/npc/:npcKey",
    "team": "/mcp/team",
    "oauthAuthorize": "/mcp/oauth/authorize",
    "tokens": "/api/mcp/tokens",
    "teamTokens": "/api/mcp/team-tokens",
    "connectInfo": "/api/mcp/connect-info"
  },
  "scopesCount": 6,
  "serversFromFile": {
    "present": true,
    "path": "data/mcp-servers.json",
    "count": 1,
    "enabled": 0,
    "ids": ["supabase-bridge"],
    "exampleOnly": false
  },
  "env": {
    "publicUrlConfigured": true,
    "publicBaseHint": "denizen.dolonia.cloud",
    "mcpTokenEnvPresent": false,
    "mcpUrlEnvPresent": false,
    "rateLimit": null
  },
  "notes": ["mcp_servers_all_disabled", "no_local_mcp_token_env"]
}
```

### Useful `notes[]` values

| Note | Operator action |
|------|-----------------|
| `oauth_needs_public_url` | Set `DENIZEN_PUBLIC_URL` to the HTTPS host clients use |
| `mcp_servers_json_absent` / `…_use_example` | Optional BYO tool servers; copy `data/mcp-servers.json.example` |
| `mcp_servers_all_disabled` | Enable a server entry if you need external MCP tools |
| `no_local_mcp_token_env` | Normal on the NAS/server; clients mint tokens in Connect AI |
| `npc_gateway_module_missing` | Deploy/package issue — restore `src/denizen-npc-mcp-gateway.js` |

---

## Common 401 tips

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401` / `Bearer token required` | Missing `Authorization` header | Send `Authorization: Bearer <token>` (no quotes in the header value) |
| `401` / `invalid or revoked token` | Wrong NPC path, revoked, or typo | Token is scoped to **one** NPC — URL must match (`/mcp/npc/roki` for a Roki token). Re-mint if rotated |
| `401` after OAuth | Public URL mismatch | `DENIZEN_PUBLIC_URL` must match the host Claude/Cursor calls (scheme + host) |
| Tools empty after connect | Scope too narrow | Re-mint with `standard` or `full` scopes (see Connect AI / scopes presets) |
| `429` rate limit | Burst traffic | Default `DENIZEN_MCP_RATE_LIMIT` ≈ 120/hour/token; wait or raise carefully |
| Works in browser, fails in IDE | IDE cached old token | Restart MCP server in Cursor/Claude after pasting a new token |
| Local only, remote client 401/timeout | Tunnel / firewall | Ensure Cloudflare/NAS exposes `/mcp/*` and `/.well-known/oauth*` |

**Never** paste tokens into git, screenshots, or issue trackers. Prefer office **Connect AI** mint + rotate.

---

## Operator checks

```bash
# Public health (no auth)
curl -sS https://denizen.dolonia.cloud/api/health | jq .mcp

# Harness status
curl -sS https://denizen.dolonia.cloud/api/harness/status | jq .mcp

# Unit tests
node --test tests/denizen-mcp-health.test.js
```

Related: `data/mcp-servers.json` (generic tool servers for skill discovery), [MCP_POWER_GAP_PLAN.md](./MCP_POWER_GAP_PLAN.md), [A_PLUS_PLAN.md](./A_PLUS_PLAN.md) §3.2.
