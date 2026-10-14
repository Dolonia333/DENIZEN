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
| `denizen_mcp_audit` | Per-tool-call audit log (org + token + tool) |
| `denizen_resolve_mcp_token` | Validate token → scope JSON (includes `scopes[]`) |
| `denizen_register_mcp_token` | Register hash after team session check |
| `denizen_list_mcp_tokens` | List active tokens for session or org admin |
| `denizen_revoke_mcp_token` | Revoke token (owner session or org admin) |
| `denizen_log_mcp_audit` | Append audit row from gateway |

Protected NPCs (`abby`, `bouncer`, `lucy`) cannot receive MCP tokens. Demo org (`acme`) is blocked.

## HTTP endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/mcp/npc/:npcKey` | Bearer | Tool manifest probe |
| `POST` | `/mcp/npc/:npcKey` | Bearer | JSON-RPC MCP (initialize, tools/list, tools/call) |
| `POST` | `/api/mcp/tokens` | Visitor session (team tier) | Create per-NPC token — returns plaintext once |
| `GET` | `/api/mcp/tokens?session_id=` | Visitor session | List active tokens (org admins see all org tokens) |
| `POST` | `/api/mcp/tokens/revoke` | Visitor session | Revoke a token by `token_id` |
| `POST` | `/api/mcp/test` | Visitor session | Test bearer token (`get_status` or `team_status`) |
| `POST` | `/api/mcp/team-tokens` | Visitor session (team tier) | Create org team operator token (`/mcp/team`) |
| `GET` | `/mcp/team` | Team bearer | Team tool manifest |
| `POST` | `/mcp/team` | Team bearer | Team JSON-RPC MCP |
| `GET` | `/api/mcp/connect-info?npc_key=roki` | Optional session | Per-NPC setup |
| `GET` | `/api/mcp/connect-info?team=1` | Optional session | Team operator setup |
| `GET` | `/api/npc-sync/openapi.json` | None | OpenAPI 3.1 spec for ChatGPT Custom GPT Actions |
| `GET` | `/api/npc-sync/status` | Bearer (NPC token) | REST alias for `get_status` |
| `GET` | `/api/npc-sync/list-skills` | Bearer | REST alias for `list_skills` |
| `GET` | `/api/npc-sync/skill-job?job_id=` | Bearer | Poll async `run_skill` job (`get_skill_job`) |
| `POST` | `/api/npc-sync/memory` | Bearer | REST alias for `update_memory` (`body` or `note`) |
| `POST` | `/api/npc-sync/activity` | Bearer | REST alias for `log_activity` |
| `POST` | `/api/npc-sync/run-skill` | Bearer (`skills`) | REST alias for `run_skill` — **async by default** (job_id + poll) |
| `POST` | `/api/npc-sync/assign-task` | Bearer | **Blocked for ChatGPT** — returns `assign_task_blocked_for_chatgpt` |
| `GET` | `/api/npc-sync/team-standup` | Bearer | One-shot team sync (`team_standup`) |
| `GET` | `/api/npc-sync/handoffs` | Bearer | Pending handoff inbox |
| `POST` | `/api/npc-sync/ack-handoff` | Bearer (`handoff`) | Mark handoff delivered |

### MCP tools

**Sync (memory / status)**

1. **`update_memory`** — append memory for the NPC (syncs to DB + facts spine)
2. **`get_status`** — NPC roster row, recent MCP memories, recent work output
3. **`log_activity`** — write to work feed + facts

**Actions (do real work)**

4. **`list_skills`** — skills this NPC may run (design, research, CRM, etc.)
5. **`run_skill`** — execute a skill (`canvas-render`, `research`, `crm-draft-email`, …)
6. **`assign_task`** — queue a mandatory task for this NPC (wakes think loop)
7. **`delegate_task`** — assign work to another teammate NPC
8. **`announce_in_office`** — speech bubble in the virtual office for live viewers

**Team orchestration**

9. **`list_team`** — org teammates with WS + MCP/AI presence
10. **`send_handoff`** — message a teammate or escalate to CEO bridge
11. **`list_pending_handoffs`** — your assistant handoff inbox (poll regularly)
12. **`acknowledge_handoff`** — mark a handoff delivered after you act
13. **`team_standup`** — one-call sync: presence, handoffs, Cursor work, directives, CRM

**CRM** (NPCs with CRM skills only)

14. **`crm_pipeline_brief`** — pipeline summary
15. **`crm_list_tasks`** — open CRM tasks
16. **`crm_draft_email`** — draft email (does not send)

**Market** (Roki + Grok) — see `denizen-mcp-market-tools.js`

- Read tools: quotes, portfolio, positions, orders, watchlist, suggestions, `review_equity_order`
- Live: `place_equity_order` (scope `trade`, requires `ROBINHOOD_LIVE_TRADING=1` + `confirm=true`)
- Details: [ROBINHOOD_LIVE.md](ROBINHOOD_LIVE.md)

### Team operator (`/mcp/team`)

Use **Team MCP** in the office UI or `POST /api/mcp/team-tokens`.

