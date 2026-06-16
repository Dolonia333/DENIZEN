# Denizen — Database Architecture

How to build a **complete, forever-updating** database that powers Denizen today and becomes a **predictive data asset** for your team — and future companies — tomorrow.

---

## The north star: Event → Outcome → Prediction

Every system that gets smarter over time needs the same loop:

```
Action happens  →  record FACT (immutable)
Time passes     →  observe OUTCOME (label)
Model runs      →  store PREDICTION (validate later)
```

| Stage | Table | Purpose |
|-------|-------|---------|
| **Fact** | `denizen_facts` | "Lucy reviewed intake #42 at 2pm" — append-only, never edited |
| **Outcome** | `denizen_outcomes` | "Intake #42 converted to client 7 days later" — training labels |
| **Prediction** | `denizen_predictions` | "Intake #42 has 73% close probability" — scored, then validated |

This is how you create data that is valuable **now** (dashboards, alerts) and **later** (ML, benchmarking across orgs).

**Do not duplicate business truth.** `intake_forms`, `rfps`, `clients` stay the source of record. Denizen **links, enriches, and logs facts about them**.

---

## The core idea: three layers

Denizen data falls into three buckets. Only two belong in Postgres.

| Layer | What | Storage | Why |
|-------|------|---------|-----|
| **A — Canon** | SOUL.md, company-brief, furniture catalogs, sprite maps | **Files in git** | Human-edited, version-controlled, diff-friendly |
| **B — Runtime office** | Work output, telemetry, memories, CRM, threats, visitor assistants | **Supabase (Postgres)** | Queryable, multi-user, append-only events |
| **C — Ephemeral** | WorldState positions, think queues, WS fan-out | **In-memory** | Millisecond freshness; optional snapshots to B |

**Rule:** Move something to the DB when you need to **query it**, **share it across users**, or **keep it after restart**. Keep files when humans or git are the source of truth.

---

## Schema layout (one Postgres, two namespaces)

Use your **local Supabase** (`http://127.0.0.1:54321`):

- **Business tables** (no prefix) — website, CRM, RFP pipeline — already live
- **`denizen_*` tables** — office runtime, intelligence layer, multi-tenant spine

```
── Multi-tenant spine (migration 000004) ──
denizen_organizations         ← each company / team (slug: zion, acme, …)
denizen_org_members           ← profiles, visitors, API tokens → org + role
denizen_entity_registry       ← universal index: rfp, intake_form, lead, client, …
denizen_entity_links          ← NPC work ↔ business entity
denizen_facts                 ← immutable event spine (prediction fuel)
denizen_outcomes              ← observed results (training labels)
denizen_predictions           ← forecasts stored + validated later
denizen_snapshots             ← periodic state for time-series features
denizen_unified_timeline      ← view: facts + outcomes in one stream

denizen_schema_migrations     ← version tracker (forever updating)
denizen_office_sessions       ← server boot / restart id (Pier's idempotency)

── Identity & multi-user ──
denizen_visitor_sessions
denizen_user_identities           ← email/session-backed identity spine (000016)
denizen_identity_npc_team_templates ← per-identity saved NPC team (000100004)
denizen_identity_npc_team_members   ← roster rows for each team template
denizen_user_assistants
denizen_user_projects
denizen_assistant_messages

── NPC cognition (shared office) ──
denizen_npcs                  ← roster mirror (key, display_name, role, protected)
denizen_npc_memories          ← structured MEMORY.md lines (+ org_id, source, member_id via 000015)
denizen_mcp_tokens            ← per-teammate MCP bearer token hashes (v1.3)
denizen_npc_conversation_turns
denizen_npc_goals
denizen_npc_directives
denizen_npc_commitments
denizen_npc_task_progress
denizen_npc_moods

── Work & artifacts (high volume) ──
denizen_work_output           ← Pier's pipeline (WS → insert)
denizen_artifacts             ← reports/*.md metadata
denizen_decisions             ← optional full think JSON

── CEO / operator ──
denizen_ceo_profiles
denizen_ceo_projects
denizen_permissions

── Pipelines ──
denizen_job_applications
denizen_research_queue
denizen_research_sessions
denizen_email_drafts
denizen_task_chains

── CRM (Deal Weaver / Phone app) ──
denizen_crm_workspaces       ← org-scoped JSON workspace; mirrors to leads/clients on save

── Office & security ──
denizen_office_events
denizen_office_layout
denizen_security_threats
denizen_bouncer_runs

── Compute mesh & credits ──
denizen_compute_nodes
denizen_compute_jobs
denizen_node_profiles
denizen_credits_ledger        ← formula_version, machine_id via 000019
denizen_contribution_daily_totals

── Observability ──
denizen_llm_events            ← replaces llm-telemetry.jsonl over time

── Governance ──
denizen_soul_proposals
denizen_capability_proposals
```

