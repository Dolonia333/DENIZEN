# Building Your Own Harness — Evaluation of OpenClaw

> **Note (2026-06-08):** Pre-monolith thinking — `server.js` is intentionally ~7,700 lines today; see [SERVER.md](SERVER.md). This doc is research history, not the current architecture plan.

> Research-only document. No code changes here. Reading this should give you
> enough information to decide whether to fork OpenClaw, build a thin harness
> from scratch, or stay on the upstream and just extend.

Date: 2026-05-28

---

## TL;DR

| Question | Answer |
|---|---|
| Is OpenClaw a harness? | Yes — agent runtime + multi-channel gateway. Conceptual peer of Claude Code, Cursor agent mode, Anthropic Agent SDK. |
| What's it written in? | Node.js + TypeScript (Node 22+ / 24 recommended). |
| How big? | **110,456 LOC** in `src/` alone. 27,187 in tests. 70 skills shipped. 892 test files. |
| Author? | Peter Steinberger (solo, ~82% of commits). 8,469 commits, started 2025-11-24. |
| License? | **MIT** — free to fork, modify, ship. |
| Built on top of? | `@mariozechner/pi-agent-core` (the actual agent loop) by Mario Zechner. OpenClaw is the messaging/gateway/skills layer. |
| Should you fork it? | **Probably not.** It's overbuilt for Denizen's needs. **Recommendation: extract the parts you need into a thin Denizen-native harness.** |
| Effort to build a Denizen-tailored harness? | **~3–4 weeks of focused work** for an MVP that covers everything you actually use. |

---

## What OpenClaw Actually Is

A self-hosted, single-user AI assistant runtime. The vision (from docs.openclaw.ai):

> Your own personal AI assistant. Any OS. Any Platform. The lobster way. 🦞

Concretely:

- **Gateway** — a single long-lived daemon on `127.0.0.1:18789` (WebSocket). Owns all sessions, routes messages, exposes a typed RPC API.
- **Agent runtime** — wraps `pi-agent-core` to run an agent loop (intake → context → model → tools → streaming reply).
- **Channels** — 20+ messaging integrations (WhatsApp, Telegram, Slack, Discord, iMessage, Signal, Google Chat, Line, WebChat, etc.). Each is a plugin against the channel SDK.
- **Skills** — 70 bundled CLI scripts the agent can invoke (browserclaw, github, supabase-bridge, lm-studio, job-scraper, voice-input/output, image gen, etc.).
- **Hooks** — agent lifecycle interception points (gmail watcher, command hooks, plugin hooks).
- **Memory** — embeddings + hybrid retrieval (Gemini/OpenAI embeddings, sqlite-vec for local vector storage).
- **Cron** — scheduled agent tasks.
- **Companion apps** — macOS, iOS, Android. The macOS app uses Bonjour discovery + WS bridge to talk to the local gateway.
- **Canvas host** — separate process on `:18793` serving agent-editable HTML and A2UI (a visual workspace).

---

## Scale Breakdown

Per-subsystem LOC (production code + tests):

| Subsystem | Prod LOC | Test LOC | What it does |
|-----------|---------:|---------:|--------------|
| `agents/` | 43,969 | 30,949 | Agent loop wrapper, tool execution, sessions, model auth, compaction |
| `commands/` | 27,397 | 11,623 | CLI commands and admin operations |
| `gateway/` | 24,374 | 13,615 | WebSocket server, auth, RPC dispatch, hooks mapping |
| `auto-reply/` | 21,599 | 19,403 | Command detection, message dispatch, response shaping |
| `infra/` | 21,117 | 9,615 | Process management, ports, env, runtime guards, binaries |
| `cli/` | 20,751 | 5,494 | TUI, setup wizard, profile management |
| `canvas-host/` | 18,510 | 249 | A2UI workspace, agent-editable HTML server |
| `config/` | 13,764 | 5,204 | Config schema, env substitution, defaults |
| `browser/` | 10,417 | 6,201 | Playwright wrapper for browserclaw |
| `channels/` | 9,215 | 1,858 | Cross-channel abstractions (registry, gating, sender identity) |
| `plugins/` | 5,640 | 1,496 | Channel plugin system |
| `memory/` | 4,971 | 2,216 | Embeddings + sqlite-vec retrieval |
| `hooks/` | 3,854 | 2,063 | Lifecycle hooks (gmail watcher, etc.) |
| `cron/` | 2,121 | 2,441 | Scheduled agent runs |
| `media/` | 1,984 | 863 | Image/audio handling |
| `tts/` | 1,581 | 563 | Text-to-speech |
| `logging/` | 1,496 | 414 | Structured logging |
| `providers/` | 413 | 764 | OAuth flows for GitHub Copilot, Qwen Portal |
| `sessions/` | 330 | 58 | Session key utils, transcript events |
| **Total `src/`** | **~232K LOC** | — | (prod + tests combined) |

