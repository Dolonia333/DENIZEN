# Denizen — Technical Overview

> Engineering reference for the Denizen platform. For end-user instructions see
> [PRODUCT_MANUAL.md](PRODUCT_MANUAL.md); for product scope see [PRD.md](PRD.md).
> Companion deep-dives live throughout `docs/` (see [DOCS_INDEX.md](DOCS_INDEX.md)).

---

## 1. What Denizen is

Denizen is a **visual operating layer for a team of AI agents**. It renders a
pixel-art office (a Phaser game) in which each NPC is a real AI agent doing real
business work — talking to clients, moving deals, researching, writing email,
running code on a compute mesh. The human "CEO" watches the work happen in the
world, directs the agents, and the platform keeps everything observable and
accountable.

Three things ship together:

1. **The Office** — the live, navigable world where agents (NPCs) act and you
   observe/direct them.
2. **Meridian CRM** — a full role- and industry-aware CRM the agents (and you)
   operate, embedded at `/crm/`.
3. **The Mesh** — a compute + identity fabric: signed identities, a per-NPC MCP
   gateway so you can drive agents from your own AI subscription, and a
   contributor compute network (your machines run jobs for credits).

---

## 2. Monorepo layout

```
multbot/
├── denizen/                 # the platform (this doc's subject)
│   ├── server.js            # monolithic Node HTTP + WebSocket server (~7k LOC)
│   ├── index.html           # Phaser game shell (the Office)
│   ├── office-scene.js      # main Phaser scene
│   ├── src/                 # 231 backend + client modules
│   │   └── world/           # world generator, renderer, RNG, debug
│   ├── crm/                 # Meridian CRM
│   │   ├── vendor/          # Vite + React + shadcn/ui source
│   │   └── dist/            # built bundle, served at /crm/
│   ├── desktop/             # Electron desktop app (pairing + compute worker)
│   ├── companion-extension/ # Chrome companion extension
│   ├── npcs/                # 18 NPC "souls" (SOUL.md per agent)
│   ├── jelly/               # services + skills framework
│   ├── mcp-ui-inspect/      # local MCP server for UI inspection
│   ├── data/                # world data, templates, runtime JSON stores
│   ├── assets/              # sprite sheets, audio, models
│   ├── scripts/             # smoke tests, probes, asset pipeline, ops
│   ├── tests/               # node:test unit/integration/e2e suites
│   ├── supabase/            # schema / migrations
│   └── docs/                # ~50 subsystem docs
├── openclaw/                # OpenClaw agent gateway (separate process)
├── VisionClaw/              # vision tooling
└── infra/                   # deploy infra
```

---

## 3. Architecture at a glance

```
                         ┌──────────────────────────────────────────────┐
   Browser (Office)  ◄──►│  server.js  — Node HTTP + WebSocket (ws)       │
   /  Phone UI          │   • raw router (no framework)                  │
                         │   • mounts: CRM, compute, MCP gateway,        │
   CRM SPA  (/crm/)  ◄──►│     MCP OAuth, NPC-sync, market, email, …     │
                         │   • WS channels: agent, security              │
   Electron desktop ◄──►│                                                │
   Companion ext    ◄──►└───────┬───────────────┬──────────────┬─────────┘
                                 │               │              │
   Subscription AIs              │               │              │
   (Claude.ai/ChatGPT/   ◄── MCP gateway     Supabase       OpenClaw
    Cursor) via OAuth         (/mcp/npc/*)   (PostgREST)    gateway :18789
                                              cloud + NAS    │
                                                             ▼
                                                       LM Studio :1234
                                                       (+ cloud LLM providers)
```

- **No web framework** — `server.js` is a hand-rolled `http` router. Feature
  groups are mounted as predicate handlers (`handleCrmRoutes`, compute routes,
  `handleOAuthRoute`, the `/mcp/npc/:key` match, NPC-sync, etc.).
- **Realtime** uses `ws` with two logical channels: `agent` (world/agent events)
  and `security` (threat feed).
