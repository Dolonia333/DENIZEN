# DENIZEN

**Real-time visual observability layer for AI agents.** Watch autonomous AI agents collaborate, communicate, and execute tasks in a pixel-art office — every agent action rendered as NPC behavior you can see.

![Denizen Preview](denizen/assets/ref_Hu4Gzs.png)

> The project itself lives in [`denizen/`](denizen/) — that subdirectory is the actual application. The full documentation, including the deep dive on every feature, lives at **[denizen/README.md](denizen/README.md)**.

---

## The 30-second version

Denizen renders AI agent workflows as a living pixel-art office. 16 NPCs are real AI agents — each one has a personality (`SOUL.md`), a persistent memory (`MEMORY.md`), and a job. They walk around, talk, sit at desks, run meetings, write reports, file bug reports, and execute real tools — and you watch them do it in real time. Instead of staring at terminal logs or dashboards, you see the *shape* of what your agents are doing.

**Built with:** Node.js 22+, Phaser 3, WebSocket, LM Studio (local), Claude / Grok / Gemini / Kimi (cloud), Kali Linux (security investigations).

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
- **Phase 5 spec** — Continuous improvement loop where Abby teaches the team to get better over time. Detailed in [denizen/docs/ROADMAP.md](denizen/docs/ROADMAP.md).

See [denizen/docs/ROADMAP.md](denizen/docs/ROADMAP.md) for the full capability matrix and build order.

## Documentation

| Doc | Contents |
|-----|----------|
| **[denizen/README.md](denizen/README.md)** | The full README — installation, configuration, every feature, troubleshooting, performance tuning. **Start here.** |
| [denizen/docs/NPCS.md](denizen/docs/NPCS.md) | Full 16-NPC roster — personality, hierarchy, capabilities, model choices |
| [denizen/docs/ROADMAP.md](denizen/docs/ROADMAP.md) | Capability roadmap — Phases 1–5, what's done, what's next |
| [denizen/docs/ARCHITECTURE.md](denizen/docs/ARCHITECTURE.md) | Whole-system topology — browser ↔ server ↔ LM Studio, decision loops, WS message types |
| [denizen/docs/AI-SYSTEM.md](denizen/docs/AI-SYSTEM.md) | NPC intelligence layer — goals, plans, theory of mind, memory tags |
| [denizen/docs/WORLD-STATE.md](denizen/docs/WORLD-STATE.md) | Single source of truth + outbound webhooks (Supabase, n8n) |
| [denizen/docs/VOICE.md](denizen/docs/VOICE.md) | ElevenLabs per-NPC voice + presence gating |
| [denizen/docs/VOICE_INPUT.md](denizen/docs/VOICE_INPUT.md) | Push-to-talk STT + action classifier |
| [denizen/docs/SETUP.md](denizen/docs/SETUP.md) | End-to-end install with optional security feeders |

## Why NPCs?

Denizen isn't a game. The NPCs aren't decoration — each one is a real AI agent doing a specific job. The point: AI agent workflows are easier to debug, monitor, and trust when you can *see* them. A two-second glance at the office tells you what's blocked, who's escalated, what's chained together. A log dashboard couldn't tell you the same in two minutes.

See [denizen/README.md → Why NPCs?](denizen/README.md#why-npcs-the-design-philosophy) for the design philosophy and how to remap the roster to any business (customer support, sales pipeline, research lab, trading desk, hospital ops).

## License

Code: **MIT with Commons Clause v1.0**. You can use, modify, and redistribute freely — you just can't sell hosted/managed versions of Denizen itself. Full terms in [`denizen/LICENSE`](denizen/LICENSE).

Art assets: [LimeZu Modern Office](https://limezu.itch.io/) — see their license terms.
