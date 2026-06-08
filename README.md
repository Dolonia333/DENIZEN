# DENIZEN

**Real-time visual observability layer for AI agents.** Watch autonomous AI agents collaborate, communicate, and execute tasks in a pixel-art office — every agent action rendered as NPC behavior you can see.

![Denizen Preview](denizen/assets/ref_Hu4Gzs.png)

> The project itself lives in [`denizen/`](denizen/) — that subdirectory is the actual application. The full documentation, including the deep dive on every feature, lives at **[denizen/README.md](denizen/README.md)**.

---

## The 30-second version

Denizen renders AI agent workflows as a living pixel-art office. 16 NPCs are real AI agents — each one has a personality (`SOUL.md`), a persistent memory (`MEMORY.md`), and a job. They walk around, talk, sit at desks, run meetings, write reports, file bug reports, and execute real tools — and you watch them do it in real time. Instead of staring at terminal logs or dashboards, you see the *shape* of what your agents are doing.

**Built with:** Node.js 22+, Phaser 3, WebSocket, LM Studio (local), Claude / Grok / Gemini / Kimi (cloud), Kali Linux (security + compute mesh), Tailscale (home fleet).

## Quick Start

```bash
git clone https://github.com/Dolonia333/DENIZEN.git
cd DENIZEN/denizen
npm install
npm start
```

Open **http://localhost:8080**. You should see 16 NPCs moving around, talking, taking breaks.