**Plus** ~110K LOC in `commands/`, `cli/`, etc., 70 skills (each their own folder with SKILL.md + scripts), and the Android/iOS/macOS companion apps (in `apps/`).

For comparison: **all of Denizen** (code + tests + docs) is ~30K LOC. OpenClaw is ~10× bigger.

---

## Architecture Deep-Dive

### The agent loop (where the actual AI work happens)

OpenClaw wraps `pi-agent-core` (Mario Zechner's package). The OpenClaw side does:

1. **Intake** — `agent` RPC arrives via WebSocket
2. **Context assembly** — resolves session, loads skills snapshot, gathers bootstrap files
3. **Workspace prep** — creates per-session workspace dir, acquires session write lock
4. **Prompt assembly** — base prompt + skills prompt + bootstrap context + per-run overrides
5. **Inference** — hands off to `pi-agent-core` with the assembled prompt + tool definitions
6. **Streaming** — bridges pi-agent-core events (`tool`, `assistant`, `lifecycle`) back into the OpenClaw WS stream
7. **Persistence** — appends to session transcript

The serial-per-session queue (from `agent-loop.md`):
- Runs serialized per session key (prevents tool races)
- Optional global lane (for shared resources)
- Per-channel queue modes: `collect`, `steer`, `followup`

### The gateway (the HTTP/WS surface)

Single Node process listening on `127.0.0.1:18789`. Speaks a typed WebSocket protocol:

- First frame must be `connect` (with optional auth token)
- Requests: `{type:"req", id, method, params}` → `{type:"res", id, ok, payload|error}`
- Events: `{type:"event", event, payload, seq?, stateVersion?}`
- Methods: `health`, `status`, `send`, `agent`, `agent.wait`, `system-presence`
- Events: `tick`, `agent`, `presence`, `shutdown`, `chat`, `health`, `heartbeat`, `cron`

Idempotency keys required for side-effecting methods. Nodes (mobile/desktop companions) connect with `role: node` and declare caps.

### Skills (the extension surface you actually care about)

Skills are CLI scripts. Each lives in `skills/<name>/`:

```
skills/github/
├── SKILL.md          ← frontmatter + instructions for the agent
└── (the actual gh CLI is system-installed; SKILL.md just tells the agent how to use it)

skills/job-scraper/
├── SKILL.md
└── job-scraper.mjs   ← node script invoked by the agent
```

`SKILL.md` frontmatter:

```yaml
---
name: github
description: "Interact with GitHub using the `gh` CLI..."
metadata:
  openclaw:
    emoji: 🐙
    requires:
      bins: [gh]
    install:
      - {id: brew, kind: brew, formula: gh, bins: [gh], label: "Install GitHub CLI (brew)"}
      - {id: winget, kind: winget, package: GitHub.cli, ...}
      - {id: scoop, ...}
      - {id: apt, ...}
---

# GitHub Skill
Use the `gh` CLI to interact with GitHub. Always specify --repo when not in a git directory...
```

The agent's system prompt includes a "skills index" — name + one-line description. When the model decides a skill applies, it reads `SKILL.md` (via the Read tool) for full instructions, then executes via the Bash tool. The skill itself is just documentation plus an optional executable.

**This is the only piece of OpenClaw Denizen actually uses heavily.** Everything else (channels, gateway WS, canvas host) is bypassed by Denizen's own WebSocket layer.

### Memory

`memory/` has embeddings backends for Gemini and OpenAI, plus `hybrid.ts` (probably hybrid keyword+vector retrieval). Uses `sqlite-vec` for local vector storage. Provides "long-term memory" across sessions — different from per-session conversation history.

### Hooks

Two hook systems:
- **Internal hooks** (gateway-level): `agent:bootstrap`, command hooks (`/new`, `/reset`, `/stop`)
- **Plugin hooks** (agent + gateway lifecycle): `before_agent_start`, `agent_end`, `before_compaction`, `after_compaction`, `before_tool_call`, `after_tool_call`, `tool_result_persist`, `message_received`, `message_sending`, `message_sent`, `session_start`, `session_end`, `gateway_start`, `gateway_stop`

Gmail watcher lives here (polls Gmail, triggers an agent run on new messages).

---

## What Makes OpenClaw "OpenClaw"

The design decisions that define the project:

1. **Single-user, local-first** — one user, one machine, the gateway daemon is the source of truth. No multi-tenancy. No cloud.
2. **Channels-first** — the assumption is the user has 20 messaging surfaces (WhatsApp, Telegram, Slack, etc.) and wants ONE assistant on top. That's why so much LOC is in channel adapters.
3. **Long-lived daemon** — the gateway is meant to stay up forever. Sessions persist across reconnects. Mobile/desktop clients reconnect to the same gateway.
4. **Skills as markdown + bins** — skills are not Node modules. They're documentation that the model reads, plus optional system binaries. This means *the model decides how to use them* rather than the harness imposing a calling convention.
5. **pi-agent-core handles the loop** — OpenClaw doesn't reinvent the model-tool cycle. It's a wrapper + integration layer.
6. **Plugin everything** — channels, hooks, skills are all extension points. Adding a new messaging channel is "write a plugin against the SDK," not "patch the core."

---

## Strengths

What OpenClaw nails:

- **Skill model is dead simple.** Markdown + a frontmatter block + optional binary. Hard to beat for ergonomics.
- **Gateway as single source of truth** — clean architectural decision. Multiple clients (CLI, mac app, mobile) all reconnect to the same daemon.
- **MIT license** — you can fork and ship commercially without restriction.
- **Built on `pi-agent-core`** — Mario Zechner's package is solid; not reinventing the wheel.
- **Heavy test coverage** — 892 test files, ~110K lines of test code. Confidence is high.
- **Discoverable** — Bonjour for local network discovery, mobile companion auto-pairs.
- **Plugin SDK** — channels can be added without touching core. Clean extension model.

## Weaknesses

What's painful or overbuilt for your use case:

- **20+ messaging channels you don't use.** WhatsApp, Telegram, Slack, Signal, Discord, iMessage, Google Chat, Line — for Denizen, you have one channel (the Phaser browser game over WebSocket). 9K LOC of `channels/` + each channel's adapter is dead weight.
- **Canvas host + A2UI.** 18K LOC building an agent-editable HTML workspace. Denizen has its own 2D world. Redundant.
- **Companion apps.** macOS / iOS / Android apps in `apps/`. Denizen is browser-based. Redundant.
- **Auto-reply complexity.** 22K LOC of command detection, dispatch, response shaping. Designed for general-purpose chat bots. Denizen's NPC system is the "auto-reply" equivalent and is much simpler.
- **TypeScript build pipeline.** Adds compile step + dist generation. Denizen runs plain JS on Node directly.
- **Solo author risk.** 82% of commits by one person. Long-term maintenance depends on whether Peter Steinberger keeps shipping. (Mitigated by MIT license — you can always fork.)
- **No clean "use just the agent loop" API.** To extract `pi-agent-core` integration cleanly, you'd need to disentangle from gateway + sessions + skills+ channels. Not impossible but not a 1-day job.
- **Skills as system binaries** is great for the "personal assistant on your laptop" use case. For Denizen running on a server, you may want skills as in-process JS modules to avoid the spawn-a-subprocess cost (each `runNpcSkill` spawns a node process today).

---

## What Denizen Actually Uses from OpenClaw

Right now Denizen invokes OpenClaw skills via direct CLI calls (`node skills/<name>/<name>.mjs --param value`). It does NOT use:

- ❌ The OpenClaw gateway (Denizen has its own WS layer on :8080)
- ❌ The agent loop (Denizen has `npc-brains.js` with its own loop)
- ❌ Channels (Denizen IS the channel — Phaser scene over WS)
- ❌ Canvas host / A2UI (Denizen renders its own canvas)
- ❌ Companion apps (Denizen runs in the browser)
- ❌ Auto-reply (Denizen has NPC think loops)
- ❌ Hooks (Denizen has its own)
- ❌ Memory subsystem (Denizen uses MEMORY.md files)
- ❌ Cron (Denizen has interval timers)

Denizen uses:

- ✅ The skill **scripts themselves** — invoked via `node skills/<name>/<name>.mjs`
- ✅ Roughly half of the 70 skills (browserclaw, coding-agent, github, supabase-bridge, lm-studio, job-scraper, job-applier, resume-generator, pdf-generator, canvas-render, visionclaw)
- ✅ The `~/.openclaw/openclaw.json` config file (for API keys)

**That's it.** Of OpenClaw's ~110K LOC, Denizen uses maybe 5–10K worth (the skills it invokes). The rest is dead weight for this use case.

---

## "Tailored to Your Needs" — What Would Change

If you built a **Denizen-native harness** designed specifically for what Denizen actually does, here's what would be different:

### 1. WebSocket-native, not multi-channel
Drop the entire channel abstraction. The harness assumes one transport: WebSocket to the Phaser client. No need for Baileys, grammy, @slack/bolt, etc. — **~50 of OpenClaw's 51 deps disappear.**

### 2. Skills as in-process JS modules, not subprocesses
Replace `spawn('node', [skill.mjs, ...])` with `import()` of a skill module. Same `SKILL.md` frontmatter for discovery, but the body is a JS function:

```js
// skills/github/index.js
export const meta = { name: 'github', description: '...' };
export async function run({ params, context }) {
  // direct in-process call, no spawn
  return { ok: true, output: '...' };
}
```

Result: skill calls go from ~100-300ms (process spawn) to <10ms. Lets NPCs invoke skills in their fast think loop without latency hit.

### 3. NPC-native session model
OpenClaw's sessions are one-per-user-per-conversation. Denizen's are one-per-NPC. The harness should know about NPCs as first-class concepts:
- `npc.think(context)` — runs a think cycle
- `npc.respondTo(message)` — handles a player chat
- `npc.runSkill(name, params)` — executes a skill with that NPC's context

### 4. Built-in mood / directive / chain awareness
The harness should know about NPC mood, active directives, active task chains, and conflict detection because those are intrinsic to Denizen's design. OpenClaw is too generic — it has no opinions about agents being a *team*.

### 5. Memory tied to MEMORY.md, not embeddings
Denizen's memory is already in version-controllable markdown files. Don't add a sqlite-vec embedding layer unless and until you need cross-NPC semantic search.

### 6. No companion apps, no canvas host
Drop `apps/`, `canvas-host/`, `tts/` (Denizen uses ElevenLabs directly), `media-understanding/`, etc.

### 7. Drop pi-agent-core dependency
The model→tool cycle in Denizen is so simple (decision JSON in, action out) that you don't need a full agent framework. The OpenClaw approach of wrapping pi-agent-core makes sense for general assistants, but for NPCs, a 200-line custom loop is enough.

---

## What a Denizen-Native Harness Would Actually Look Like

**Scope:** ~5-8K LOC. ~3-4 weeks of focused work for an MVP.

### Module map

```
denizen-harness/
├── core/
│   ├── npc-brain.js          (think loop — 500 LOC)
│   ├── npc-session.js        (per-NPC state + memory I/O — 200 LOC)
│   ├── skill-registry.js     (load skills from disk, JS modules — 300 LOC)
│   ├── skill-executor.js     (in-process invocation + result injection — 200 LOC)
│   └── prompt-assembler.js   (build think prompts — 400 LOC)
├── server/
│   ├── gateway.js            (WS server + RPC — 600 LOC)
│   ├── rest-api.js           (the existing /api/* endpoints — 400 LOC)
│   └── broadcast.js          (event fanout — 100 LOC)
├── providers/
│   ├── lmstudio.js           (already exists — 300 LOC)
│   ├── claude.js             (Anthropic SDK wrapper — 200 LOC)
│   ├── grok.js               (200 LOC)
│   └── ...
├── coordination/
│   ├── directives.js         (directive inbox — 200 LOC)
│   ├── task-chains.js        (chain orchestration — 300 LOC)
│   ├── conflict-detector.js  (already exists — 200 LOC)
│   └── mood.js               (stress/satisfaction/focus — 200 LOC)
├── telemetry/
│   ├── llm-telemetry.js      (already exists — 400 LOC)
│   └── pc-activity.js        (already exists — 200 LOC)
├── skills/
│   ├── github/index.js       (~150 LOC each, in-process)
│   ├── browserclaw/index.js
│   ├── coding-agent/index.js
│   ├── supabase/index.js
│   ├── lm-studio/index.js
│   └── ...                   (5-10 skills initially)
└── docs/
    └── HARNESS.md
```

### How Denizen would use it

The current `apps/office/server.js` becomes a thin wrapper:

```js
const harness = require('@apps/office/harness');
const npcs = await harness.loadNpcs('./npcs');   // reads SOUL.md files
const gateway = harness.startGateway({ port: 8080, npcs });
gateway.on('player_chat', async (msg) => {
  const npc = npcs.get(msg.target);
  const reply = await npc.respondTo(msg.text);
  gateway.broadcast({ type: 'npc_response', npc: msg.target, text: reply });
});
```

Everything below that is the harness's responsibility.

---

## Effort Estimate

| Phase | Scope | Effort |
|-------|-------|--------|
| **Phase A** — Extract core into a package | Pull `npc-brains.js`, `task-chain.js`, `conflict-detector.js`, `coding-task-runner.js`, etc. out of `apps/office/src/` into a separate `harness/` package with clean exports. No new functionality. | **~1 week** |
| **Phase B** — In-process skill registry | Build `skill-registry.js` + convert 5–10 critical skills (github, browserclaw, coding-agent, supabase, lm-studio) from subprocess to in-process JS modules. | **~1 week** |
| **Phase C** — Gateway abstraction | Move the WS/REST surface into the harness as a clean API. Denizen becomes a consumer. | **~1 week** |
| **Phase D** — Phase 5 loop integration | Wire outcome scoring + competency map + training task generator into the harness as first-class concepts (instead of bolt-ons). | **~1 week** |
| **Total to "Denizen-native harness 1.0"** | | **~4 weeks** |

After that, you could open-source `@apps/office/harness` and other people could use it to build their own NPC-driven AI workflows. That's the real strategic value.

---

## Risks & Considerations

1. **Don't fork OpenClaw.** It's too big (~110K LOC) and ~95% of it is irrelevant to Denizen. The maintenance burden of carrying that codebase would crush you. The MIT license means you don't *need* to fork — you can keep using upstream skills and replace OpenClaw incrementally.

2. **Keep using OpenClaw's skill scripts even after building your own harness.** Many of the 70 skills (browserclaw, github, coding-agent) are genuinely good. Your harness can support both formats:
   - **OpenClaw skills** — invoke via subprocess (today's behavior, still works)
   - **Native skills** — in-process JS modules (your new format)

   Migration becomes incremental, not big-bang.

3. **You're betting on Denizen as a product.** If Denizen becomes "framework for visual AI agent workflows," then yes, build the harness — it becomes part of the moat. If Denizen stays a personal observability tool, just keep using OpenClaw as-is.

4. **Solo author dependency.** OpenClaw is ~82% one person. If Peter Steinberger stops shipping, the upstream stalls. Your harness should not depend on internals that might break. Treat OpenClaw skills as a stable interface; treat OpenClaw's gateway as an upstream you may need to fork later.

5. **Don't ship a worse `pi-agent-core`.** Mario Zechner's package handles model-tool cycles well. If you build your own, you'll spend a week reimplementing token counting, retry logic, streaming, etc. Either use `pi-agent-core` directly (it's a dep of OpenClaw, you can require it standalone) or build something genuinely simpler.

---

## Recommendation

**Build a thin Denizen-native harness over 3–4 weeks. Don't fork OpenClaw.**

Specifically:

1. **Now**: extract the existing Denizen code that's already harness-shaped (`npc-brains.js`, `task-chain.js`, `conflict-detector.js`, `coding-task-runner.js`, `pc-activity-tracker.js`, `llm-telemetry.js`) into a `harness/` subdir. Treat it as a "package within the repo." No external publish yet.

2. **Next**: build the in-process skill registry. This is the single highest-impact change — eliminates the 100-300ms spawn cost on every skill invocation and lets NPCs use skills in their fast think loop.

3. **Then**: design the public API so the harness could one day support more than just Denizen — but don't extract it until you have a second consumer.

4. **Keep OpenClaw skills working** via the subprocess path. Convert them to in-process JS one at a time as needed.

5. **Skip OpenClaw's gateway, channels, canvas, companion apps entirely.** They're not relevant to Denizen.

You end up with:
- Denizen as a product (the pixel office)
- `@apps/office/harness` as a library (the runtime)
- OpenClaw skills as a *compatible artifact format* (use what's good; replace what's slow)

That's the cleanest separation of concerns and the lowest-risk path.

---

## Open Questions to Resolve Before Building

1. **Do you want the harness open-sourceable?** If yes, MIT-license it from day one and design the API surface accordingly.

2. **In-process skills break the "skills are language-agnostic" property.** OpenClaw skills can be Python, shell, anything callable. Do you want to keep that, or accept JS-only as the price for speed?

3. **Do you need cross-NPC semantic memory (embeddings) eventually?** If yes, plan for it now (vector store integration). If not, MEMORY.md is fine forever.

4. **Should the harness handle multi-tenant in the future** (one harness running multiple "offices")? Affects the session model.

5. **Where does the Phase 5 (continuous improvement) loop live?** In the harness as a built-in (everyone using the harness gets it) or in Denizen as an application-level layer (custom to NPC roleplay)?

These are real product decisions — don't answer them in code, answer them on paper first.
