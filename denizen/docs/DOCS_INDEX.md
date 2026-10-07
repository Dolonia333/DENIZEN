# Denizen Documentation Index

This is the canonical map of Denizen documentation across committed GitHub docs and current local/new docs.

**Status key**
- `on GitHub` = present in `git ls-files denizen/docs/`
- `new/local` = not currently tracked in `git ls-files denizen/docs/` (local-only or in-progress)

## Master Documentation Table

| Category | Document | Status | Description |
|----------|----------|--------|-------------|
| Overview | [TECHNICAL_DOSSIER.md](TECHNICAL_DOSSIER.md) | new/local | **Start here (anyone)** — maintained source of record for the branded dossier (**v1.8.0**): architecture, PRD, maintenance manual, builder profile, verification appendix, defect register. Headlines pinned to current master; renders to PDF via `pdf-dossier` |
| Overview | [TECHNICAL_OVERVIEW.md](TECHNICAL_OVERVIEW.md) | new/local | **Start here (engineers)** — whole-platform architecture, subsystems, data model, API surface, deploy |
| Overview | [PRODUCT_MANUAL.md](PRODUCT_MANUAL.md) | new/local | **Start here (users)** — landing→demo, office, NPCs, phone, MCP, CRM, compute |
| Overview | [PRD.md](PRD.md) | new/local | **Start here (product)** — vision, personas, goals, functional requirements, metrics, risks, roadmap |
| Overview | [CURRENT_IMPLEMENTATION_STATUS.md](CURRENT_IMPLEMENTATION_STATUS.md) | new/local | **Current truth / gap inventory** — verified implemented, conditional, partial, missing, tests, and live deployment state |
| Getting Started | [SETUP.md](SETUP.md) | on GitHub | End-to-end local setup and runtime prerequisites |
| Getting Started | [VISITOR_ONBOARDING.md](VISITOR_ONBOARDING.md) | new/local | New-contributor onboarding path and first-run workflow |
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
| Integrations | [DISCORD_BOT_AND_SPACES.md](DISCORD_BOT_AND_SPACES.md) | new/local | Discord bot + Spaces — presence, react/`,eat`, music (Lavalink), Last.fm, free `,log`, avatar, hangout |
| Integrations | [DISCORD_PAID_TIER.md](DISCORD_PAID_TIER.md) | new/local | Guild Pro/Ultra Stripe, pet entitlements, module gates (premium: security/avatar/community) |
| Integrations | [DISCORD_SPACES_POLISH_PLAN.md](DISCORD_SPACES_POLISH_PLAN.md) | new/local | Map polish phases — elevators, bubbles, doors, Phase G map social shipped |
| Operations | [OPS_LIVE_STACK.md](OPS_LIVE_STACK.md) | new/local | Live NAS Discord / CRM / Dolonia ops map |
| Integrations | [EMAIL_INTEGRATION.md](EMAIL_INTEGRATION.md) | on GitHub | Lucy inbound/outbound email workflow and guardrails |
| Integrations | [ROBINHOOD_LIVE.md](ROBINHOOD_LIVE.md) | on GitHub | Robinhood live integration behavior and constraints |
| Strategy | [A_PLUS_PLAN.md](A_PLUS_PLAN.md) | new/local | Raise every pillar to A+ — phases, metrics, anti-goals, S1 backlog |
| Integrations | [DENIZEN_HARNESS.md](DENIZEN_HARNESS.md) | new/local | Denizen AI control plane — complete(), tiers, loops, Jelly tools, learning |
| Integrations | [JELLY_INTEGRATION.md](JELLY_INTEGRATION.md) | new/local | Jelly skill executor, supabase-bridge, denizen-data-actions |
| Integrations | [FEDERAL_PIPELINE.md](FEDERAL_PIPELINE.md) | new/local | RFP pipeline, requirement review, org-gated briefing strip |
| Integrations | [JOB_CRM.md](JOB_CRM.md) | new/local | Roki job applications, Supabase sync, facts trigger |
| Meridian CRM (Deal Weaver) | [../crm/USER_GUIDE.md](../crm/USER_GUIDE.md) | new/local | Full UI guide — every tab and button |
| Meridian CRM (technical) | [../crm/ARCHITECTURE.md](../crm/ARCHITECTURE.md) | new/local | API, sync, real vs UI-only features |
| Integrations | [NPC_MCP_GATEWAY.md](NPC_MCP_GATEWAY.md) | new/local | Per-NPC MCP gateway, bearer tokens, memory sync (v1.3) |
| Integrations | [BROWSER_EYES_WORKFLOW.md](BROWSER_EYES_WORKFLOW.md) | new/local | ChatGPT-as-eyes browserBegin/browserStep verify loop (no API keys) |
| Integrations | [GROK_DENIZEN_AUTONOMY.md](GROK_DENIZEN_AUTONOMY.md) | new/local | xAI Responses API → Grok NPC MCP autonomy loop |
| Integrations | [GROK_BUILD.md](GROK_BUILD.md) | new/local | Grok Build terminal agent + Denizen MCP |
| Integrations | [NPC_COMPANION.md](NPC_COMPANION.md) | new/local | Browser extension companion — provider-agnostic sync (v1.6) |
| NPCs/AI | [NPCS.md](NPCS.md) | on GitHub | Full NPC roster and role definitions |
| NPCs/AI | [SOCIAL_BEHAVIOR.md](SOCIAL_BEHAVIOR.md) | on GitHub | Social interaction heuristics and behaviors |
| NPCs/AI | [VOICE.md](VOICE.md) | on GitHub | TTS architecture, gating, and voice configuration |
| NPCs/AI | [VOICE_INPUT.md](VOICE_INPUT.md) | on GitHub | STT and action dispatch entry points |
| NPCs/AI | [SOUL_REFLECTION.md](SOUL_REFLECTION.md) | on GitHub | SOUL reflection and proposal loop lifecycle |
| World/Assets | [FULL_WORLD.md](FULL_WORLD.md) | new/local | Multi-zone LimeZu world composition guide |
| World/Assets | [LIMEZU_PLACEMENT.md](LIMEZU_PLACEMENT.md) | new/local | Practical placement rules for LimeZu packs |
| World/Assets | [EXTERIOR-COMPILER.md](EXTERIOR-COMPILER.md) | new/local | Exterior district compiler — spec format, passes A–H, merge integration |
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
| Operations | [MULTI_USER_OFFICE_PLAN.md](MULTI_USER_OFFICE_PLAN.md) | new/local | **Multi-company plan** — DB souls, org-scoped world state, auth routing, fair compute, templates |
| Operations | [EXECUTION_BOARD.md](EXECUTION_BOARD.md) | new/local | Active slices, backlog, verify commands — **start here for execution** |
| Operations | [1921_TEMPLATE.md](1921_TEMPLATE.md) | new/local | 1921 GovCon master template pack (souls + business model) |
| Operations | [BRANDED_DOSSIER_SYSTEM.md](BRANDED_DOSSIER_SYSTEM.md) | new/local | **Canon** — branded PDF dossier skeleton, skins, honesty pass, pdf-dossier skill |
| Operations | [ROADMAP_SELF_ADVANCEMENT.md](ROADMAP_SELF_ADVANCEMENT.md) | on GitHub | Self-improvement roadmap and governance |
| Operations | [HARNESS_EVALUATION.md](HARNESS_EVALUATION.md) | on GitHub | Evaluation harness behavior and criteria |
| Operations | [PROPOSAL_REVIEW.md](PROPOSAL_REVIEW.md) | on GitHub | Operator review workflow for queued proposals |
| Operations | [TESTING.md](TESTING.md) | new/local | Test pyramid, smoke scripts, pre-deploy checklist |
| Operations | [RUNTIME_DATA.md](RUNTIME_DATA.md) | new/local | Runtime-mutated data/reports map, PII handling, cleanup/reset guidance |
| NPCs/AI | [CAPABILITY_PROPOSALS.md](CAPABILITY_PROPOSALS.md) | on GitHub | NPC capability request and approval workflow |
| World/Assets | [SFX.md](SFX.md) | on GitHub | Office SFX + **landing Buzz beep-beep** (Web Audio) |
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
1. [CURRENT_IMPLEMENTATION_STATUS.md](CURRENT_IMPLEMENTATION_STATUS.md) — what is real now and what is not
2. [SETUP.md](SETUP.md)
3. [VISITOR_ONBOARDING.md](VISITOR_ONBOARDING.md)
4. [ARCHITECTURE.md](ARCHITECTURE.md)
5. [NPCS.md](NPCS.md)
6. [AI-SYSTEM.md](AI-SYSTEM.md)
7. [FULL_WORLD.md](FULL_WORLD.md)