No API keys needed — Denizen runs in zero-config demo mode out of the box with smart scripted fallback responses. Configure real AI providers (Claude, Grok, LM Studio) for live agent behavior. See [denizen/README.md → Configuration](denizen/README.md#configuration) for setup.

## What's actually shipping today

The recent push moved Denizen from "watch agents work" to "agents who actually get work done":

- **Phase 1** — Mood system, directive inbox, OpenClaw skill bridge (NPCs can execute real tools), full SOULs for Marcus + Sarah
- **Phase 2** — Lucy email auto-send + 7-step job pipeline, Bouncer structured Kali investigations with Dan escalation, Work Output Feed UI (Tab key)
- **Phase 3** — NPCs run Claude Code on real files (isolated worktrees + human-approval gate), multi-step task chains (spec→design→code→review→QA), NPC disagreement detection → Abby arbitrates
- **Compute mesh** — Three-node home fleet (dolonia GPU host, Synology NAS, Kali laptop): shared job queue, fleet metrics, Denizen Desktop contributor nodes, mesh jobs UI. See [denizen/docs/COMPUTE_MESH.md](denizen/docs/COMPUTE_MESH.md).
- **Phase 5 spec** — Continuous improvement loop where Abby teaches the team to get better over time. Detailed in [denizen/docs/ROADMAP.md](denizen/docs/ROADMAP.md).

See [denizen/docs/ROADMAP.md](denizen/docs/ROADMAP.md) for the full capability matrix and build order.

## Documentation

| Doc | Contents |
|-----|----------|
| **[denizen/README.md](denizen/README.md)** | Full project README with architecture, runtime systems, APIs, and operations |
| **[denizen/docs/DOCS_INDEX.md](denizen/docs/DOCS_INDEX.md)** | Master documentation map with categories and GitHub vs local/new status |
| **[denizen/docs/WORKSPACE_ARCHITECTURE.md](denizen/docs/WORKSPACE_ARCHITECTURE.md)** | Every folder/file — purpose, why it exists, how it works |
| **[denizen/docs/RUNTIME_DATA.md](denizen/docs/RUNTIME_DATA.md)** | Runtime JSON & reports — writers, readers, PII policy, cleanup |
| [denizen/docs/SETUP.md](denizen/docs/SETUP.md) | End-to-end install and environment configuration |
| [denizen/docs/VISITOR_ONBOARDING.md](denizen/docs/VISITOR_ONBOARDING.md) | Team vs demo visitor auth, session tokens, CEO path |
| [denizen/docs/ARCHITECTURE.md](denizen/docs/ARCHITECTURE.md) | Runtime topology and component relationships |
| [denizen/docs/AI-SYSTEM.md](denizen/docs/AI-SYSTEM.md) | NPC intelligence, planning, and memory behaviors |
| [denizen/docs/WORLD-STATE.md](denizen/docs/WORLD-STATE.md) | Shared world-state model and outbound events |
| [denizen/docs/INTELLIGENCE_SPINE.md](denizen/docs/INTELLIGENCE_SPINE.md) | Facts → outcomes → predictions loop (v1.1/v1.2) |
| [denizen/docs/DATABASE_SCHEMA.md](denizen/docs/DATABASE_SCHEMA.md) | Database schema, entities, and relationships |
| [denizen/docs/MIROFISH_PREDICTION.md](denizen/docs/MIROFISH_PREDICTION.md) | MiroFish HTTP integration and heuristic fallback |
| [denizen/docs/OPENCLAW_INTEGRATION.md](denizen/docs/OPENCLAW_INTEGRATION.md) | OpenClaw bridge and runtime behavior |
| [denizen/docs/JELLY_INTEGRATION.md](denizen/docs/JELLY_INTEGRATION.md) | Jelly skill executor and supabase-bridge |
| [denizen/docs/EMAIL_INTEGRATION.md](denizen/docs/EMAIL_INTEGRATION.md) | Lucy email ingestion, gating, and automation |
| [denizen/docs/JOB_CRM.md](denizen/docs/JOB_CRM.md) | Roki job applications and Supabase sync |
| [denizen/docs/FEDERAL_PIPELINE.md](denizen/docs/FEDERAL_PIPELINE.md) | Federal RFP pipeline and org-gated briefing |
| [denizen/docs/ROBINHOOD_LIVE.md](denizen/docs/ROBINHOOD_LIVE.md) | Robinhood live integration and operational caveats |
| [denizen/docs/NPCS.md](denizen/docs/NPCS.md) | NPC roster, personalities, roles, and capabilities |
| [denizen/docs/VOICE.md](denizen/docs/VOICE.md) | TTS architecture and presence gating |
| [denizen/docs/VOICE_INPUT.md](denizen/docs/VOICE_INPUT.md) | Push-to-talk speech input and action routing |
| [denizen/docs/FULL_WORLD.md](denizen/docs/FULL_WORLD.md) | Multi-zone LimeZu world assembly guide *(local)* |
| [denizen/docs/LIMEZU_PLACEMENT.md](denizen/docs/LIMEZU_PLACEMENT.md) | LimeZu placement and layering guide *(local)* |
| [denizen/docs/SPRITE_FIX_GUIDE.md](denizen/docs/SPRITE_FIX_GUIDE.md) | Sprite troubleshooting and correction workflow *(local)* |
| [denizen/docs/SECURITY.md](denizen/docs/SECURITY.md) | Threat categories, detection, and response flow |
| [denizen/docs/COMPUTE_MESH.md](denizen/docs/COMPUTE_MESH.md) | Distributed compute mesh — job queue, fleet agents, NAS/Kali/Desktop deploy |
| [infra/README.md](infra/README.md) | Home lab infrastructure — NAS SSH, Kali pull install, Tailscale, migrations |
| [denizen/docs/PRODUCTION_DEPLOY.md](denizen/docs/PRODUCTION_DEPLOY.md) | Production deployment checklist and runbook |
| [denizen/docs/TESTING.md](denizen/docs/TESTING.md) | Test pyramid, smoke scripts, pre-deploy checklist |
| [denizen/desktop/README.md](denizen/desktop/README.md) | Denizen Desktop — setup wizard, compute contributor node, Windows installer |
| [denizen/docs/SESSION_2026-06-05.md](denizen/docs/SESSION_2026-06-05.md) | Session log for Jelly migration and provider rebalance *(local)* |
| [denizen/docs/ROADMAP.md](denizen/docs/ROADMAP.md) | Capability roadmap and delivery phases |

## Why NPCs?

Denizen isn't a game. The NPCs aren't decoration — each one is a real AI agent doing a specific job. The point: AI agent workflows are easier to debug, monitor, and trust when you can *see* them. A two-second glance at the office tells you what's blocked, who's escalated, what's chained together. A log dashboard couldn't tell you the same in two minutes.

See [denizen/README.md → Why NPCs?](denizen/README.md#why-npcs-the-design-philosophy) for the design philosophy and how to remap the roster to any business (customer support, sales pipeline, research lab, trading desk, hospital ops).

## License

Code: **MIT with Commons Clause v1.0**. You can use, modify, and redistribute freely — you just can't sell hosted/managed versions of Denizen itself. Full terms in [`denizen/LICENSE`](denizen/LICENSE).

Art assets: [LimeZu Modern Office](https://limezu.itch.io/) — see their license terms.