| Tool | Purpose |
|------|---------|
| `team_status` | Whole-office snapshot |
| `run_as_npc` | Run any tool as another NPC |
| `broadcast_task` | Assign task to many NPCs |
| `list_team` / `send_handoff` / `list_pending_handoffs` / `acknowledge_handoff` / `team_standup` | Team orchestration |

**MCP Resources:** `team://roster`, `team://handoffs`, `team://standup`

## Token scopes (v2.0)

Tokens may carry scopes in `metadata.scopes`. Missing scopes = full access (backward compatible).

| Scope | Tools |
|-------|--------|
| `read` | `get_status`, `update_memory`, `log_activity`, `list_skills`, `list_team`, `team_standup`, `list_pending_handoffs`, CRM read, market read / `review_equity_order` |
| `skills` | `run_skill`, `run_as_npc` |
| `crm_write` | `crm_draft_email` |
| `handoff` | `send_handoff`, `acknowledge_handoff` |
| `delegate` | `assign_task`, `delegate_task`, `announce_in_office`, `broadcast_task` |
| `trade` | `place_equity_order` (also needs host `ROBINHOOD_LIVE_TRADING=1`) |

**Presets** (Settings / Connect AI): `read`, `standard` (read+skills+handoff), `full` (includes `trade`).

Every `tools/call` is logged to `denizen_mcp_audit`. Revoke tokens in **Settings → AI Connections**.

## Client setup

### Via office UI

1. Claim an NPC as your assistant (team session).
2. Click **Connect AI** next to the assistant chip.
3. Choose a tab: **Cursor/API**, **ChatGPT GPT**, or **Claude.ai**.

### ChatGPT Plus (Custom GPT Actions — no API key)

Works within OpenAI ToS — subscription chat only, no programmatic API routing.

**Important:** mint the token with **Standard** or **Full** scope (not Read-only). Read tokens can sync memory but cannot `runNpcSkill`.

1. Connect AI → **ChatGPT GPT** tab → copy OpenAPI URL + bearer token (**Standard/Full**).
2. [Create a Custom GPT](https://chatgpt.com/gpts/editor) → **Actions** → **Import from URL**.
3. Paste `https://<your-host>/api/npc-sync/openapi.json`.
4. **Authentication** → API Key → Type: **Bearer** → paste your NPC token.
5. Paste suggested instructions from the modal (or use `data/templates/chatgpt-npc-assistant.yaml`).
6. After Denizen Action schema updates, **re-import** the OpenAPI URL so standup / handoff / skill Actions appear.

ChatGPT should start with **`getTeamStandup`**, poll **`listHandoffs`** + **`ackHandoff`**, and do work with **`runNpcSkill`** (async + **`getSkillJob`**). **`assignNpcTask` is blocked** on the ChatGPT REST path.

### Claude.ai (MCP connector — Pro subscription)

1. Connect AI → **Claude.ai** tab → copy connector URL + auth header.
2. Claude.ai → Settings → Integrations → Add MCP connector.
3. If connector UI is unavailable, use the ChatGPT REST path or Cursor/API instead.

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

## Grok external autonomy

For **cloud Grok** driving the in-office Grok NPC via xAI Responses API + MCP, see [GROK_DENIZEN_AUTONOMY.md](GROK_DENIZEN_AUTONOMY.md).

```bash
py infra/run-grok-autonomy.py
py infra/run-grok-autonomy.py --loop --interval 300 --max 10
```

## Security

- Tokens stored as SHA-256 hashes only (`visitor-session-auth.hashSessionToken`)
- Rate limit: `DENIZEN_MCP_RATE_LIMIT` **tools/call** (and REST sync) per token per hour (default 120). Handshakes (`initialize`, `tools/list`, `notifications/initialized`) do not increment. Set `0` to disable (lab only). `429` responses include `Retry-After`. Ops tip: raise to `2000` for Grok+ChatGPT+Cursor fill sessions; restart the Node process to wipe the in-memory `_rateBuckets` map.
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

## NPC-to-NPC vs MCP (important)

| | MCP gateway | Agent bus |
|---|-------------|-----------|
| **Purpose** | External AI client ↔ **one** claimed NPC | **In-world** NPC ↔ NPC messaging |
| **Entry** | Connect AI modal, `/mcp/npc/:key` | `src/agent-bus.js`, `POST /api/agent-bus` |
| **Use when** | Sync ChatGPT/Cursor/Claude to your assistant | NPCs coordinate in the office |

MCP does **not** expose a `talk_to_npc` tool. For NPC-to-NPC conversations, see [AGENT_BUS.md](AGENT_BUS.md).

## Tag

| Release | Tag | Notes |
|---------|-----|-------|
| v1.3 | `v1.3-npc-mcp-sync` | MCP JSON-RPC gateway |
| v1.4 | `v1.4-npc-sync-rest` | REST shim + OpenAPI + ChatGPT/Claude onboarding |
| v1.5 | `v1.5-companion-extension` | Chrome extension companion (see [NPC_COMPANION.md](NPC_COMPANION.md)) |
| v1.6 | `v1.6.0` | Compute mesh + desktop worker + open-plan office; companion adds port 8081 |
