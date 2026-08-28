# Denizen ↔ Cursor Bridge

Bidirectional integration so **Denizen can queue real coding work** and **Cursor can operate the office** with full MCP power.

## Architecture

```text
┌─────────────────┐     MCP (Bearer / OAuth)      ┌──────────────────┐
│  Cursor IDE     │ ◄────────────────────────────►│  Denizen server  │
│  (your powers)  │   /mcp/npc/:key  or  /mcp/team │  NPCs + mesh     │
└────────┬────────┘                               └────────┬─────────┘
         │                                                  │
         │  claim_cursor_work / complete_cursor_work        │ enqueue_cursor_work
         │  run_skill coding-agent / assign_task            │ (Abby, dev NPCs, telemetry)
         ▼                                                  ▼
   Edit repo locally                              data/cursor-bridge-queue.jsonl
```

### Cursor → Denizen (already shipped)

Connect once via **Connect AI** in the office:

1. Copy MCP URL for your NPC (e.g. Abby) or **team token** for org-wide ops.
2. Cursor → Settings → MCP → add URL → OAuth sign-in.
3. Use tools:
   - `run_skill` with `coding-agent`, `github`, `research`, …
   - `assign_task` / `delegate_task` / `broadcast_task`
   - `get_status`, CRM tools, mesh tools (Phase 5)

### Denizen → Cursor (new)

When Denizen detects a gap (LM errors, failed think loops, skill gaps), NPCs or scripts call **`enqueue_cursor_work`**. Cursor polls **`list_cursor_work`**, claims, codes, **`complete_cursor_work`**.

| Tool | Direction | Scope |
|------|-----------|-------|
| `enqueue_cursor_work` | Denizen → queue | `delegate` |
| `list_cursor_work` | Cursor reads queue | `read` |
| `claim_cursor_work` | Cursor starts work | `skills` |
| `complete_cursor_work` | Cursor reports result | `skills` |

Team MCP resource: **`team://cursor-work`** — JSON pending queue without tool spam.

## Cursor agent loop (recommended)

Add to your Cursor rules or run manually when connected to Denizen MCP:

1. `list_cursor_work` — any `urgent` / `high` pending items?
2. `claim_cursor_work` — take highest priority
3. Implement in this repo (you have normal Cursor powers: edit, terminal, tests)
4. `complete_cursor_work` with `summary` + `files_changed`
5. Optional: `run_as_npc` → `assign_task` to wake Abby with “fix deployed”
6. Optional: `log_activity` on the NPC you represent

## Mesh / City Power (Phase 5)

| Tool | Purpose |
|------|---------|
| `enqueue_compute_job` | Queue mesh jobs (`inference_rpc`, `embedding_index`, …) |
| `get_job_status` | Poll by `job_id`; set `wait: true` to block |
| `get_inference_nodes` | Full LM Studio pool (URLs, models, scores) |

Requires **`compute`** scope on token (included in **Full access** preset).

## Self-improvement examples

**Abby sees LM Stats `provider_down`:**

```json
enqueue_cursor_work({
  "title": "Fix LM Studio AggregateError on NAS",
  "description": "Telemetry shows instant AggregateError, 0 tokens. Router may hit localhost inside Docker.",
  "files": ["denizen/src/lm-studio-router.js", "denizen/src/cofounder-agent.js"],
  "priority": "urgent",
  "kind": "bugfix"
})
```

**Cursor fixes and closes the loop:**

```json
complete_cursor_work({
  "work_id": "cwr_…",
  "summary": "Excluded loopback nodes in remote-only mode; unwrapped AggregateError in telemetry",
  "files_changed": ["denizen/src/format-provider-error.js", "denizen/src/llm-telemetry.js"]
})
```

## Row template (`data/cursor-bridge-queue.jsonl`)

The queue file is line-delimited JSON — one full row per line, written by
`toolEnqueueCursorWork` / mutated in place by `claim_cursor_work` and
`complete_cursor_work` (`src/denizen-mcp-cursor-tools.js`). This is the exact
persisted shape (not the tool-call args above — the args become a subset of
this row):

```json
{
  "id": "cwr_<16 hex chars>",
  "org_id": "org_...",
  "org_slug": "acme",
  "npc_key": "abby",
  "session_id": null,
  "member_id": null,
  "title": "Fix LM Studio AggregateError on NAS",
  "description": "Full context: files, error logs, acceptance criteria",
  "files": ["denizen/src/lm-studio-router.js"],
  "priority": "normal",
  "kind": "bugfix",
  "status": "pending",
  "created_at": "2026-08-28T02:00:00.000Z",
  "updated_at": "2026-08-28T02:00:00.000Z",
  "claimed_by": null,
  "claimed_at": null,
  "completed_at": null,
  "result": null
}
```

`status` transitions `pending -> in_progress -> done|failed`; `claimed_by` /
`claimed_at` are set by `claim_cursor_work`, `completed_at` + `result`
(`{ok, summary, files_changed, pr_url, completed_by}`) by
`complete_cursor_work`. `priority` is one of `low | normal | high | urgent`
(rank order used by `list_cursor_work`'s sort).

`data/cursor-bridge-queue.jsonl` itself is created empty by
`ensureQueueFile()` the first time the server touches it, and normally lives
on the NAS volume in production (see the Files table below), not in this
repo — so a fresh checkout won't have one until Wave 5's MCP bridge writes
the first real row. It carries a single `status: "template"` row (this exact
shape, ignored by `list_cursor_work`'s default `pending` filter, visible with
`status: "all"`) pointing at the Wave 5 prep artifacts
(`data/city-specs/npc-patrol-routes.json`,
`data/limezu-visual-catalog/montage-qa-report.json`,
`assets/limezu/_asset-catalog-enriched.json`) so the first connected session
has a concrete example to read before enqueuing real work — see
`data/city-specs/EXTERIOR-PLACEMENT-BRAIN-PLAN.md` Wave 5.

## Security

- Same scope/audit model as Phase 4 — destructive work stays behind `skills` + `coding-agent` skill gate inside Denizen.
- Cursor bridge queue is org-scoped (`org_id` on each row).
- Robinhood execution remains a **separate** optional Cursor MCP (trading only).

## Files

| Path | Role |
|------|------|
| `src/denizen-mcp-cursor-tools.js` | Queue + 4 MCP tools |
| `src/denizen-mcp-mesh-tools.js` | Mesh MCP tools |
| `data/cursor-bridge-queue.jsonl` | Persistent queue (NAS volume) |
| `.cursor/rules/denizen-bridge.mdc` | Cursor-side polling hint |