- **Persistence** is Supabase via PostgREST, accessed through `denizen-db.js`
  helpers (`_get/_post/_patch/_rpc` and `*Soft` non-throwing variants). A cloud
  Supabase plus an optional NAS-hosted instance form the data fleet.
- **AI** is provider-agnostic: NPC brains call LM Studio locally by default
  (`:1234`) and can route to cloud providers (claude/grok/gemini/kimi/moonshot);
  OpenClaw is the agent execution gateway.

---

## 4. Subsystems

### 4.1 World / game engine
- **Phaser 3** (CDN) at 1280×720, camera-follow, pixel-art tilesets.
- `src/world/` — deterministic world generation (`rng.js`, `generator.js`),
  rendering (`renderer.js`), debug overlays.
- `office-scene.js` — the runtime scene; `openplan-walls.js` renders wall
  layouts; `pathfinding.js` drives NPC movement.
- Asset pipeline: `build_assets_catalog.py`, sprite sheets, `assets-catalog.json`;
  see `docs/CATALOG_WORKFLOW.md`, `docs/ENGINE_AND_SPRITES.md`.
- World-state bridge: `world-state.js` + `openclaw-worldstate-bridge.js` turn
  agent activity into in-world motion/animation.

### 4.2 NPC / agent system
- **Souls**: `npcs/<name>/SOUL.md` define each of the 18 agents' persona, goals,
  voice. Loaded into `denizen_npc_core` / `denizen_npcs`.
- **Brains**: `npc-brains.js` (provider routing + prompting), `npc-think-runner.js`
  (the think loop), `npc-roster.js`, `npc-capabilities.js`, `npc-tools.js`.
- **Office manager**: `agent-office-manager.js` + `agent-actions.js` orchestrate
  what agents do and translate intents into actions/animations.
- **Memory & state** tables: `denizen_npc_memories`, `_moods`, `_goals`,
  `_directives`, `_commitments`, `_conversation_turns`, `_task_progress`.
- **Self-advancement**: capability/animation/code/soul proposals
  (`denizen_capability_proposals`, `denizen_soul_proposals`, …) gated by a
  human-approval flow (`docs/CAPABILITY_PROPOSALS.md`, `PROPOSAL_REVIEW.md`).

### 4.3 Identity, auth & teams
- **Sessions**: `visitor-session.js` (client) ↔ `visitor-session-auth.js` +
  `visitor-access.js` (server). Stored in `denizen_visitor_sessions` /
  `denizen_user_identities`.
- **Signed grants**: HMAC-signed, base64url JWT-like `ceo_grant` / `access_grant`
  (`visitor-session-auth.js`). CEO status requires a verified `X-Denizen-Ceo-Grant`
  header — bare client flags are stripped server-side. 7-day rolling TTL.
- **Tunnel-aware locality**: "local operator" = loopback **and** no forwarding
  headers (`denizen-host-compute.js`), so tunneled visitors never inherit host
  privileges.
- **Teams**: `denizen-team-auth.js`, team-code login links a session to a real
  identity + `denizen_team_accounts`. See [project memory + `docs/SECURITY.md`].
- Tiers: `ceo` / `team` / `demo`. Org model: `denizen_organizations`,
  `denizen_org_members`, `denizen_user_can_access_org`.

### 4.4 Meridian CRM
- **Frontend**: `crm/vendor` — Vite + React + shadcn/ui + TS (dev `:8090`, base
  `/crm/`, proxies `/api`). Built to `crm/dist`, served by `server.js`.
- **Role dashboards**: `crm/vendor/src/lib/crm-roles.ts` defines 7 personas
  (Sales Rep, Sales Manager, SDR/BDR, Account Manager, Marketing, Support, Exec);
  `components/crm/RoleDashboard.tsx` renders role- and industry-aware widget
  layouts; the header role switcher persists per browser.
- **Industries**: `lib/industry-config.ts` ships 28 industry templates (terminology,
  pipeline stages, custom fields). Every industry gets a tailored dashboard
  spotlight built from its config.
