# Denizen — Architecture

Denizen is a real-time visual observability layer for AI agents. This document describes how the whole system fits together, end-to-end.

> **2026-06-08 update:** [server.js](../server.js) is a ~7,700-line monolith — see [SERVER.md](SERVER.md) for route/module map. Skill dispatch goes through **Jelly** (`jelly/`), not `gateway-bridge.js`. Listen port is `process.env.PORT` (code default `8080`; Dolonia lab uses `8081`). Optional **compute mesh** — shared job queue across dolonia/NAS/Kali/Desktop — see [COMPUTE_MESH.md](COMPUTE_MESH.md).
>
> **2026-06-05 update:** Skill dispatch now goes through **Jelly** (`denizen/jelly/`) instead of the OpenClaw gateway. See [SESSION_2026-06-05.md](SESSION_2026-06-05.md).

## One-sentence summary

A Phaser pixel-art office where 16 NPCs represent AI agents. Each NPC has its own "brain" (an LLM running locally on LM Studio) that decides what to do every few seconds. A parallel security monitor watches real system/network events and spawns robber NPCs when something suspicious happens — so someone who can't read a log can still *see* the threat.

## High-level topology

```
┌─────────────────────────────────────────────────────────────────────┐
│                          BROWSER (Phaser 3)                         │
│                                                                     │
│   ┌─────────────────┐   ┌──────────────────┐   ┌────────────────┐   │
│   │  office-scene   │   │  SecurityMonitor │   │ RobberController│  │
│   │  (16 NPCs)      │   │  (WS client)     │   │  (threat → robr)│  │
│   └────────┬────────┘   └────────┬─────────┘   └───────┬─────────┘  │
│            │                     │                     │            │
│            │ npc_conversation    │                     │            │
│            │ npc_decision        │                     │            │
│            ▼                     ▼                     ▲            │
└────────────┼─────────────────────┼─────────────────────┼────────────┘
             │ ws://host:$PORT/ws  │ /security-ws        │ threat events
             ▼                     ▼                     │
┌─────────────────────────────────────────────────────────────────────┐
│                        NODE SERVER (server.js)                      │
│                                                                     │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────────┐   │
│  │ NpcBrainManager │  │ CofounderAgent   │  │ SecurityMonitor   │   │
│  │ (src/npc-brains)│  │ (CTO director)   │  │ Server            │   │
│  │                 │  │                  │  │                   │   │
│  │ • think()       │  │ • state-reactive │  │ • system poll     │   │
│  │ • getResponse() │  │ • broadcasts     │  │ • network poll    │   │
│  │ • goals/plans   │  │   commands       │  │ • file watchers   │   │
│  │ • theory-of-mind│  │                  │  │ • Linux tshark *  │   │
│  │ • event feed    │  │                  │  │ • Linux scan det *│   │
│  └────────┬────────┘  └────────┬─────────┘  └─────────┬─────────┘   │
│           │                    │                      │             │
└───────────┼────────────────────┼──────────────────────┼─────────────┘
            │ HTTP               │                      │ Linux-only
            ▼                    ▼                      ▼
  ┌──────────────────┐   ┌──────────────┐   ┌─────────────────────┐
  │ LM Studio local  │   │ (same as     │   │ tshark / journalctl │
  │ (Qwen2.5-14B)    │   │  left)       │   │ ufw.log / kern.log  │
  │ localhost:1234   │   │              │   │                     │
  └──────────────────┘   └──────────────┘   └─────────────────────┘
```

`*` Linux sidecars are opt-in — see [SETUP.md](SETUP.md).

## Component map

### Browser (Phaser 3 client)

| File | Responsibility |
|---|---|
| [office-scene.js](../office-scene.js) | Main Phaser scene. Owns the 16 NPC sprites, physics colliders, camera, and the per-frame update loop. Calls `_applySeparation` to keep NPCs from piling up. |
| [src/agent-office-manager.js](../src/agent-office-manager.js) | Translates `npc_decision` messages from the server into actual NPC behavior (walk here, speak that, read bookshelf, visit coworker, …). Also owns the chat reply-back loop (turn cap = 4). |
| [src/agent-actions.js](../src/agent-actions.js) | Low-level NPC action primitives: `speakTo`, `visit`, `goToCoffee`, `useComputer`. Handles stuck-detection, target-snap via pathfinding, and the speaker-slot cap. |
| [src/pathfinding.js](../src/pathfinding.js) | A* grid pathfinder with soft-cost halo around obstacles. `NpcPathFollower` applies arrival slowdown near the final waypoint. |
| [src/npc-agent-controller.js](../src/npc-agent-controller.js) | Drives the think loop — periodically asks the server "what should this NPC do?" and dispatches the reply. |
| [src/cofounder-agent.js](../src/cofounder-agent.js) (client side receiver) | Receives global `agent_commands` broadcasts from the CTO director. |
| [src/security-monitor.js](../src/security-monitor.js) | Client-side WebSocket hub for `/security-ws`. Translates server threat events into DOM events consumed by `RobberController`. |
| [src/robber-controller.js](../src/robber-controller.js) | Spawns, animates, and despawns robber NPCs based on threat category. Max 5 simultaneous. |
| [src/proposals-panel.js](../src/proposals-panel.js) | Bottom-right operator chip + card panel. Hits `/api/proposals`, shows pending animation / SOUL / capability proposals, sends approve/reject/apply POSTs. |