---

## Forever updating: migration strategy

### 1. One migration per change (never edit old SQL)

```
denizen/supabase/migrations/
  20260606000000_denizen_foundation.sql      -- extensions + migration table
  20260606000001_denizen_visitor_assistants.sql
  20260606000002_denizen_npc_core.sql
  20260606000003_denizen_work_output.sql
  ...
```

Apply via:
- Supabase Studio SQL editor
- Supabase MCP (`apply_migration`)
- `supabase db push` if you adopt CLI migrations folder
- Docker: `000000`–`000004` as `postgres`; `000005` (alters business tables) as `supabase_admin`

### 2. Track applied migrations

`denizen_schema_migrations(version, name, applied_at)` — Denizen server or a startup script checks this before running new SQL.

### 3. Additive-only in production

- **Add** columns with defaults
- **Add** tables
- **Never** drop columns in place — deprecate, stop writing, migrate, drop later
- Use **JSONB** `metadata` columns on event tables for fields you are not sure about yet

### 4. Event-sourced logs (append-only)

High-volume tables (`work_output`, `llm_events`, `npc_memories`) are **insert-only**. Updates only for status fields (`job_applications.status`, `research_queue.status`).

### 5. Idempotency (Pier's requirement)

Every server boot writes a row to `denizen_office_sessions`. Work output rows include `office_session_id` so restarts do not duplicate or confuse analytics.

### 6. Dual-write during migration

When moving off JSON files:

1. **Read** DB first, fall back to file
2. **Write** both DB and file for one release
3. **Read** DB only
4. Remove file write

Example order: `llm-telemetry.jsonl` → `denizen_llm_events` → stop JSONL append.

---

## What stays as files (do not migrate)

| Path | Reason |
|------|--------|
| `npcs/*/SOUL.md` | Git-reviewed personality; soul-proposal apply writes here |
| `data/company-brief.json` | Rare edits; injected as prompt config |
| `data/furniture_catalog*.json`, sprite maps | Static assets |
| `reports/**/*.md` body | File content; DB stores **metadata + path** only |
| `layouts/office-layout.json` | Optional mirror in `denizen_office_layout` |

---

## Multi-user model

| Scope | Tables | Notes |
|-------|--------|-------|
| **Shared office** | npc_*, work_output, threats, office_events | All visitors see same NPCs walking/talking |
| **CEO / operator** | ceo_profiles, job_*, email_*, proposals | Zion's Lucy context today |
| **Per visitor (no login)** | visitor_sessions, user_assistants, user_projects | Browser UUID in localStorage |
| **Cross-visitor** | assistant_messages | Lucy ↔ teammate assistant handoff |

Protected NPCs (`abby`, `bouncer`, `lucy` for CEO): `denizen_npcs.protected = true` blocks claim.

---

## Wiring Denizen to Supabase

