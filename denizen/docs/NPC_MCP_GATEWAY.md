# NPC MCP Gateway (v1.3)

Per-NPC MCP gateway so teammates can connect Claude, Cursor, or any MCP client to their claimed Denizen assistant. One HTTP gateway serves all NPCs; access is scoped by bearer token.

## Architecture

```
[Teammate AI client] --Bearer token--> POST /mcp/npc/{npc_key}
                                              |
                                              v
                                    denizen_resolve_mcp_token (RPC)
                                              |
                         +--------------------+--------------------+
                         |                    |                    |
                  update_memory          get_status           log_activity
                         |                    |                    |
              denizen_npc_memories    roster + work feed    denizen_work_output
                         |
              npc-brains.refreshDbMemories() on boot
```

Dual-write: in-world NPC brains still write `npcs/*/MEMORY.md`; MCP and brain saves also land in `denizen_npc_memories`.

## Database (migration `20260606000015`)

| Object | Purpose |
|--------|---------|
| `denizen_npc_memories.org_id` | Org-scoped memory lineage |
| `denizen_npc_memories.source` | `npc_brain`, `mcp`, etc. |
| `denizen_npc_memories.member_id` | Optional team account link |
| `denizen_mcp_tokens` | Hashed bearer tokens (plaintext shown once) |
| `denizen_resolve_mcp_token` | Validate token → scope JSON |
| `denizen_register_mcp_token` | Register hash after team session check |

Protected NPCs (`abby`, `bouncer`, `lucy`) cannot receive MCP tokens. Demo org (`acme`) is blocked.

## HTTP endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/mcp/npc/:npcKey` | Bearer | Tool manifest probe |
| `POST` | `/mcp/npc/:npcKey` | Bearer | JSON-RPC MCP (initialize, tools/list, tools/call) |
| `POST` | `/api/mcp/tokens` | Visitor session (team tier) | Create token — returns plaintext once |
| `GET` | `/api/mcp/connect-info?npc_key=roki` | Optional session | Setup instructions |

### MCP tools

1. **`update_memory`** — append memory for the NPC (syncs to DB + facts spine)
2. **`get_status`** — NPC roster row, recent MCP memories, recent work output
3. **`log_activity`** — write to work feed + facts

## Client setup

### Via office UI

1. Claim an NPC as your assistant (team session).
2. Click **Connect AI** next to the assistant chip.
3. Copy the MCP URL, bearer token, or Cursor/Claude config snippet.

### Via API

```bash
curl -X POST http://localhost:8080/api/mcp/tokens \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <visitor-session-token>" \
  -d '{"session_id":"<uuid>","npc_key":"roki"}'
```

### Cursor / Claude Desktop

```json
{
  "mcpServers": {
    "denizen-roki": {
      "url": "http://localhost:8080/mcp/npc/roki",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

For production, set `DENIZEN_PUBLIC_URL=https://denizen.dolonia.cloud` before creating tokens.

## Security

- Tokens stored as SHA-256 hashes only (`visitor-session-auth.hashSessionToken`)
- Rate limit: `DENIZEN_MCP_RATE_LIMIT` per token per hour (default 120)
- RLS on `denizen_mcp_tokens` denies direct table access; resolution via security definer RPC
- Demo org and protected NPCs rejected at token creation and resolution

## Code map

| File | Role |
|------|------|
| `src/denizen-npc-mcp-gateway.js` | JSON-RPC transport + tool handlers |
| `src/denizen-db.js` | `insertNpcMemory`, `listNpcMemories` |
| `src/npc-brains.js` | Dual-write `saveMemory`, `refreshDbMemories` |
| `src/visitor-mcp-connect-ui.js` | In-office connect flow |
| `tests/npc-mcp-gateway.test.js` | Unit tests |

## Apply migration

```powershell
cd denizen
.\scripts\apply-all-migrations.ps1
```

## Tag

Release milestone: `v1.3-npc-mcp-sync`