- **Backend**: `src/denizen-crm-*.js` (≈20 modules) under `/api/crm/*`
  (`denizen-crm-routes.js`). Workspace state is one JSONB blob per org
  (`denizen_crm_workspaces`, ~30 keys) with optimistic concurrency.
  Subsystems: store, spine (mirrors to entity registry / leads), mutations,
  automations engine, sequences, scheduler (5-min tick), stripe, calendar
  (Google/MS OAuth), email (Resend), webhooks, portal (public quotes), assist
  (LLM copilot), handoffs, metrics, digest, team-invite, intake (public).
- See [WORKSPACE_ARCHITECTURE.md](WORKSPACE_ARCHITECTURE.md) and the CRM memory.

### 4.5 MCP integration (drive agents from your own AI)
- **Per-NPC gateway**: `denizen-npc-mcp-gateway.js` exposes `/mcp/npc/:npcKey`
  (Streamable HTTP JSON-RPC) with tools `update_memory`, `get_status`,
  `log_activity`. Bearer-token auth (hashed in `denizen_mcp_tokens`).
- **OAuth connector**: `denizen-mcp-oauth.js` adds OAuth 2.1 so subscription AIs
  connect by URL alone — discovery (`/.well-known/oauth-authorization-server` +
  `oauth-protected-resource`), dynamic client registration, PKCE authorize +
  consent page, token exchange that returns a gateway-minted token. Gateway 401s
  carry `WWW-Authenticate: …resource_metadata=…` for auto-discovery.
- **Connect UI**: `visitor-mcp-connect-ui.js` — "1-Click" (paste URL) plus legacy
  Companion / Cursor / ChatGPT / Claude tabs.
- Also a generic outbound MCP client (`denizen-mcp-connector.js`) and
  `mcp-ui-inspect/` (local MCP server). See [NPC_MCP_GATEWAY.md](NPC_MCP_GATEWAY.md).

### 4.6 Compute mesh
- **Model**: `denizen_compute_nodes` = one row per machine; `denizen_node_profiles`
  = **one row per identity** (user-level settings/hardware; UNIQUE on identity).
- **Queue**: `denizen-compute-queue.js` — FIFO claim from `denizen_compute_jobs`
  (no node targeting). Worker loop: `/api/compute/node/claim` → execute →
  `/api/compute/node/complete` → `incrementJobsCompleted`.
- **Workers**: the Electron desktop app (`desktop/node-worker-loop.js`) and host
  worker run jobs (primarily `npc_think_batch` LLM inference on the host GPU).
- **Economy**: `denizen_credits_ledger`, `denizen_contribution_daily_totals`;
  `denizen-host-compute.js` resolves contribution state. Node auth = nodeId +
  endpoint token (not identity). See [COMPUTE_MESH.md](COMPUTE_MESH.md).

### 4.7 Intelligence & autonomy
- **Mirofish prediction**: `mirofish-prediction.js` + `denizen-prediction-loop.js`
  — agents make predictions, record outcomes, learn. Tables `denizen_predictions`,
  `_decisions`, `_outcomes`, `_facts`, `denizen_unified_timeline`.
- **Spine**: `denizen-visitor-intelligence.js` + intelligence spine wire CRM/world
  signals into agent context (`docs/INTELLIGENCE_SPINE.md`).
- **Research**: Lucy's browser/research chains (`lucy-search-brief.js`,
  `research-scheduler.js`, `/api/lucy-*`), `denizen_research_queue/sessions`.

### 4.8 Security
- `security-monitor-server.js` + Bouncer investigations, Redis relay to spectate
  followers, mesh `bouncer_patrol`, `denizen_bouncer_runs`. See **[BOUNCER.md](BOUNCER.md)**
  (system) and [SECURITY.md](SECURITY.md) (threat catalog).

