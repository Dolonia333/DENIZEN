# Multi-User Office Plan

> Turn Denizen into a true multi-company app: each person gets an isolated team of 16 agents, their own souls/memories, and their own office runtime — without cross-tenant bleed.

**Related docs**

| Doc | Scope |
|-----|--------|
| [EXECUTION_BOARD.md](EXECUTION_BOARD.md) | **Active slices** — what to build this week |
| [1921_TEMPLATE.md](1921_TEMPLATE.md) | 1921 GovCon template pack contents |
| [ROADMAP.md](ROADMAP.md) | NPC capability phases 4–6 |
| [GAP_CLOSURE_PLAN.md](GAP_CLOSURE_PLAN.md) | Production hardening + scale (WS shard, shared pub/sub) |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Existing `org_id` / RLS patterns |
| [VISITOR_ONBOARDING.md](VISITOR_ONBOARDING.md) | Auth, org resolution, team accounts |
| [visitor-office-registry.js](../src/visitor-office-registry.js) | Per-identity virtual offices (partial) |

---

## Overall goal

Make Denizen support **multiple independent companies** (1921/Dolonia, your mom's business, solo developers, etc.), where each person has their **own isolated team of 16 agents**.

Today:

- **Database spine** is largely org-scoped (`org_id`, RLS helpers in migration `000012`).
- **SOUL/MEMORY** still load from **git files** under `npcs/<name>/` — single-tenant in practice.
- **World state** (`world-state.js`) is **one in-memory office** for the running server process.
- **Visitor virtual offices** exist for teammates (identity-scoped layout + claimed NPCs) but the **primary operator office** is still shared file-based souls.

This plan closes that gap in dependency order.

---

## Phase 1 — Soul file system (most important)

**Problem:** Identity lives in Markdown on disk. A second org cannot have different Abby/Marcus souls without forking the repo.

### Deliverables

| # | Task | Notes |
|---|------|--------|
| 1.1 | New migration: `agent_souls` table | Columns: `id`, `org_id`, `agent_name` (or `npc_key`), `soul_content`, `memory_content`, `updated_at`, unique `(org_id, agent_name)` |
| 1.2 | Seed 1921/Dolonia org | Migrate current 16 `npcs/*/SOUL.md` + `MEMORY.md` into `agent_souls` for the `zion` org |
| 1.3 | `loadSoul(orgId, agentName)` | Replace direct `fs.readFile` in `npc-brains.js` with DB-first load; file path is fallback for dev/single-tenant |
| 1.4 | `saveMemory(orgId, agentName, content)` | Dual-write during migration: DB + optional file; then DB-only for hosted multi-tenant |
| 1.5 | Default templates | New org gets 16 template souls (generic roles) or a chosen template pack (see Phase 5) |
| 1.6 | `reloadSoul()` | Re-query `agent_souls` after approved SOUL proposal apply |

### Key files

- `denizen/supabase/migrations/YYYYMMDD_agent_souls.sql`
- `denizen/src/npc-brains.js` — `_loadSoul`, `_loadMemory`, `reloadSoul`
- `denizen/src/denizen-db.js` — CRUD helpers
- `infra/seed-agent-souls-nas.py` — one-time seed from `npcs/`

### Acceptance

- Two org rows in `denizen_organizations` can have **different** Abby `soul_content` and both load correctly after server restart.
- Existing single-tenant NAS deploy still works via file fallback when `org_id` is default and DB row missing.

**Effort:** ~3–5 days · **Blocks:** Phases 2–5

---

## Phase 2 — World state isolation

**Problem:** `world-state.js` is a singleton — positions, moods, directives, and queues are global to one office.

### Deliverables

| # | Task | Notes |
|---|------|--------|
| 2.1 | `org_id` on world-state buckets | Positions, moods, active directives, think queues keyed by `org_id` (and optionally `office_id` for per-identity virtual offices) |
| 2.2 | `NpcBrainManager` per org | Either one manager with org-scoped maps, or `Map<orgId, NpcBrainManager>` — avoid duplicating 16×N full brain objects if unnecessary |
| 2.3 | Office scene routing | Browser receives `org_id` (from session); `/agent-ws` subscribes to that org's broadcasts only |
| 2.4 | Think loop scoping | `think(npcName)` resolves org from connection context; no cross-org directive injection |
| 2.5 | CofounderAgent / Abby director | Director loop runs **per org** — idle/stuck detection and meetings scoped to that org's roster |
| 2.6 | Business context | `denizen-business-context.js` already org-aware via CRM `orgId`; wire `company-brief` / `business-model` to org-scoped JSON or DB rows (not only global `data/*.json`) |

### Key files

- `denizen/src/world-state.js`
- `denizen/src/npc-brains.js`
- `denizen/src/cofounder-agent.js`
- `denizen/src/agent-office-manager.js` / `office-scene.js`

### Acceptance

- User A and User B logged into different orgs see **different** agent positions and speech bubbles with no cross-leak on a single server process.
- Abby in org A cannot assign directives to org B's Alex.

**Effort:** ~5–8 days · **Depends on:** Phase 1 (souls must be org-scoped before scaling offices)

---

## Phase 3 — Authentication & routing

**Problem:** WebSocket and REST handlers must consistently know **which org** the connection belongs to.

### Deliverables

| # | Task | Notes |
|---|------|--------|
| 3.1 | Login → `org_id` | Every auth path returns/resolves `org_id` (team account, visitor session, API token) — extend existing `denizen_auth_user_org_ids()` usage |
| 3.2 | WS attach `org_id` | On `visitor_register` / CEO connect, bind `ws._orgId` (and `office_id` if virtual office) |
| 3.3 | Filter broadcasts | `npc_work_output`, `npc_decision`, speech bubbles, meetings — fan-out only to sockets with matching `org_id` |
| 3.4 | REST scope | Audit `/api/*` routes that touch NPC state; require org from session/token |
| 3.5 | MCP tokens | Already carry `org_id` — verify `run_skill` and memory writes never escape token org |

### Key files

- `denizen/server.js` — WS upgrade, `player_chat`, broadcast helpers
- `denizen/src/denizen-visitor.js`
- `denizen/src/denizen-npc-mcp-gateway.js`

### Acceptance

- Pen-test script: connect two WS clients with different org tokens; assert zero cross-org events in 60s of mixed office activity.

**Effort:** ~3–4 days · **Depends on:** Phase 2 (org-scoped state to filter)

---

## Phase 4 — Compute & performance

**Problem:** One GPU serial queue serving 16 agents becomes unfair and fragile when **multiple orgs** share a host.

### Deliverables

| # | Task | Notes |
|---|------|--------|
| 4.1 | Fair LLM queue | Round-robin or weighted fair queuing across `org_id` (prevent one tenant from starving others) |
| 4.2 | Per-org rate limits | Cap thinks/min, `run_skill`/min, and player-chat inference per org (env-tunable) |
| 4.3 | Mesh job attribution | `denizen_compute_jobs` already org-scoped — ensure enqueue from NPC paths passes `org_id` |
| 4.4 | Saturation signals | `/api/health` + diag panel show per-org queue depth when multi-tenant mode enabled |

### Key files

- `denizen/src/npc-brains.js` — inference queue
- `denizen/src/lm-studio-router.js`
- `denizen/src/denizen-compute-routes.js`

### Acceptance

- With 2 orgs at 16 agents each, neither org's p95 think latency exceeds 3× single-org baseline under normal load.
- Hitting rate limit returns explicit 429 / user-visible message, not silent stall.

**Effort:** ~2–4 days · **Depends on:** Phase 3 (org on every inference request)

---

## Phase 5 — Template system & onboarding

**Problem:** New users need a fast path to a working 16-agent company without hand-editing 16 soul files.

### Deliverables

| # | Task | Notes |
|---|------|--------|
| 5.1 | Template packs | JSON or SQL seed: `agent_soul_templates` with packs (`generic-smb`, `1921-govcon`, `sales-pipeline`, …) |
| 5.2 | Clone on signup | `POST /api/org/clone-template` copies 16 souls + optional `business-model.json` into new `org_id` |
| 5.3 | Onboarding UI | City/citizenship flow: pick template or start blank → preview roster → confirm |
| 5.4 | 1921 pack | First-class template from dossier-backed `business-model.json` + current operator souls |

### Key files

- `denizen/data/templates/agent-souls/` (or DB seeds)
- `denizen/src/visitor-onboarding.js` / city tour
- `denizen/docs/VISITOR_ONBOARDING.md`

### Acceptance

- New user completes onboarding in &lt;5 minutes with a live 16-agent office and distinct company name in think prompts.
- Choosing **1921 GovCon** template surfaces OMES/RM Cyber context in Marcus/Sarah prompts (via org-scoped business model).

**Effort:** ~3–5 days · **Depends on:** Phase 1 (souls in DB to clone)

---

## Recommended build order

```
Phase 1 (agent_souls DB)  →  Phase 2 (world state per org)  →  Phase 3 (auth/WS routing)
                                      ↓
                              Phase 4 (fair queue + limits)
                                      ↓
                              Phase 5 (templates + onboarding)
```

**Do not** start with Phase 3 or 4 alone — without Phase 1, isolation is cosmetic.

---

## Overlap with existing roadmap

| Existing item | Relationship |
|---------------|----------------|
| [GAP_CLOSURE_PLAN.md](GAP_CLOSURE_PLAN.md) Workstream scale — WS shard, Redis pub/sub | **Phase 2+3** at horizontal scale (multiple server processes) |
| [ROADMAP.md](ROADMAP.md) Phase 4.1 public demo | Demo org (`acme`) already walled off from business data — pattern for Phase 3 |
| Business context layer (`denizen-business-context.js`) | Move `business-model.json` to per-org store in Phase 2.6 |
| Per-identity virtual offices (`visitor-office-registry.js`) | `office_id` dimension inside Phase 2 — teammate offices within one org |

---

## Success criteria (north star)

| Metric | Target |
|--------|--------|
| Tenant isolation | Zero cross-org soul/memory/world-state leaks in automated tests |
| Time to first office | New org → 16 agents thinking with template souls in &lt;5 min |
| Fairness | No single org &gt;50% GPU queue share for 10+ minutes under multi-tenant load |
| Portability | Fork company = edit souls + business model in UI/DB, not git fork |

---

## Next step when ready to implement

**Start with Phase 1 in detail:** migration SQL, seed script, and `npc-brains.js` load path — smallest change that unlocks everything else.

See also: [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) § Multi-tenant model, [INTELLIGENCE_SPINE.md](INTELLIGENCE_SPINE.md) § org-first design.