```
Browser / server.js
       │
       ├─► denizen-db.js (server instrumentation, direct PostgREST)
       │      boot → denizen_office_sessions + office.started fact
       │      npc_think → denizen_work_output + npc.work.* facts
       │      llm-telemetry → denizen_llm_events + llm.* facts
       │      worldState → office.task/threat/event facts
       │
       ├─► Direct REST (server-only) — visitor claim, CEO profile
       │
       └─► Secure bridge :18790 (NPC run_skill)
              whitelist: denizen_work_output, denizen_artifacts, ...
```

Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DENIZEN_ORG_SLUG=zion`, `DENIZEN_DB_ENABLED=true`

NPCs should **not** get raw SQL. They use `supabase-bridge` with a table whitelist.

---

## Existing business schema (reuse, do not rebuild)

Already in your Supabase — scoped to org via migration `000005`:

| Domain | Tables | Denizen role |
|--------|--------|--------------|
| Website intake | `intake_forms`, `leads`, `newsletter_subscribers` | Lucy triages; facts on every status change |
| CRM (phone `/crm/`) | `denizen_crm_workspaces`, `leads`, `clients`, `denizen_entity_registry` | Team JSON workspace (contacts, deals, companies, goals, sequences, …); bidirectional spine; `crm_contact` registry for no-email contacts; `/api/crm/assist` + NPC write skills |
| CRM (legacy platform) | `clients`, `projects`, `tickets` | Link NPC work to customer records |
| Gov contracting | `rfps`, `rfp_requirements`, `proposal_outlines`, `past_performance` | Full RFP pipeline; use `workflow_runs` for AI cost |
| Ingest | `raw_ingest_events`, `awards` | SAM.gov feed → entity registry |
| Agent bridge | `documents`, `key_value`, `logs` | NPC safe writes |

**Views for prediction-ready features:** `denizen_intake_funnel`, `denizen_rfp_velocity`

---

## What to record (instrumentation guide)

| When this happens | Write to | Example `fact_type` |
|-------------------|----------|---------------------|
| Website intake submitted | `denizen_facts` | `intake.submitted` |
| NPC reviews an intake | `denizen_facts` + `denizen_entity_links` | `intake.reviewed` |
| Intake → client conversion | `denizen_outcomes` (DB trigger) | `intake.converted` |
| RFP imported from SAM.gov | `denizen_entity_registry` + fact | `rfp.ingested` |
| NPC works on RFP | `denizen_work_output` + link | `rfp.worked` |
| Bid decision made | `denizen_outcomes` (DB trigger) | `rfp.bid` / `rfp.no_bid` |
| Job CRM email outcome | `denizen_outcomes` (server) | `job.interview` / `job.offer` / … |
| LLM think completes | `denizen_llm_events` + fact | `llm.completed` |
| RFP AI workflow runs | use existing `workflow_runs` + fact | `workflow.completed` |
| Server boots | `denizen_office_sessions` | `office.started` |

Use `denizen_record_fact(org_id, …)` — upserts entity registry automatically.

---

## Multi-tenant evolution (you → team → other companies)

| Stage | Who | How |
|-------|-----|-----|
| **Now** | You (CEO) | Default org `zion`; all existing rows backfilled |
| **Team** | Teammates | `denizen_visitor_sessions` + `denizen_org_members` |
| **Later** | Other companies | New `denizen_organizations` row; RLS policies per `org_id` |

Each new org gets its own office session stream, facts, and predictions — **aggregated benchmarks become a product asset** (anonymized cross-org patterns).

---

## Build order (recommended)

| Phase | Migrations | Unlocks |
|-------|------------|---------|
| **0** | `000000` foundation | Safe forever updates |
| **1** | `000001` visitor_assistants | Teammate claims NPC |
| **2** | `000002` work_and_events | Pier pipeline, telemetry, memories |
| **3** | `000003` ceo_and_pipelines | Job CRM, research, email, proposals |
| **4** | `000004` intelligence_layer | Facts, outcomes, predictions, multi-tenant |
| **5** | `000005` platform_org_bridge | Org scope on website/RFP tables + funnel views |
| **6** | `000006` outcome_triggers | Website intake/leads/rfp/client → outcomes + prediction validation |
| **7** | Wire server | `denizen_record_fact` on key events (done) |
| **8** | Job CRM | `recordJobOutcome` → `denizen_outcomes` (done) |

---

## Local dev checklist

1. Supabase running (`54321` API, `54323` Studio)
2. Cursor MCP: `.cursor/mcp.json` → `http://127.0.0.1:54321/mcp?features=database,...`
3. Apply migrations in order under `denizen/supabase/migrations/`
4. Start bridge: `python denizen/jelly/services/supabase-bridge/secure-bridge.py`
5. Add new table names to bridge `ALLOWED_TABLES`

