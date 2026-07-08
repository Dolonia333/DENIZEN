# MCP Power Gap Closure Plan

> Give teams **real power** when Connect AI links Cursor/Claude to Denizen — not just memory sync.

## Current state (v1.7)

| Layer | Tools |
|-------|--------|
| Sync | `update_memory`, `get_status`, `log_activity` |
| Actions | `list_skills`, `run_skill`, `assign_task`, `delegate_task`, `announce_in_office` |
| Roki only | market quote/portfolio/watch/suggestions |

**Gaps:** no team roster, weak `get_status`, async skills by default, no handoffs, CRM only via opaque `run_skill`, no org MCP, no scopes/audit.

---

## Target architecture

```text
Per-NPC MCP  /mcp/npc/:key     ← "my assistant" (token scoped to one NPC)
Team MCP     /mcp/team         ← "run the office" (Phase 3 — org operator token)
Resources    team://roster     ← Phase 3 — MCP Resources for context without tool spam
```

Phase 1–2 ship on **per-NPC tokens** (already carry `org_id`, `session_id`, `member_id`).

---

## Phases

### Phase 1 — Team orchestration ✅ (this PR)

| ID | Deliverable | Acceptance |
|----|-------------|------------|
| P1.1 | `list_team` | Returns org teammates + online + claimed NPC |
| P1.2 | `send_handoff` | Message teammate by session/display name or CEO bridge |
| P1.3 | `list_pending_handoffs` | Inbox for token's `session_id` |
| P1.4 | `get_status` v2 | Directive inbox, skills, commitments, LM health, skill work rows |
| P1.5 | `run_skill` default `wait: true` | MCP returns output, not fire-and-forget |
| P1.6 | Tests + docs | `npc-mcp-gateway.test.js`, `NPC_MCP_GATEWAY.md` |

### Phase 2 — CRM clarity ✅ (this PR)

| ID | Deliverable | Acceptance |
|----|-------------|------------|
| P2.1 | `crm_pipeline_brief` | First-class tool (NPCs with CRM read) |
| P2.2 | `crm_list_tasks` | Open tasks from CRM |
| P2.3 | `crm_draft_email` | Draft with `to`, `subject`, `context` params |

### Phase 3 — Org MCP gateway ✅

| ID | Deliverable | Status |
|----|-------------|--------|
| P3.1 | `POST /api/mcp/team-tokens` | ✅ |
| P3.2 | `GET/POST /mcp/team` — `team_status`, `run_as_npc`, `broadcast_task` | ✅ |
| P3.3 | MCP Resources `team://roster`, `team://handoffs` | ✅ |

### Phase 4 — Governance ✅

| ID | Deliverable | Status |
|----|-------------|--------|
| P4.1 | Token scopes: `read`, `skills`, `crm_write`, `handoff`, `delegate` | ✅ |
| P4.2 | `denizen_mcp_audit` table + revoke UI in Settings | ✅ |
| P4.3 | Connect AI: Test MCP button + token rotate | ✅ |

### Phase 5 — Mesh power ✅

| ID | Deliverable | Status |
|----|-------------|--------|
| P5.1 | `enqueue_compute_job` / `get_job_status` for City Power teams | ✅ MCP tools + `GET /api/compute/jobs/:id` |
| P5.2 | `get_inference_nodes` — mesh pool status | ✅ MCP tool (full node list) |

### Phase 6 — Cursor bridge ✅

| ID | Deliverable | Status |
|----|-------------|--------|
| P6.1 | `enqueue_cursor_work` / `list_cursor_work` | ✅ Denizen → Cursor task queue |
| P6.2 | `claim_cursor_work` / `complete_cursor_work` | ✅ Cursor claims + reports back |
| P6.3 | `team://cursor-work` resource | ✅ Team MCP resource |
| P6.4 | Docs | ✅ `docs/DENIZEN_CURSOR_BRIDGE.md` |

---

## Security rules (unchanged)

- Denizen/Roki market = **read-only**; Robinhood execution stays in Cursor Robinhood MCP.
- `coding-agent` and destructive CRM writes remain skill-gated + team tier.
- Handoffs respect `visitor-connections` cross-team rules.

---

## Files

| File | Role |
|------|------|
| `src/mcp/denizen-mcp-scopes.js` | Scope presets + tool gating |
| `src/mcp/denizen-mcp-team-tools.js` | Team roster, handoffs, status enrichment |
| `src/mcp/denizen-mcp-crm-tools.js` | First-class CRM tools |
| `src/mcp/denizen-mcp-mesh-tools.js` | Mesh / City Power MCP tools |
| `src/mcp/denizen-mcp-cursor-tools.js` | Denizen ↔ Cursor self-improvement queue |
| `src/core/denizen-npc-mcp-gateway.js` | Wire tools + v1.8.0 |
| `src/mcp/denizen-mcp-actions.js` | `run_skill` wait default |
| `src/npc/npc-brains.js` | `getDirective()` |
| `server.js` | Configure deps + CEO handoff notify |
