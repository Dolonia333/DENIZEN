# Jelly Integration (v1.2)

Jelly is Denizen's skill runtime and dispatcher. In v1.2 it became the default execution path for NPC skills, replacing the old OpenClaw gateway-centric dispatch model.

## What Changed in v1.2

Before:

- Skill routing depended on OpenClaw gateway paths and inline dispatch patterns.

Now:

- `jelly/index.js` exposes `createJelly()`
- `jelly/skill-executor.js` executes skills (native in-process or legacy subprocess)
- Denizen routes NPC `run_skill` work through Jelly first
- OpenClaw gateway behavior is optional compatibility mode instead of the core path

This is called out in:

- [Architecture](ARCHITECTURE.md)
- [Session Log 2026-06-05](SESSION_2026-06-05.md)

## Jelly Runtime Surface

Key files:

- `jelly/index.js`
  - `createJelly()`, skill listing/registration, run orchestration
- `jelly/skill-registry.js`
  - Skill discovery + aliases
- `jelly/skill-executor.js`
  - Native runs + legacy subprocess bridge
- `jelly/config-loader.js`, `jelly/config-provider.js`
  - Config load and shared access
- `jelly/paths.js`
  - Path/home conventions for Jelly state

## Supabase Bridge + Data Actions

v1.2 business/intelligence data actions are mediated by Jelly bridge modules:

- `jelly/lib/bridge-client.js`
  - Secure-bridge HTTP client (`/query`, `/insert`, `/update`, `/health`)
  - Enforces org slug headers and blocks demo-org access to restricted business tables
- `jelly/lib/denizen-data-actions.js`
  - Action catalog used by NPC skills:
    - intake/lead/federal/proposal/prediction/client/outcome/work/cost/entity actions
    - includes `rfp-status`, `rfp-requirement-review`, `rfp-pipeline-summary`, `proposal-outline`
  - Applies org policy guardrails via `assertBusinessActionAllowed(...)`

## Service Startup and Config

Config roots:

- `apps/office/config/jelly.json` (primary)
- legacy fallback paths are still supported for migration safety

Sidecar launcher:

- `scripts/start-jelly-services.ps1`
  - starts Supabase secure bridge on `:18790`
  - starts BrowserClaw on `:18792`

Run flow:

1. Start sidecars with `scripts/start-jelly-services.ps1`
2. Start Denizen (`npm start`)
3. Jelly skill dispatch is available to NPC runtime loops

## Route and MCP Integration Surfaces

### Route Registry

`src/route-registry.js` centralizes API hooks that expose integration outputs, including:

- market data/watchlist/trade suggestion routes
- federal pipeline summary route
- intelligence route handler registration bridge
- job CRM maintenance route

This file acts as the aggregation layer between server request handling and integration modules.

### Generic MCP Connector

`src/mcp/denizen-mcp-connector.js` provides a generic MCP JSON-RPC client surface:

- server discovery from `data/mcp-servers.json`
- `initializeServer()`, `listTools()`, `callTool()`
- session-id handling for streamable MCP servers
- read-only protection for configured read-only servers

This is the non-domain-specific MCP plumbing used to discover and invoke external MCP tools from Denizen runtime code.

## Jelly Folder Structure (Integration-Relevant)

- `jelly/`
  - core runtime (`index.js`, registry, executor, config, paths)
- `jelly/lib/`
  - shared bridge and denizen data actions
- `jelly/skills/`
  - native in-process skills
- `jelly/vendor/skills/`
  - vendored legacy skill scripts for subprocess compatibility
- `jelly/services/`
  - sidecar services (`supabase-bridge`, `browserclaw`)

## Related Integration Docs

- [MiroFish Prediction](MIROFISH_PREDICTION.md)
- [Federal Pipeline](FEDERAL_PIPELINE.md)
- [Job CRM](JOB_CRM.md)
- [Robinhood Live](ROBINHOOD_LIVE.md)
- [Architecture](ARCHITECTURE.md)
- [Session Log 2026-06-05](SESSION_2026-06-05.md)
- [OpenClaw Integration (legacy)](OPENCLAW_INTEGRATION.md)