---

## TypeScript types

After schema stabilizes a domain, run MCP `generate_typescript_types` → `denizen/src/types/database.ts` for server/bridge type safety.

---

## v1.2 platform bridge updates (000012 / 000013 / 000014)

This section captures schema additions that complete the v1.2 intelligence and identity bridge.

### Trading spine tables (000014)

| Table | Purpose | Key columns |
|---|---|---|
| `denizen_watchlist_symbols` | Org-scoped, NPC-attributed watchlist symbols | `org_id`, `npc_key` (default `roki`), `symbol`, `added_at`, unique `(org_id, symbol)` |
| `denizen_trade_suggestions` | Org-scoped trade ideas emitted by Roki/trading workflows | `org_id`, `npc_key`, `symbol`, `action`, `rationale`, `status`, `created_at` |

Both tables:
- enable RLS
- use `denizen_user_can_access_org(org_id)` select policies
- feed facts via trigger (`trade_suggestion.created`)

### Platform org bridge tables (000012 / 000013)

| Table | Migration | Change |
|---|---|---|
| `client_appointments` | `000013` | Added `client_id` FK and `org_id` FK; backfilled by matching client email; indexed for org/client queries |
| `subscriptions` | `000013` | Added `org_id` FK; backfilled from linked client; org index added |
| `denizen_job_applications` | `000012` | Added org bridge and attribution columns: `org_id`, `npc_key`, `session_id`; defaults/backfills align to default org + `roki` |

Trigger-driven intelligence writes:
- `client_appointments` -> `appointment.booked`, `appointment.status_changed`
- `denizen_job_applications` -> `job_application.*` facts + job outcomes (`job.positive_signal`, `job.rejected`)

### Apply order for 000012 and 000013

Use this order in local/prod rollout:

| Step | Migration | Run as | Why |
|---|---|---|---|
| 1 | `20260606000012_platform_identity_bridge.sql` | `postgres` (Denizen-owned objects) | Creates helper funcs, denizen table bridges, and trigger functions |
| 2 | `20260606000013_platform_tables_admin.sql` | `supabase_admin` (platform-owned tables) | Alters Supabase-owned tables, installs policies, attaches appointment trigger |

`000013` depends on objects introduced in `000012`, so reversing these can break trigger/policy creation.

### Compute mesh tables (000017–000019, mesh RLS 20260608000001–000003)

| Table | Purpose |
|-------|---------|
| `denizen_compute_jobs` | Job queue — `queued` → `assigned` → `done` / `failed` |
| `denizen_compute_nodes` | Registered worker nodes (desktop, NAS, Kali) with endpoint tokens |
| `denizen_credits_ledger` | Contribution credits per identity / machine |
| `denizen_contribution_daily_totals` | Daily rollup for contribution summaries |

Migrations: `20260606000017_denizen_compute_network.sql`, `20260606000018_desktop_agent_link.sql`, `20260606000019_contribution_credits.sql`.

### Station task queue (`denizen_station_tasks`)

| Column | Purpose |
|--------|---------|
| `id` | Task id (hex) |
| `session_id` | Visitor session that enqueued work |
| `install_id` | Paired desktop install id |
| `kind` | `screen_observe`, `file_read`, `file_write`, `run_code`, `desktop_agent` |
| `status` | `pending` → `claimed` → `completed` / `failed` |
| `payload` / `result` | JSON task input and desktop output |

Migration: `20260614000001_denizen_station_tasks.sql`. Indexed on `(install_id, status)` where `pending`.

**Production:** server should use `SUPABASE_SERVICE_ROLE_KEY`. Dev NAS may use permissive anon RLS (`20260608000001`–`000003`) — tighten before public launch.

See [COMPUTE_MESH.md](COMPUTE_MESH.md) and [../../infra/README.md](../../infra/README.md).

See also: [Intelligence spine](INTELLIGENCE_SPINE.md) and [Visitor onboarding](VISITOR_ONBOARDING.md).