### Server (Node.js)

| File | Responsibility |
|---|---|
| [server.js](../server.js) | ~7,700-line HTTP + WebSocket monolith (`PORT` env, default `8080`). Serves the static game, routes `npc_*` messages to `NpcBrainManager`, exposes `/security-ws`, `/security-test`, visitor APIs, compute mesh routes, and more. See [SERVER.md](SERVER.md). |
| [src/npc-brains.js](../src/npc-brains.js) | The brain manager. Loads each NPC's `SOUL.md`/`MEMORY.md`, queues LM Studio requests sequentially, runs `think()` and `getResponse()`. Implements the intelligence layer: goals, daily plans, theory of mind, outcome tagging, event feed, shared task board. |
| [src/cofounder-agent.js](../src/cofounder-agent.js) (server side) | "Director" agent. Every 15-30s observes office state, picks the most interesting thing to make happen, and broadcasts commands to the game client. State-reactive: flags stuck agents as priority, pulls from the event feed. Mirrors office-state into `worldState` and feeds fatigue tracking off status transitions. |
| [security-monitor-server.js](../security-monitor-server.js) | Security monitor. Polls system/network/files for threats, and on Linux, runs tshark + scan-detector feeders. Broadcasts threat events to all connected `/security-ws` clients. |
| [jelly/](../jelly/) | Skill runtime — `createJelly()` registers and executes native + vendor skills (`jelly/skills/`, `jelly/vendor/skills/`). Replaces legacy `gateway-bridge.js` dispatch. See [JELLY_INTEGRATION.md](JELLY_INTEGRATION.md). |
| [src/denizen-harness/](../src/denizen-harness/) | **Denizen Harness** — single control plane: `complete()` inference gate, think/chat/director loops, Jelly tools façade, learning inject, `/api/harness`. See [DENIZEN_HARNESS.md](DENIZEN_HARNESS.md). |
| [src/gateway-bridge.js](../src/gateway-bridge.js) | Legacy optional bridge to OpenClaw gateway (port 18789). Off by default since Jelly migration. |
| [src/world-state.js](../src/world-state.js) | Single in-memory source of truth — NPC positions/state, velocities, fatigue timers, last-addressed, exchange history, sentiment, stuck-loops, threats, tasks, environment. Pub/sub for broadcasts. |
| [src/sentiment.js](../src/sentiment.js) | Cheap keyword-regex mood classifier (`happy`/`frustrated`/`tired`/`excited`/`anxious`). Called from `recordSelfMessage`; surfaces as peer tags in `Nearby:`. |
| [src/animation-forge.js](../src/animation-forge.js) | Validates `requestAnimation` proposals; future home of the composition / AI-gen / local-SD renderers (currently API-surface-only stubs). |
| [src/soul-reflection.js](../src/soul-reflection.js) | Builds the SOUL-revision prompt + applies approved proposals to `npcs/<n>/SOUL.md` and appends an audit entry to `SOUL.history.md`. |
| [src/capability-proposal.js](../src/capability-proposal.js) | Validates `requestCapability` proposals (new action verbs); operator must still implement them by hand in `src/agent-actions.js`. |

### Data on disk

| Path | Purpose |
|---|---|
| `npcs/<name>/SOUL.md` | Per-NPC personality. Loaded once at server start; `reloadSoul(name)` refreshes after an approved SOUL proposal is applied. |
| `npcs/<name>/SOUL.history.md` | Audit log of every applied SOUL proposal — `## <ISO> — proposal:<id>` entries with diffs, approval/apply timestamps. Lazy-created on first apply. |
| `npcs/<name>/MEMORY.md` | Runtime memory. Appended after each `think()` with the enriched save entry. Capped at 200 lines. Contains `[TOPIC:*]`, `[SKILL:*:+1]`, `[OUTCOME:*]` tags. |
| `~/.openclaw/openclaw.json` | Optional remote API keys (Anthropic, Google, xAI, Moonshot). LM Studio is always available as fallback. |
| `layouts/office-layout.json` | Persistent furniture layout. NPC `placeFurniture` calls append; client reads on boot AND live-spawns from the `furniture_placed` WS broadcast. |
| `data/animation-proposals.json` | NPC-requested animation queue (lazy-created, gitignored). |
| `data/soul-proposals.json` | NPC self-reflection queue (lazy-created, gitignored). |
| `data/capability-proposals.json` | NPC capability-request queue (lazy-created, gitignored). |