### 4.9 Integrations
- **Email**: `gmail-client.js`, `email-handler.js`, inbound `/api/email-inbound`,
  drafts `denizen_email_drafts` (`docs/EMAIL_INTEGRATION.md`).
- **Markets**: `robinhood-mcp.js` + `/api/market/*` (auth, portfolio, quotes,
  watchlist) and `denizen_trade_suggestions` (`docs/ROBINHOOD_LIVE.md`).
- **Voice**: `elevenlabs-provider.js`, `voice-gate.js` (TTS + voice walk-up).
- **Calendar**: Google/Microsoft OAuth via the CRM calendar module.

### 4.10 Clients
- **Phone UI**: `denizen-phone-ui.js` — in-game "Denizen OS" smartphone HUD
  (app grid, dock, lazy-loaded panels). `device-profile.js` + `mobile-controls.js`
  handle responsive/touch.
- **Desktop app**: `desktop/` Electron — pairing wizard (browser `?pair_desktop=1`),
  capability grants, compute worker, auto-update.
- **Companion extension**: `companion-extension/` — provider-agnostic "send to NPC"
  from any web AI.

---

## 5. Data model (selected, 58+ tables)

| Domain | Key tables |
|---|---|
| Identity / org | `denizen_user_identities`, `denizen_visitor_sessions`, `denizen_organizations`, `denizen_org_members`, `denizen_user_can_access_org`, `denizen_permissions`, `denizen_ceo_profiles`, `denizen_user_assistants`, `denizen_visitor_assistants` |
| NPC / agent | `denizen_npcs`, `denizen_npc_core`, `_memories`, `_moods`, `_goals`, `_directives`, `_commitments`, `_conversation_turns`, `_task_progress`, `denizen_soul_proposals`, `denizen_identity_npc_team_members`/`_templates` |
| CRM | `denizen_crm_workspaces`, `denizen_entity_registry`, `denizen_entity_links`, `denizen_intake_funnel`, `denizen_mcp_tokens` |
| Compute | `denizen_compute_nodes`, `denizen_node_profiles`, `denizen_compute_jobs`, `denizen_compute_network`, `denizen_credits_ledger`, `denizen_contribution_daily_totals`, `denizen_station_tasks` |
| Intelligence | `denizen_predictions`, `_decisions`, `_outcomes`, `_facts`, `denizen_unified_timeline`, `denizen_research_queue`/`_sessions`, `denizen_snapshots`, `denizen_artifacts`, `denizen_rfp_velocity`, `denizen_trade_suggestions` |
| Governance | `denizen_capability_proposals`, `denizen_decisions`, `denizen_foundation` |
| Security | `denizen_security_threats`, `denizen_bouncer_runs` |
| World | `denizen_office_layout`, `denizen_office_events`, `denizen_office_sessions` |
| Email / job | `denizen_email_drafts`, `denizen_assistant_messages`, `denizen_job_applications` |
| Meta | `denizen_schema_migrations` |

Full column-level reference: [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).

---

## 6. API surface (grouped)

`server.js` exposes ~80+ routes. Major groups:

- **Health/ops**: `/api/health`, `/api/health/runbook`, `/api/costs`, `/api/presence`
- **World/office**: `/api/office-config`, `/api/layout`, `/api/place-furniture`,
  `/api/remove-furniture`, `/api/generate-city`, `/api/llm-city-plan`, `/api/meeting`
- **NPC/agent**: `/api/npc-profiles`, `/api/npc-capabilities`, `/api/assign-directive`,
  `/api/agent-bus`, `/api/ambient-dialogue/pair`, `/api/assistant-profile`
- **Governance**: `/api/capability-proposals`(+approve), `/api/code-proposals`,
  `/api/animation-proposals`(+approve), `/api/grant-permission`, `/api/org/policy`
- **CRM**: `/api/crm/*` (session, workspace, assist, send-email, sequence/enroll,
  intake, quote portal, calendar, stripe/resend webhooks, team)