### Operators
1. [CURRENT_IMPLEMENTATION_STATUS.md](CURRENT_IMPLEMENTATION_STATUS.md) — current deploy/runtime truth and known gaps
2. [../../MONOREPO.md](../../MONOREPO.md) — repo layout and where things live
3. [COMPUTE_MESH.md](COMPUTE_MESH.md)
4. [../../infra/README.md](../../infra/README.md)
5. [PRODUCTION_DEPLOY.md](PRODUCTION_DEPLOY.md)
6. [TESTING.md](TESTING.md) — unit tests + mesh/desktop smokes
7. [SERVER.md](SERVER.md) — route map for live debugging
8. [SECURITY.md](SECURITY.md)
9. [VISITOR_ONBOARDING.md](VISITOR_ONBOARDING.md)
10. [ROBINHOOD_LIVE.md](ROBINHOOD_LIVE.md)

### Developers
1. [CURRENT_IMPLEMENTATION_STATUS.md](CURRENT_IMPLEMENTATION_STATUS.md) — verified implementation boundary
2. [../../MONOREPO.md](../../MONOREPO.md) — repo layout
3. [WORKSPACE_ARCHITECTURE.md](WORKSPACE_ARCHITECTURE.md) — **canonical** module map
4. [SERVER.md](SERVER.md) — `server.js` routes and middleware
5. [ARCHITECTURE.md](ARCHITECTURE.md) — runtime topology
6. [SCENE.md](SCENE.md) → [ACTIONS.md](ACTIONS.md) → [AGENT_BUS.md](AGENT_BUS.md)
7. [AI-SYSTEM.md](AI-SYSTEM.md) → [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)
8. [VISITOR_UI.md](VISITOR_UI.md) → [VISITOR_ONBOARDING.md](VISITOR_ONBOARDING.md)
9. [JELLY_INTEGRATION.md](JELLY_INTEGRATION.md)
10. [CATALOG_WORKFLOW.md](CATALOG_WORKFLOW.md) → [SCRIPTS.md](SCRIPTS.md)
11. [TESTING.md](TESTING.md)