## The two decision loops

Denizen has two independent decision loops. Understanding them is the key to understanding the whole system.

### Loop 1 — Per-NPC think loop (bottom-up)

Each NPC runs its own slow cycle:

1. Client: [`npc-agent-controller.js`](../src/npc-agent-controller.js) schedules a think for NPC *X* every 45-75 seconds.
2. Client → Server: `{type: 'npc_think', npcName: 'Alex'}`
3. Server: [`NpcBrainManager.think()`](../src/npc-brains.js) assembles the full context for Alex (SOUL.md, last 1200 chars of MEMORY.md, 10 recent conversations, goals, daily plan, theory of mind of 4 nearby NPCs, recent office events, shared task board, coworker hierarchy, fatigue hint, room affinity, nearby furniture).
4. Server → LM Studio: one `chat/completions` call with `max_tokens=400, temperature=0.95`.
5. Server ← LM Studio: JSON with `{reasoning, plan, thought, action, target, location, message, taskPhase, save, outcome}`.
6. Server: save memory with `[OUTCOME:*]` / `[TOPIC:*]` / `[SKILL:*]` tags. Update goal progress. Record relationship. Broadcast office event if the decision was a meeting/ship/blocker.
7. Server → Client: `{type: 'npc_decision', npcName: 'Alex', decision: {...}}`
8. Client: [`agent-office-manager._executeNpcDecision`](../src/agent-office-manager.js) reads `action` and calls the matching primitive in [agent-actions.js](../src/agent-actions.js).

All 16 LM Studio calls are serialized through one queue so the GPU only runs one inference at a time. Typical cadence: ~1 think every 3-4 seconds across the whole office.

### Loop 2 — CofounderAgent director loop (top-down)

Every 15-30s the "CTO" picks a global move:

1. [`CofounderAgent._think()`](../src/cofounder-agent.js) builds a state-reactive prompt from `officeState` (who's idle, who's working, who just shipped, who's stuck) + the shared event feed.
2. One LM Studio call (`max_tokens=1024`). Asked to reply with a JSON array of 2-4 commands.
3. Each command is broadcast to every connected browser as `agent_command`. The client's agent-office-manager dispatches it.

The CTO is the only one that can call group meetings or route around stuck agents. If it errors 5 times in a row, it falls back to a pre-scripted demo loop so the office never goes silent.

## The security loop (visualization of real events)

Runs independently of the AI loops. Goal: turn log lines into character animations.

1. [`security-monitor-server.js`](../security-monitor-server.js) polls system/network/files, and on Linux tails `tshark` + firewall logs.
2. On a suspicious event → `_emitThreat({category, severity, source, target, detail})` with dedup (5s window per category+source).
3. Server broadcasts to all `/security-ws` clients: `{type: 'threat', threatId, category, severity, source, target, detail, timestamp}`.
4. Client [`SecurityMonitor`](../src/security-monitor.js) fires a `threat` DOM event.
5. [`RobberController`](../src/robber-controller.js) picks an archetype from `THREAT_TARGETS`, spawns a robber at an appropriate spawn point, walks to a target, plays an action animation, and shows a speech bubble with the detail.
6. After 30 seconds the threat auto-resolves → robber walks off the left edge of the map.

Max 5 robbers at once. If more threats are active, new ones queue and replace the oldest on resolution.

## Intelligence layer (commit `0f0ccd2`)

The NPC brain layer added in the most recent feature batch — see [AI-SYSTEM.md](AI-SYSTEM.md) for full detail. Quick summary:

- **Persistent goals** — each NPC has a role-seeded long-term goal (e.g. Abby: "Keep the team unblocked and shipping steadily") that's injected into every think prompt.
- **Daily plans** — 3 role-driven priorities regenerated once per calendar day, surfaced as `## Today's Priorities` in the prompt.
- **Theory of mind** — the 4 most recent other-NPC decisions are shown to the thinking NPC so they can reason about what everyone else is up to.
- **Chain-of-thought schema** — think responses now include `reasoning` and `plan` fields forcing the LLM to lay out its logic before choosing an action.
- **Outcome tagging** — `[OUTCOME:ok|stuck|blocked|success]` added to memory writes. The CofounderAgent prioritizes anyone marked stuck/blocked.
- **Office event feed** — meetings, shipped work, and blockers are broadcast to all brains as a shared short-term context.
- **Shared task board** — `addSharedTask`/`_getTaskBoard` — anyone can post, anyone can claim. Visible in the think prompt.
- **Social graph** — `_recordRelationship(from, to)` tracks interaction counts per pair.
- **Chat reply-back cap raised** from 2 → 4 turns so conversations actually develop.

## Intelligence layer (visitor -> facts -> predictions)

The runtime intelligence stack now connects visitor activity, NPC output, and business-table triggers into a single event spine used for briefings, pipeline summaries, and forecast validation.

```mermaid
flowchart LR
  V[Visitor UI + onboarding] --> S[/api/visitor/* and /api/intelligence/*]
  S --> DB[src/denizen-db.js]
  DB --> F[denizen_facts]
  DB --> O[denizen_outcomes]
  DB --> P[denizen_predictions]
  T[DB triggers on intake/leads/rfps/appointments/jobs/trades] --> F
  T --> O
  O --> VAL[denizen_validate_predictions]
  P --> VAL
  VAL --> API[prediction-summary + pipeline-summary + morning briefing cards]
```

### Intelligence path by responsibility

| Stage | Module/table | Responsibility |
|---|---|---|
| Visitor/session intake | `src/visitor-session.js`, `src/denizen-visitor.js`, `src/visitor-access.js` | Establish session tier/org, enforce token + feature gating |
| Runtime writes | `src/denizen-db.js` | Append facts from NPC work, LLM telemetry, office state, and visitor handoffs |
| Business trigger writes | `supabase/migrations/20260606000006*`, `000012*`, `000014*` | Emit facts/outcomes from intake, leads, RFPs, appointments, jobs, and trade suggestions |
| Forecast layer | `src/denizen-prediction-loop.js`, `src/mirofish-prediction.js` | Maintain/validate forecasts and expose summarized metrics |
| Visitor intelligence surfaces | `src/denizen-visitor-intelligence.js` | Build morning briefings and proactive updates using predictions + pipeline context |

## Compute mesh (optional)

When enabled, Denizen coordinates distributed inference and fleet jobs across a home lab or production fleet (dolonia GPU host, Synology NAS, Kali worker, Denizen Desktop nodes). The server exposes `/api/compute/*` routes backed by Supabase queue tables; fleet agents pull work and report metrics.

See [COMPUTE_MESH.md](COMPUTE_MESH.md) and [../../infra/README.md](../../infra/README.md).

## Bouncer security (multi-node)

Threat visualization, Kali investigations, Redis relay to spectate followers, and mesh patrol are documented end-to-end in **[BOUNCER.md](BOUNCER.md)**.

Production shape: NAS primary (`:8888`) runs `SecurityMonitor` → Redis → followers (`:8889`/`:8890`) → browser `agent-ws` / `security-ws`. Investigations proxy to dolonia WSL via `BOUNCER_INVESTIGATION_URL`.

## Message type reference

Port: `process.env.PORT` (default `8080` in code; Dolonia lab typically sets `PORT=8081` in `.env`).

### NPC messages (`/agent-ws`)

> Live endpoint is **`/agent-ws`** (not `/ws`). See [SERVER.md](SERVER.md).

| Type | Direction | Payload |
|---|---|---|
| `npc_think` | client → server | `{npcName, officeContext}` |
| `npc_decision` | server → client | `{npcName, decision: {reasoning, plan, action, ...}}` |
| `npc_conversation` | client → server | `{npcName, fromName, text, turn}` |
| `npc_response` | server → client | `{npcName, fromName, text, turn}` |
| `npc_cascade` | server → client | `{npcName, fromName, message}` |
| `office_state` | client → server | full snapshot for CofounderAgent |
| `agent_command` | server → client | a single action for the CTO to enact |

### Security messages (`/security-ws`)

| Type | Payload |
|---|---|
| `threat` | `{threatId, category, severity: low/medium/high/critical, source, target, detail, timestamp}` |
| `threat-cleared` | `{threatId}` |
| `heartbeat` | `{timestamp}` |

## Performance characteristics

Measured on the target hardware (4070 Ti Super + i9 + 64GB, qwen2.5-14b-instruct-1m on LM Studio):

- Per-NPC think: 3-8s inference
- Queue depth in steady state: 2-4 requests
- CofounderAgent adds 1 request every 15-30s
- SecurityMonitor polling: negligible (<1% CPU, no GPU)
- tshark in live mode: ~3% CPU sustained on a quiet link
- Browser: ~60 FPS with 16 NPCs + 5 robbers

## Related documents

- [SERVER.md](SERVER.md) — `server.js` monolith route and module map
- [COMPUTE_MESH.md](COMPUTE_MESH.md) — distributed compute mesh and fleet agents
- [AI-SYSTEM.md](AI-SYSTEM.md) — deep-dive on the NPC intelligence layer
- [SECURITY.md](SECURITY.md) — full threat catalog, robber mappings, and test commands
- [SETUP.md](SETUP.md) — how to run the Linux sidecar for live Wireshark/Nmap visualization