- **MCP**: `/mcp/npc/:key`, `/mcp/oauth/*`, `/.well-known/oauth-*`,
  `/api/mcp/tokens`, `/api/mcp/connect-info`, `/api/mcp/servers`, `/api/mcp/discover`,
  `/api/npc-sync/*` (REST + OpenAPI)
- **Compute**: `/api/compute/node/{register,heartbeat,claim,complete}`,
  `/api/compute/{resource-pressure,scale-advice,task-advice}`
- **Desktop**: `/api/desktop/*`, `/api/desktop-task`, `/api/desktop-abort`,
  `/api/pc-activity/*`
- **Intelligence/research**: `/api/intelligence/*` (mirofish, prediction),
  `/api/lucy-*` (search, research-chain, browser mirror/stream), `/api/away/*`
- **Integrations**: `/api/market/*`, `/api/email-*`, `/api/federal/pipeline-summary`,
  `/api/job-crm/*`, `/api/job-apply`

---

## 7. Deployment & runtime

- **Process**: `node --env-file=.env server.js` (default port `8080`; the live
  station has run on `8081` to match the tunnel). Companion processes: OpenClaw
  gateway (`:18789`), optional security monitor.
- **Edge**: Cloudflare Tunnel (`cloudflared`) maps `denizen.dolonia.cloud` →
  `localhost:<port>`. Config: `~/.cloudflared/config.yml` **or** a token-based
  Windows service (routing then lives in the Zero Trust dashboard, not the file).
- **Mesh networking**: Tailscale (`100.x` addresses) links station ↔ laptop ↔ NAS.
- **Data**: cloud Supabase + optional NAS Supabase (`<NAS_IP>`).
- **Key env vars**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DENIZEN_PUBLIC_URL`,
  `LM_STUDIO_URL`, `DENIZEN_TEAM_CODE`, `DENIZEN_CEO_IDENTITY_EMAIL`,
  `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`, `RESEND_WEBHOOK_SECRET`,
  `GOOGLE_/MICROSOFT_CALENDAR_CLIENT_ID/SECRET`, `DENIZEN_MCP_RATE_LIMIT`.
- **Containers**: `Dockerfile`, `docker-compose.yml`, `ecosystem.config.js` (pm2).
- See [PRODUCTION_DEPLOY.md](PRODUCTION_DEPLOY.md).

> Note: server-side changes require restarting the live process (pm2/service) —
> the tunnel keeps serving old code until then.

---

## 8. Testing & quality

- **Unit/integration**: `npm test` (node:test). Domain suites: `test:crm`,
  `test:visitor`, `test:e2e`, plus MCP OAuth (`tests/denizen-mcp-oauth.test.js`).
- **Smoke suite**: `npm run smoke:all` aggregates `smoke:{crm,phone,mesh,
  hardware,credits,desktop,onboarding,spine,nas,self-heal}` — many hit a running
  server / live Supabase.
- **Probes** (`scripts/`): Playwright UX probes (phone-ui, identity, CRM session,
  group-chat, mobile-ceo-smoke) and ops scripts (identity-audit, scrub-host-flags).
- **CRM frontend**: `vitest` in `crm/vendor`; build with `npm run build:crm`.

---

## 9. Tech stack summary

| Layer | Tech |
|---|---|
| Game client | Phaser 3, vanilla JS, HTML5 canvas |
| CRM client | Vite, React, TypeScript, shadcn/ui, Tailwind, TanStack Query |
| Server | Node.js (raw `http`), `ws` WebSockets |
| Data | Supabase / PostgreSQL via PostgREST |
| AI | LM Studio (local) + cloud LLMs; OpenClaw gateway; MCP (server + client) |
| Desktop | Electron + auto-updater |
| Browser ext | Chrome (Manifest V3) |
| Edge / net | Cloudflare Tunnel, Tailscale |
| Voice | ElevenLabs |
| Payments | Stripe (CRM quote portal) |
| Email | Resend (outbound), Gmail (inbound/agent) |
| Automation | nut-js (desktop control), Playwright (probes) |
```
