# `src/` layout

After the repo reorganization, runtime modules live under domain folders instead of a flat `src/*.js` list.

## Top-level `src/` (bootstrap only)

These stay at `src/` root because they load first or are cross-cutting:

| File | Role |
|------|------|
| `load-env.js` | Env bootstrap |
| `logger.js` | Structured logger |
| `world-state.js` | In-memory office state |
| `agent-bus.js` | Internal message bus |
| `pathfinding.js` | A* movement |
| `denizen-lazy-scripts.js` | Deferred browser script loader |
| `route-registry.js` | HTTP route table |
| `openclaw-*.js`, `gateway-bridge.js` | OpenClaw integration entrypoints |

## Domain folders

| Folder | Contents |
|--------|----------|
| `auth/` | Team/visitor auth, org policy, user identity |
| `compute/` | Mesh jobs, credits, inference, hardware, VM sandbox |
| `core/` | Shared helpers, NPC MCP gateway |
| `crm/` | CRM backend modules |
| `desktop/` | Desktop pairing and download helpers |
| `hud/` | Browser HUD — dock, phone UI, panels, player chat |
| `hud/panels/` | Lazy-loaded panel modules |
| `integrations/` | n8n, LM Studio, Robinhood, fleet agents |
| `intelligence/` | DB gateway, telemetry, predictions, research |
| `mcp/` | MCP OAuth, team gateway, tool surfaces |
| `npc/` | Brains, roster, agent actions, office manager |
| `office-hq/` | Office level, quests, achievements, HQ panels |
| `pipelines/` | Jobs, tasks, email, soul/capability proposals |
| `security/` | Bouncer, screen watch, permissions |
| `station/` | Denizen Station router and task queue |
| `visitors/` | Visitor session, onboarding, briefing, MCP connect |
| `voice/` | TTS, proximity audio, voice input |

## Existing sub-trees (unchanged)

| Folder | Contents |
|--------|----------|
| `routes/` | HTTP route handlers split from `server.js` |
| `city/` | City generator / Phaser city mode |
| `world/` | Procedural world modules (ESM) |

## Path conventions

- **Server:** `require('./src/<domain>/<module>')` from `server.js`
- **Browser:** `./src/<domain>/<module>.js` in `index.html` and `denizen-lazy-scripts.js`
- **App-root assets:** modules under `src/<domain>/` use `path.join(__dirname, '..', '..', 'data' | 'npcs' | …)` to reach `data/`, `npcs/`, `jelly/`, etc.

Reorganization scripts (for reference): `scripts/reorganize-src.mjs`, `scripts/fix-src-paths.mjs`, `scripts/fix-relative-requires.mjs`, `scripts/fix-app-root-paths.mjs`.
