# Denizen Documentation Index

This is the canonical map of Denizen documentation across committed GitHub docs and current local/new docs.

**Status key**
- `on GitHub` = present in `git ls-files denizen/docs/`
- `new/local` = not currently tracked in `git ls-files denizen/docs/` (local-only or in-progress)

## Master Documentation Table

| Category | Document | Status | Description |
|----------|----------|--------|-------------|
| Getting Started | [SETUP.md](SETUP.md) | on GitHub | End-to-end local setup and runtime prerequisites |
| Getting Started | [VISITOR_ONBOARDING.md](VISITOR_ONBOARDING.md) | new/local | New-contributor onboarding path and first-run workflow |
| Getting Started | [SCENE_BUILDING_MANUAL.md](SCENE_BUILDING_MANUAL.md) | new/local | Non-coder's manual — press `E` to cut, label & place sprites and build rooms/boundaries by hand |
| Architecture | [ARCHITECTURE.md](ARCHITECTURE.md) | on GitHub | Runtime topology, core services, and message flow |
| Architecture | [SCENE.md](SCENE.md) | on GitHub | `office-scene.js` layout and ownership map |
| Architecture | [ACTIONS.md](ACTIONS.md) | on GitHub | NPC action vocabulary and execution semantics |
| Architecture | [AGENT_BUS.md](AGENT_BUS.md) | on GitHub | Agent-to-agent messaging bus behavior and rules |
| Architecture | [WORLD_ENGINE.md](WORLD_ENGINE.md) | on GitHub | World engine generation/runtime primitives |
| Architecture | [ROOM_GENERATOR.md](ROOM_GENERATOR.md) | on GitHub | Procedural room generation and archetypes |
| Architecture | [CITY_GENERATOR.md](CITY_GENERATOR.md) | on GitHub | City generation pipeline and API integration |
| Architecture | [WORKSPACE_ARCHITECTURE.md](WORKSPACE_ARCHITECTURE.md) | on GitHub | **Canonical** workspace module/layout map and ownership boundaries |
| Architecture | [SERVER.md](SERVER.md) | on GitHub | `server.js` route/module map (~7,700-line monolith index) |
| Architecture | [../../MONOREPO.md](../../MONOREPO.md) | on GitHub | Repo-wide layout — denizen, infra, VisionClaw, openclaw, root scripts |
| Intelligence/Data | [AI-SYSTEM.md](AI-SYSTEM.md) | on GitHub | NPC planning, memory, and decision loops |
| Intelligence/Data | [AWARENESS.md](AWARENESS.md) | on GitHub | Prompt-time awareness features and context signals |
| Intelligence/Data | [WORLD-STATE.md](WORLD-STATE.md) | on GitHub | Shared world state model and update semantics |
| Intelligence/Data | [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | on GitHub | Data model and storage schema definitions |
| Intelligence/Data | [INTELLIGENCE_SPINE.md](INTELLIGENCE_SPINE.md) | new/local | Facts → outcomes → predictions loop, v1.1/v1.2 spine, APIs |
| Intelligence/Data | [MIROFISH_PREDICTION.md](MIROFISH_PREDICTION.md) | new/local | MiroFish HTTP integration, heuristic fallback, sync endpoints |
| Integrations | [OPENCLAW_INTEGRATION.md](OPENCLAW_INTEGRATION.md) | on GitHub | OpenClaw bridge integration and event routing |
| Integrations | [EMAIL_INTEGRATION.md](EMAIL_INTEGRATION.md) | on GitHub | Lucy inbound/outbound email workflow and guardrails |
| Integrations | [ROBINHOOD_LIVE.md](ROBINHOOD_LIVE.md) | on GitHub | Robinhood live integration behavior and constraints |
| Integrations | [JELLY_INTEGRATION.md](JELLY_INTEGRATION.md) | new/local | Jelly skill executor, supabase-bridge, denizen-data-actions |
| Integrations | [FEDERAL_PIPELINE.md](FEDERAL_PIPELINE.md) | new/local | RFP pipeline, requirement review, org-gated briefing strip |
| Integrations | [JOB_CRM.md](JOB_CRM.md) | new/local | Roki job applications, Supabase sync, facts trigger |
| Meridian CRM (Deal Weaver) | [../crm/USER_GUIDE.md](../crm/USER_GUIDE.md) | new/local | Full UI guide — every tab and button |
| Meridian CRM (technical) | [../crm/ARCHITECTURE.md](../crm/ARCHITECTURE.md) | new/local | API, sync, real vs UI-only features |
| Integrations | [NPC_MCP_GATEWAY.md](NPC_MCP_GATEWAY.md) | new/local | Per-NPC MCP gateway, bearer tokens, memory sync (v1.3) |
| Integrations | [NPC_COMPANION.md](NPC_COMPANION.md) | new/local | Browser extension companion — provider-agnostic sync (v1.6) |
| NPCs/AI | [NPCS.md](NPCS.md) | on GitHub | Full NPC roster and role definitions |
| NPCs/AI | [SOCIAL_BEHAVIOR.md](SOCIAL_BEHAVIOR.md) | on GitHub | Social interaction heuristics and behaviors |
| NPCs/AI | [VOICE.md](VOICE.md) | on GitHub | TTS architecture, gating, and voice configuration |
| NPCs/AI | [VOICE_INPUT.md](VOICE_INPUT.md) | on GitHub | STT and action dispatch entry points |
| NPCs/AI | [SOUL_REFLECTION.md](SOUL_REFLECTION.md) | on GitHub | SOUL reflection and proposal loop lifecycle |
| World/Assets | [FULL_WORLD.md](FULL_WORLD.md) | new/local | Multi-zone LimeZu world composition guide |
| World/Assets | [LIMEZU_PLACEMENT.md](LIMEZU_PLACEMENT.md) | new/local | Practical placement rules for LimeZu packs |
| World/Assets | [SPRITE_FIX_GUIDE.md](SPRITE_FIX_GUIDE.md) | new/local | Sprite artifact diagnosis and correction playbook |
| World/Assets | [ANIMATION_FORGE.md](ANIMATION_FORGE.md) | on GitHub | Animation proposal workflow and review process |
| World/Assets | [PATHFINDING.md](PATHFINDING.md) | on GitHub | A* pathing internals and stuck recovery |
| World/Assets | [SCRIPTS.md](SCRIPTS.md) | on GitHub | Asset/build script reference, ops smokes, catalog pipeline |
| World/Assets | [CATALOG_WORKFLOW.md](CATALOG_WORKFLOW.md) | new/local | Openplan furniture catalog extract → label → validate → ship |
| NPCs/AI | [VISITOR_UI.md](VISITOR_UI.md) | on GitHub | Visitor/mobile UI — compute panel, credits, dock chips, desktop pairing |
| Security | [SECURITY.md](SECURITY.md) | on GitHub | Threat model, monitors, and security controls |
| Operations | [COMPUTE_MESH.md](COMPUTE_MESH.md) | new/local | Distributed compute mesh — queue, fleet agents, APIs, smokes |
| Operations | [../../infra/README.md](../../infra/README.md) | new/local | Home lab infra — NAS SSH, Kali pull install, Tailscale, orchestrator |
| Operations | [PRODUCTION_DEPLOY.md](PRODUCTION_DEPLOY.md) | on GitHub | Production deployment guidance and runbook |
| Operations | [ROADMAP.md](ROADMAP.md) | on GitHub | Capability delivery roadmap by phase |
| Operations | [ROADMAP_SELF_ADVANCEMENT.md](ROADMAP_SELF_ADVANCEMENT.md) | on GitHub | Self-improvement roadmap and governance |
| Operations | [HARNESS_EVALUATION.md](HARNESS_EVALUATION.md) | on GitHub | Evaluation harness behavior and criteria |
| Operations | [PROPOSAL_REVIEW.md](PROPOSAL_REVIEW.md) | on GitHub | Operator review workflow for queued proposals |
| Operations | [TESTING.md](TESTING.md) | new/local | Test pyramid, smoke scripts, pre-deploy checklist |
| Operations | [RUNTIME_DATA.md](RUNTIME_DATA.md) | new/local | Runtime-mutated data/reports map, PII handling, cleanup/reset guidance |
| NPCs/AI | [CAPABILITY_PROPOSALS.md](CAPABILITY_PROPOSALS.md) | on GitHub | NPC capability request and approval workflow |
| World/Assets | [SFX.md](SFX.md) | on GitHub | Sound effects catalog and playback hooks |
| Session Notes | [SESSION_2026-06-05.md](SESSION_2026-06-05.md) | new/local | Session log for Jelly migration and model tuning |

## Documentation Gaps Closed In This Pass (2026-06-08)

| Gap | Resolution |
|-----|------------|
| Compute mesh undocumented | [COMPUTE_MESH.md](COMPUTE_MESH.md) — full architecture, deploy, troubleshooting |
| infra/ scripts undocumented | [../../infra/README.md](../../infra/README.md) — NAS, Kali, Tailscale, `finish-all-mesh.py` |
| Mesh smoke tests not in TESTING.md | Updated [TESTING.md](TESTING.md) |
| Desktop compute worker thin | Updated [../desktop/README.md](../desktop/README.md) |
| No repo-wide layout doc | [../../MONOREPO.md](../../MONOREPO.md) — denizen, infra, VisionClaw, openclaw, root scripts |
| `server.js` too large to navigate | [SERVER.md](SERVER.md) — route/module map |
| Visitor UI modules scattered | [VISITOR_UI.md](VISITOR_UI.md) — browser visitor layer |
| Openplan catalog pipeline undocumented | [CATALOG_WORKFLOW.md](CATALOG_WORKFLOW.md) + catalog sections in [SCRIPTS.md](SCRIPTS.md) |
| Module map status unclear | [WORKSPACE_ARCHITECTURE.md](WORKSPACE_ARCHITECTURE.md) marked **canonical** (on GitHub) |

## Documentation Gaps Closed (2026-06-06)

| Gap | Resolution |
|-----|------------|
| Intelligence spine undocumented on GitHub | [INTELLIGENCE_SPINE.md](INTELLIGENCE_SPINE.md) — full facts/outcomes/predictions loop |
| Visitor team vs demo auth | [VISITOR_ONBOARDING.md](VISITOR_ONBOARDING.md) |
| v1.2 integrations (MiroFish, federal, job CRM, Jelly) | Dedicated integration docs + expanded [ROBINHOOD_LIVE.md](ROBINHOOD_LIVE.md) |
| Ops scripts undocumented | [SCRIPTS.md](SCRIPTS.md) ops section + [TESTING.md](TESTING.md) |
| Production deploy thin | Expanded [PRODUCTION_DEPLOY.md](PRODUCTION_DEPLOY.md) |
| Schema missing trading/org-bridge tables | Updated [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) |
| Local-only world/session docs invisible | Indexed [FULL_WORLD.md](FULL_WORLD.md), [SESSION_2026-06-05.md](SESSION_2026-06-05.md), etc. |
| No master index | This file — start here for any doc lookup |

## Recommended Reading Order

### New Contributors
1. [SETUP.md](SETUP.md)
2. [VISITOR_ONBOARDING.md](VISITOR_ONBOARDING.md)
3. [ARCHITECTURE.md](ARCHITECTURE.md)
4. [NPCS.md](NPCS.md)
5. [AI-SYSTEM.md](AI-SYSTEM.md)
6. [FULL_WORLD.md](FULL_WORLD.md)

### Operators
1. [../../MONOREPO.md](../../MONOREPO.md) — repo layout and where things live
2. [COMPUTE_MESH.md](COMPUTE_MESH.md)
3. [../../infra/README.md](../../infra/README.md)
4. [PRODUCTION_DEPLOY.md](PRODUCTION_DEPLOY.md)
5. [TESTING.md](TESTING.md) — unit tests + mesh/desktop smokes
6. [SERVER.md](SERVER.md) — route map for live debugging
7. [SECURITY.md](SECURITY.md)
8. [VISITOR_ONBOARDING.md](VISITOR_ONBOARDING.md)
9. [ROBINHOOD_LIVE.md](ROBINHOOD_LIVE.md)

### Developers
1. [../../MONOREPO.md](../../MONOREPO.md) — repo layout
2. [WORKSPACE_ARCHITECTURE.md](WORKSPACE_ARCHITECTURE.md) — **canonical** module map
3. [SERVER.md](SERVER.md) — `server.js` routes and middleware
4. [ARCHITECTURE.md](ARCHITECTURE.md) — runtime topology
5. [SCENE.md](SCENE.md) → [ACTIONS.md](ACTIONS.md) → [AGENT_BUS.md](AGENT_BUS.md)
6. [AI-SYSTEM.md](AI-SYSTEM.md) → [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)
7. [VISITOR_UI.md](VISITOR_UI.md) → [VISITOR_ONBOARDING.md](VISITOR_ONBOARDING.md)
8. [JELLY_INTEGRATION.md](JELLY_INTEGRATION.md)
9. [CATALOG_WORKFLOW.md](CATALOG_WORKFLOW.md) → [SCRIPTS.md](SCRIPTS.md)
10. [TESTING.md](TESTING.md)
