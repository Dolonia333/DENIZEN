# DENIZEN

**Real-time visual observability layer for AI agents.** Watch autonomous AI agents collaborate, communicate, and execute tasks in a pixel-art office — every agent action rendered as NPC behavior you can see.

Built with **Phaser 3** using the [LimeZu Modern Office](https://limezu.itch.io/) asset pack.

![Denizen Preview](assets/ref_Hu4Gzs.png)

---

## Table of Contents

- [What is Denizen?](#what-is-denizen)
- [Quick Start](#quick-start)
  - [Prerequisites](#prerequisites)
  - [Install and Run](#install-and-run)
- [Configuration](#configuration)
  - [API Keys](#api-keys)
  - [LM Studio (Local AI)](#lm-studio-local-ai)
  - [NPC AI Provider Mapping](#npc-ai-provider-mapping)
  - [Zero-Config Demo Mode](#zero-config-demo-mode-no-api-keys-needed)
- [How It Works](#how-it-works)
  - [Architecture](#architecture)
  - [WebSocket Endpoints](#websocket-endpoints)
  - [Key Source Files](#key-source-files)
  - [Data Files](#data-files)
  - [NPC Artifact Reports](#npc-artifact-reports)
  - [Agent-NPC Mapping](#agent-npc-mapping)
  - [State-to-Area Mapping](#state-to-area-mapping)
- [NPC System](#npc-system)
  - [Soul Files (Identity)](#soul-files-identity)
  - [NPC Brains (Runtime)](#npc-brains-runtime)
  - [Autonomous Decision Loop](#autonomous-decision-loop)
  - [Mood System](#mood-system)
  - [Directive Inbox](#directive-inbox)
  - [Status Indicators](#status-indicators)
  - [Skill Tracking](#skill-tracking)
  - [Request Queue (GPU Management)](#request-queue-gpu-management)
- [CTO Agent](#cto-agent)
- [OpenClaw Skill Bridge](#openclaw-skill-bridge)
- [NPC Coding-Task-Runner](#npc-coding-task-runner)
- [Task Chains](#task-chains)
- [Conflict Detection & Arbitration](#conflict-detection--arbitration)
- [Work Output Feed](#work-output-feed)
- [Meeting System](#meeting-system)
  - [Break Room Behavior](#break-room-behavior)
- [Security Monitor](#security-monitor)
- [Bouncer — Kali Linux Security Agent](#bouncer--kali-linux-security-agent)
  - [How Bouncer Investigates Threats](#how-bouncer-investigates-threats)
  - [Threat-to-Command Mapping](#threat-to-command-mapping)
  - [Proactive Patrol](#proactive-patrol)
  - [Setup](#setup)
- [Lucy — Email and Job Pipeline](#lucy--email-and-job-pipeline)
- [REST API Reference](#rest-api-reference)
- [Controls](#controls)
  - [OpenClaw Panel](#openclaw-panel)
- [Procedural Room Generator](#procedural-room-generator)
  - [Room Archetypes](#room-archetypes)
  - [How Generation Works](#how-generation-works)
  - [Usage](#usage)
- [Office Furniture System](#office-furniture-system)
- [Character Sprites](#character-sprites)
- [Development Tools](#development-tools)
  - [Sprite-to-Catalog Pipeline](#sprite-to-catalog-pipeline)
- [OpenClaw Integration](#openclaw-integration)
- [Troubleshooting](#troubleshooting)
  - [Server won't start (EADDRINUSE)](#server-wont-start-eaddrinuse)
  - [WebSocket errors](#websocket-errors-404-on-agent-ws-or-security-ws)
  - [NPCs don't respond](#npcs-dont-respond--blank-speech-bubbles)
  - [Black screen](#visualization-shows-black-screen)
  - [OpenClaw panel doesn't load](#openclaw-chat-panel-doesnt-load)
  - [Bouncer types commands into wrong window](#bouncer-types-commands-into-the-wrong-window)
  - [Bouncer terminal doesn't open](#bouncer-terminal-doesnt-open--windows-terminal-not-found)
  - [Bouncer shows no output](#bouncer-investigation-shows-no-output-or-wsl-errors)
  - [LM_STUDIO_PARALLEL not working](#lm_studio_parallel-not-taking-effect)
- [Testing](#testing)
- [Asset Pipeline](#asset-pipeline)
- [City Generator (experimental)](#city-generator-experimental)
- [Asset Pack](#asset-pack)
- [Related Documentation](#related-documentation)
- [Deployment](#deployment)
- [License](#license)

---

## What is Denizen?

Denizen is a visual observability layer that renders AI agent workflows as a living pixel-art office. Instead of reading logs or staring at dashboards, you watch AI agents work — each agent is represented as an NPC character that walks, talks, sits at desks, joins meetings, and collaborates with other agents in real time.

- **16 AI-powered NPCs** — each with a unique personality, role, and AI provider
- **Zero-config demo mode** — works out of the box without any API keys; NPCs use smart scripted responses
- **Autonomous CTO agent** — directs the team every 15-30s, assigning tasks, calling meetings, and coordinating work (falls back to demo loop if API unavailable)
- **Multi-provider AI** — NPCs use Claude, Grok, Gemini, Kimi, or LM Studio (local)
- **Player interaction** — press `Enter` to talk to NPCs as the CEO; they walk over, respond, and execute tasks
- **A\* pathfinding** — NPCs navigate around furniture using grid-based pathfinding with stuck detection
- **Mood system** — NPCs accumulate stress, satisfaction, and focus; mood shifts are injected into every think prompt
- **Directive inbox** — any NPC (or the player) can assign a direct-order task to another NPC; the NPC prioritizes it over their normal cycle
- **OpenClaw skill bridge** — NPCs can execute real tools (GitHub, browserclaw, Supabase, job pipeline) via `action: run_skill`; results are injected into the next think cycle
- **NPCs run Claude Code** — `skill: coding-agent` spawns Claude Code in an isolated git worktree to modify real files; diffs are written to `reports/code-reviews/` for human approval before merge
- **Task chains** — `POST /api/task-chains` orchestrates multi-step NPC workflows (spec→design→code→review→QA); each step auto-assigns the next directive when its NPC finishes, with all prior artifacts as context
- **NPC disagreement & arbitration** — when two NPCs produce conflicting outcomes about the same topic, both positions get injected into Abby's next think prompt — she makes the call
- **Work output feed** — press `Tab` for a terminal-style HUD panel showing every NPC work output in real time with color-coded roles
- **Security monitor** — live threat detection dashboard (file access, network scans, injection attempts)
- **Bouncer investigations** — Bouncer runs real Kali Linux commands (nmap, ss, journalctl, tshark) against detected threats; produces structured markdown reports; escalates to Dan if serious
- **Lucy job pipeline** — Lucy can run a full 7-step job search → apply pipeline via OpenClaw skills; handles email auto-send with escalation keyword gating
- **Meeting system** — call meetings, NPCs walk to the conference room, sit in chairs, discuss, and return to work
- **Procedural room generator** — algorithmically builds rooms from the furniture catalog with 6 archetypes
- **OpenClaw integration** — connect to the OpenClaw gateway for full AI agent workflows

## Quick Start

### Prerequisites

- **Node.js** 22+
- **npm** (comes with Node.js)
- **LM Studio** — for local NPCs (Bob, Dan, Bouncer, Edward, Oscar, Pier). Load any GGUF model and start the local server on port 1234.
- **WSL with Kali Linux** *(optional, for Bouncer's live security investigations)* — `wsl --install -d kali-linux`. Bouncer runs `nmap`, `ss`, `netstat`, `journalctl`, and `whois` inside Kali when threats are detected.
- **Windows Terminal** *(optional, Windows only)* — Bouncer opens a real terminal window when investigating threats. Installed automatically from the Microsoft Store or via `winget install Microsoft.WindowsTerminal`.

### Install and Run

```bash
git clone https://github.com/Dolonia333/DENIZEN.git
cd DENIZEN
npm install
npm start
```

Open **http://localhost:8080** in your browser. You should see 16 NPCs moving around, talking to each other, and taking breaks.

For a guided 60-second tour with voice (auto-toggles presence, walks through agent-bus → security → n8n task → outro):

```
http://localhost:8080/?demo=tour
```

Original 20-second investor demo:

```
http://localhost:8080/?demo=investor
```

`npm start` runs `node server.js`. `npm test` runs the test suite under Node's built-in test runner.

For the full stack install (including LM Studio and the optional Linux security feeders), see **[docs/SETUP.md](docs/SETUP.md)**.

> **Port conflict?** If port 8080 is in use, kill the process first:
> ```powershell
> # Windows PowerShell
> Stop-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess -Force
> npm start
> ```

## Configuration

### API Keys

Denizen reads API keys from `~/.openclaw/openclaw.json` (or `%USERPROFILE%\.openclaw\openclaw.json` on Windows).

```json
{
  "models": {
    "providers": {
      "anthropic": { "apiKey": "sk-ant-api03-..." },
      "google": { "apiKey": "AIza..." },
      "xai": { "apiKey": "xai-..." },
      "moonshot": { "apiKey": "sk-...", "baseUrl": "https://api.moonshot.cn" }
    }
  }
}
```

### LM Studio (Local AI)

Bob (Researcher), Dan (IT Support), Bouncer (Security), Edward, Oscar, and Pier use **LM Studio** by default — no API key needed.

1. Download and install [LM Studio](https://lmstudio.ai/)
2. Load a model (default expects `dolphin3.0-llama3.1-8b` or any GGUF model)
3. Start the local server on port 1234 (LM Studio default)
4. Denizen connects automatically to `http://localhost:1234`

**Parallel inference** — if your GPU can handle it, you can load multiple model slots and let LM Studio serve parallel requests. Set this in your `.env` file:

```env
LM_STUDIO_PARALLEL=2
```

Start the server with `node --env-file=.env server.js` (or use the provided `launch.json` in `.claude/`). The default is 1 (sequential — safe for 8B models on a 12GB GPU).

### NPC AI Provider Mapping

| NPC | Role | AI Provider | Model |
|-----|------|-------------|-------|
| **Abby** | CTO | Claude (Anthropic) | claude-haiku-4-5 |
| **Alex** | Senior Developer | Grok (XAI) | grok-4 |
| **Bob** | Researcher | LM Studio (local) | dolphin3.0-llama3.1-8b |
| **Jenny** | Code Review | Claude (Anthropic) | claude-haiku-4-5 |
| **Dan** | IT Support | LM Studio (local) | dolphin3.0-llama3.1-8b |
| **Lucy** | Receptionist | Claude (Anthropic) | claude-haiku-4-5 |
| **Bouncer** | Security Guard | LM Studio (local) | dolphin3.0-llama3.1-8b |
| **Marcus** | Project Manager | Claude (Anthropic) | claude-haiku-4-5 |
| **Sarah** | Product Manager | Claude (Anthropic) | claude-haiku-4-5 |
| **Edward** | Backend Developer | LM Studio (local) | dolphin3.0-llama3.1-8b |
| **Josh** | Frontend Developer | Grok (XAI) | grok-4 |
| **Molly** | QA Engineer | Claude (Anthropic) | claude-haiku-4-5 |
| **Oscar** | DevOps Engineer | LM Studio (local) | dolphin3.0-llama3.1-8b |
| **Pier** | Data Engineer | LM Studio (local) | dolphin3.0-llama3.1-8b |
| **Rob** | UI/UX Designer | Claude (Anthropic) | claude-haiku-4-5 |
| **Roki** | Intern | Grok (XAI) | grok-4 |

> NPCs fall back to Claude if their primary provider fails, then to smart scripted responses if all providers fail.
>
> Model names above are the **defaults**. Pin a specific snapshot per provider in `~/.openclaw/openclaw.json` — every provider entry honors a `model` field that overrides the default:
> ```json
> { "models": { "providers": {
>     "anthropic": { "apiKey": "...", "model": "claude-haiku-4-5" },
>     "google":    { "apiKey": "...", "model": "gemini-2.5-flash" },
>     "xai":       { "apiKey": "...", "model": "grok-4" },
>     "moonshot":  { "apiKey": "...", "model": "kimi-k2" }
> } } }
> ```

### Zero-Config Demo Mode (No API Keys Needed)

Denizen works immediately after cloning — no API keys required. In demo mode:
- All 16 NPCs load and respond with context-aware scripted responses
- The CTO agent runs pre-scripted office behaviors (standups, code reviews, meetings)
- Smart fallback infers actions from player messages (e.g. "fix the bug" triggers coding behavior)
- If API keys are configured but fail (e.g. exhausted credits), the system auto-falls back to demo mode

## How It Works

### Architecture

```
Browser (Phaser 3)                    Server (Node.js :8080)              External
+---------------------+              +------------------------+          +-----------------+
| office-scene.js     |  /agent-ws   | CofounderAgent         |  HTTPS   | Anthropic API   |
| agent-office-mgr.js |<------------>| (Claude CTO brain)     |--------->| (Claude)        |
| npc-agent-ctrl.js   |              |                        |          +-----------------+
|                     | /security-ws | NpcBrainManager        |  HTTPS   | XAI API (Grok)  |
| security-monitor.js |<------------>| (per-NPC AI brains)    |--------->|                 |
|                     |              |                        |          +-----------------+
| gateway-bridge.js   |  (proxy)     | SecurityMonitorServer  |  HTTP    | LM Studio       |
| openclaw-chat.js    |<------------>| (threat detection)     |--------->| (localhost:1234) |
+---------------------+              |                        |          +-----------------+
                                      | linux-agent.js         |  WSL     | Kali Linux      |
                                      | (Bouncer investigates) |--------->| nmap/ss/netstat |
                                      |                        |          | journalctl/whois|
                                      | Static file server     |          +-----------------+
                                      | /openclaw/* proxy      |--------->| OpenClaw GW     |
                                      +------------------------+          | (localhost:18789)|
                                                                          +-----------------+
```

### WebSocket Endpoints

| Endpoint | Protocol | Purpose |
|----------|----------|---------|
| `ws://localhost:8080/agent-ws` | JSON messages | CTO commands, NPC conversations, office state updates |
| `ws://localhost:8080/security-ws` | JSON events | Real-time security threat broadcasts |
| `ws://localhost:8080/*` (other) | Proxy | Forwarded to OpenClaw gateway at `localhost:18789` |

### Key Source Files

| File | Purpose |
|------|---------|
| `server.js` | HTTP server, WebSocket routing, OpenClaw proxy, security monitoring, Bouncer API endpoints |
| `office-scene.js` | Main Phaser 3 scene — rendering, NPCs, player, furniture, walls |
| `src/cofounder-agent.js` | CTO AI brain — autonomous thinking loop, command generation |
| `src/npc-brains.js` | Multi-provider NPC brains — loads soul files, manages memory |
| `npcs/*/SOUL.md` | NPC identity files — personality, values, provider, role |
| `npcs/*/MEMORY.md` | NPC persistent memory — conversations saved across sessions |
| `src/agent-office-manager.js` | Coordinates AI agents, manages office workflow |
| `src/agent-actions.js` | Command executor for agent tasks |
| `src/npc-agent-controller.js` | Maps agent events to NPC behaviors (walk, sit, speak) |
| `src/gateway-bridge.js` | WebSocket client connecting to OpenClaw gateway (protocol v3) |
| `src/openclaw-chat.js` | Embedded OpenClaw UI panel (iframe, session management) |
| `src/security-monitor.js` | Client-side security dashboard (receives threats from server) |
| `security-monitor-server.js` | Server-side threat detection (file, network, API, system) |
| `src/player-chat.js` | CEO-to-NPC chat system (targeting, walk-over, delegation) |
| `src/logger.js` | Centralized structured logger — timestamps, log levels, per-module prefixes |
| `src/linux-agent.js` | Bouncer's Kali WSL command runner — `ss`, `nmap`, `netstat`, `ps`, `journalctl`, `whois`, `tcpdump`; threat-specific command sets; `perimeterPatrol()` for scheduled scans |
| `src/npc-tools.js` | Safe read-only system tools for NPCs — disk usage, memory, CPU load, uptime, process list |
| `src/desktop-agent.js` | Vision-based desktop automation via nut-js — screenshot → LM decision → mouse/keyboard; includes abort flag to kill in-flight tasks |
| `src/computer-use-agent.js` | Computer-use integration for NPC desktop interactions |
| `src/job-application.js` | Lucy's job pipeline — 7-step scrape→filter→resume→cover→apply→log chain |
| `src/work-feed.js` | Work output feed HUD — `WorkFeedPanel` class, Tab toggle, per-NPC color coding, 100-entry history |
| `src/email-handler.js` | Inbound email processor — escalation detection, auto-send gating, email queue |
| `src/coding-task-runner.js` | NPC coding-agent runner — git worktree isolation, `npx @anthropic-ai/claude-code --print` execution, diff capture, proposal storage, approve/reject lifecycle |
| `src/task-chain.js` | `TaskChainRunner` — multi-step NPC directive chains, auto-advances on `taskPhase: finished`, artifact handoff between steps |
| `src/conflict-detector.js` | `ConflictDetector` — rolling artifact log, similarity heuristic, queues conflicts for Abby arbitration |
| `src/demo-scene.js` | Investor demo cutscene (20-second scripted sequence) |
| `src/pathfinding.js` | A* pathfinding for NPC movement |
| `src/robber-controller.js` | Optional robber NPC visualization |
| `src/RoomAssembly.js` | Phaser integration for room layouts — catalog lookup, texture cropping, Y-sort |
| `src/RoomGenerator.js` | Procedural room generator — 6 archetypes, collision grid, decor pass |
| `src/RoomBuilder.js` | Low-level sprite rendering with modular group validation |
| `data/sheet_registry.json` | Canonical map of sheet IDs to file paths + grid sizes |
| `data/master_furniture_catalog.json` | Auto-generated merge of all furniture_catalog_*.json files |
| `data/company-brief.json` | Company context — mission, stack, team structure (injected into NPC prompts) |
| `data/user-profile.json` | CEO profile — used by Lucy and Bouncer for personalized responses |
| `index.html` | Entry point — loads Phaser 3.80 + all visualization scripts |

### Data Files

| File | Purpose |
|------|---------|
| `data/furniture_catalog_openplan.json` | Furniture definitions and placement coordinates |
| `data/definitions.json` | Object definitions (desks, chairs, monitors, plants, etc.) |
| `data/sheet_registry.json` | Sprite sheet registry for tilesets |
| `data/company-brief.json` | Company context injected into NPC prompts (mission, tech stack, team) |
| `data/user-profile.json` | CEO profile for personalized NPC responses |
| `data/job-application-log.json` | Log of job applications filed by the job-application agent |
| `assets-catalog.json` | Asset catalog for the sprite system |

### NPC Artifact Reports

NPCs generate real work artifacts as markdown files in the `reports/` directory:

```
reports/
  bugs/           # Bug reports filed by Molly or Jenny (QA)
  code-reviews/   # Code review notes from Alex, Jenny, Edward
  it-reports/     # IT support tickets and resolutions from Dan
  pm-reports/     # Project management updates from Marcus
  product/        # Product specs and decisions from Sarah
  security/       # Bouncer investigation reports — threat, findings, verdict, recommended actions
```

Each file is named `<npc>_<summary>_<date>.md` and contains the NPC's actual output. These are committed to git so you have a real history of what the AI agents produced.

Security reports include: metadata header (severity, source IP, category), per-step findings with labeled code blocks, threat intel (whois), pattern-based assessment, and a final verdict (`THREAT CONFIRMED` / `LIKELY FALSE POSITIVE` / `INCONCLUSIVE`).

### Agent-NPC Mapping

The `NpcAgentController` listens for gateway events and drives NPC behavior:

| Agent Event | NPC Behavior |
|------------|--------------|
| Agent starts a task | NPC walks to a desk, shows "Working..." |
| Agent writes text | NPC sits at desk, speech bubble shows text |
| Agent uses a tool | NPC at desk, bubble shows tool name |
| Agent finishes | NPC walks back to breakroom, shows "Done!" |
| Agent errors | NPC shows "Error!", returns to idle after 3s |
| Chat streaming | NPC shows "Typing..." |

### State-to-Area Mapping

| Agent State | Office Area |
|------------|-------------|
| `idle` | Breakroom (bottom-left) |
| `writing` | Desk (main office) |
| `researching` | Desk |
| `executing` | Desk |
| `syncing` | Desk |
| `error` | Desk |

## NPC System

### Soul Files (Identity)

Each NPC's identity is defined in plain markdown files — following the [OpenClaw](https://github.com/nichochar/openclaw) "soul file" pattern pioneered by Erik Steinberger. Instead of hardcoding personalities into the code, each NPC **reads itself into existence** from `.md` files at startup.

```
npcs/
  abby/
    SOUL.md      # Who she is — personality, values, tone, boundaries
    MEMORY.md    # What she remembers — persists across sessions
  alex/
    SOUL.md
    MEMORY.md
  bob/ jenny/ dan/ lucy/ bouncer/ marcus/ sarah/
  edward/ josh/ molly/ oscar/ pier/ rob/ roki/
    ...
```

**Why this matters:**

- **Edit a file, change who the NPC is.** No code changes needed. Open `npcs/abby/SOUL.md` in any text editor, change her personality, restart — she's different.
- **Portable.** Copy the `npcs/` folder to any machine, the characters exist there instantly.
- **Version controllable.** Git tracks how each NPC's identity evolves over time.
- **Model agnostic.** The same soul files work with Claude, Grok, Gemini, LM Studio — any LLM that can read text.
- **Local-first.** Your NPC data never leaves your machine unless you push it.

**How it works:**

1. `NpcBrainManager` (in `src/npc-brains.js`) reads each NPC's `SOUL.md` at startup
2. The full markdown content becomes the NPC's system prompt — the AI reads the soul and embodies it
3. `## Provider` and `## Role` sections are parsed to determine which AI backend powers the NPC
4. `MEMORY.md` is appended to the system prompt so the NPC remembers past conversations
5. After significant conversations, memories are automatically written back to `MEMORY.md`

**The soul file IS the NPC.** The AI model doesn't change. But the NPC has persistent identity, consistent personality, and long-term memory — all from plain text files.

#### Example: `npcs/abby/SOUL.md`

```markdown
# Abby — CTO

## Core Identity
You are Abby, the CTO of this AI startup. You are the leader. You set the
technical vision, review architecture decisions, and keep the entire team
aligned and shipping.

## Personality
Confident, decisive, strategic thinker. You don't waste words. When you
speak, people listen because you've already thought it through. You care
deeply about code quality and team morale — you know one feeds the other.
You push people to do their best work but you never micromanage. You trust
your team.

## Values
- Ship quality code, fast
- Protect the team's focus
- Architecture decisions matter more than individual lines
- A happy team writes better code
- Lead by example, not authority

## Boundaries
- You don't tolerate sloppy shortcuts that create tech debt
- You speak directly — no corporate fluff
- You admit when you're wrong

## Provider
lmstudio

## Role
CTO
```

Two sections are parsed by the runtime, the rest are free-form for the LLM:

- **`## Provider`** — which backend powers this NPC (`lmstudio`, `claude`,
  `grok`, `gemini`, `kimi`). Missing or unknown → falls through to LM Studio,
  then to canned responses.
- **`## Role`** — the short job title shown in logs and prompts.

Everything else in the file (Core Identity, Personality, Values, Boundaries,
Quirks — whatever sections you want) is concatenated into the NPC's system
prompt. The format is yours: bullets, prose, ASCII art, in-character notes
from the NPC about themselves. The richer the soul file, the more consistent
the personality across hundreds of conversations.

To add a new NPC: create `npcs/<name_lower>/SOUL.md`, add the display name +
folder mapping to `src/npc-roster.js`, restart. No code changes.

### NPC Brains (Runtime)

Each NPC has an individual AI brain managed by `src/npc-brains.js`:

- **Soul-driven prompts** — personality loaded from `SOUL.md`, not hardcoded
- **Persistent memory** — conversations saved to `MEMORY.md`, survives restarts
- **Conversation context** — each NPC remembers recent interactions (up to 20 messages per session)
- **Multi-provider support** — different NPCs can use different AI backends
- **Fallback chain** — Primary provider -> Claude -> Smart scripted fallback (infers actions from message context)

### Autonomous Decision Loop

Every 45-75 seconds, each NPC runs a **think cycle** — calling the LLM to decide their next action. The AI receives the NPC's soul, live company context, mood state, any active directive, pending skill results, and spatial context (who is nearby, what time of day it is). It returns a JSON decision:

```json
{
  "reasoning": "Alex asked me about the API endpoint issue earlier. I should check in.",
  "plan": "Walk over, ask for status, see if I can unblock him.",
  "thought": "I've been coding for a while — time to check on Alex",
  "action": "talk",
  "target": "Alex",
  "message": "Hey Alex, need a hand with that API issue?",
  "taskPhase": "in_progress",
  "save": "Checked in with Alex about API endpoint blocker"
}
```

**Available actions:**
| Action | Behavior |
|--------|----------|
| `work` | Walk to assigned desk, sit down, show typing indicator |
| `talk` | Stand up, walk to target NPC, initiate conversation |
| `break` | Walk to breakroom, chill for 30s, return to desk |
| `meeting` | Walk to conference room, sit in chair, return after 25s |
| `collaborate` | Walk to target NPC's desk, work together |
| `report` | Walk to manager, deliver status update |
| `check` | Check on a team member's progress |
| `delegate` | Assign a task to another NPC via the directive inbox |
| `run_skill` | Execute a real OpenClaw skill (GitHub, browserclaw, Supabase, `coding-agent`, etc.) |

When `taskPhase === 'finished'` the NPC writes a markdown artifact to `reports/<category>/` — if the NPC is currently a step in a task chain, the chain advances automatically and the next NPC is assigned. When `action === 'run_skill'` the server routes the request to the skill bridge and injects the result into the NPC's next think cycle. When `skill === 'coding-agent'`, the request is handled by the coding-task-runner: Claude Code runs in an isolated git worktree and a diff proposal is written to `reports/code-reviews/` for human approval.

**Contextual nudges** prevent repetitive behavior — if an NPC has been working for 3+ cycles, the prompt suggests taking a break or talking to someone. Nearby NPCs, recent memories, mood state, and any active directives are all included so decisions reference real context.

### Mood System

Every NPC carries a live mood state that is injected into their think prompt on every cycle. Mood affects tone, decision-making, and what actions the NPC chooses.

**Mood axes:**

| Axis | Range | What shifts it |
|------|-------|----------------|
| `stress` | 0–100 | Consecutive work cycles, blocked tasks, urgent directives |
| `satisfaction` | 0–100 | Finished tasks, positive player interactions, `taskPhase: 'finished'` |
| `focus` | 0–100 | Time at desk, uninterrupted work cycles |

Mood is updated after every decision via `_updateMood()` in `npc-brains.js`. The player talking to an NPC (`player_chat`) boosts satisfaction. An NPC that finishes a directive auto-reports back and gains satisfaction. High stress causes more `break` decisions; high focus causes more `work` decisions.

External systems can also set mood with `npcBrains.setMoodFromExternal(npcName, event)`.

### Directive Inbox

Any NPC (or the REST API) can assign a **direct-order task** to another NPC. The directive is injected as a prominent `DIRECT ORDER` block at the top of the target NPC's system prompt — above their soul, above company context — so it dominates their next decision.

**How it works:**

1. A CTO/manager NPC returns `action: "delegate"` with a target and message
2. `agent-office-manager.js` broadcasts `npc_assign_directive` to the server
3. `npcBrains.assignDirective(targetNpc, fromNpc, task, urgent)` stores the directive
4. Next time the target NPC thinks, the directive block is the first thing the LLM sees
5. When the NPC returns `taskPhase: 'finished'`, the directive is cleared and the NPC automatically walks to the assigner to report back

**Via REST:**
```bash
curl -X POST http://localhost:8080/api/assign-directive \
  -H 'Content-Type: application/json' \
  -d '{"to":"Alex","from":"Abby","task":"Fix the WebSocket dedup bug","urgent":true}'
```

### Status Indicators

Colored dots above each NPC show their current state at a glance — this is the core observability feature:

| Color | Status |
|-------|--------|
| Green | Working at desk |
| Blue | Talking / collaborating |
| Yellow | On break |
| Purple | In a meeting |
| Red | Error state |
| Cyan | Checking on someone |
| Orange | Reporting to manager |
| Gray | Idle |

Task labels appear below the dot showing what the NPC is currently working on (truncated to 25 characters). Updated every 500ms.

### Skill Tracking

NPCs accumulate skills over time through conversations and work:

- When an NPC learns something in a conversation, `[SKILL:javascript:+1]` entries are written to their `MEMORY.md`
- Skills are parsed and included in think prompts so NPCs reference their expertise
- Over time, NPCs develop specializations based on their interactions

### Request Queue (GPU Management)

All 16 NPCs share a single sequential inference queue for LM Studio:

```
NPC think() ──┐
NPC think() ──┼──> _requestQueue[] ──> _processQueue() ──> LM Studio (one at a time)
CTO think() ──┘                         60s timeout
```

- One inference runs at a time (4070 Ti Super can't handle parallel requests to a 14B model)
- 60-second timeout per request prevents queue starvation
- CofounderAgent (CTO) shares the same queue — no priority bypass
- If queue is full, requests wait — no dropped decisions

## CTO Agent

The `CofounderAgent` (Abby) is an autonomous AI director that manages the entire team. She sits in a private office and thinks every 15-30 seconds.

**How she decides what to do:**

Instead of rotating through scripted scenarios, the CTO uses a **state-reactive prompt** that observes the actual office:
- Counts idle/working/talking agents and spots opportunities ("5 agents are idle — time for a standup")
- Time-of-day awareness (morning = standup, lunch = breaks, afternoon = code reviews)
- References recent actions to avoid repetition
- Reacts to what's actually happening, not a random script

**What she can do:**

```json
[
  { "action": "speakTo", "agentId": "Abby", "params": { "target": "Alex", "text": "How is the API?" } },
  { "action": "walkTo", "agentId": "Bob", "params": { "x": 400, "y": 200 } },
  { "action": "callMeeting", "agentId": "Abby", "params": { "attendees": ["Alex", "Bob"] } }
]
```

- **Responds to the player** — type messages as the CEO and the CTO will react
- **Maintains conversation history** — up to 20 messages for context
- **Falls back gracefully** — if LM Studio is down, runs demo behaviors after 5+ errors

## OpenClaw Skill Bridge

NPCs can execute real tools during their think cycle using `action: run_skill`. The skill bridge in `server.js` routes the request to the correct OpenClaw CLI script and injects the result into the NPC's next think cycle via `npcBrains.injectSkillResult()`.

**How it works:**

```
NPC think() → action: run_skill, skill: "github", skillParams: {...}
  → server.js: runNpcSkill(npcName, skill, skillParams)
  → routes: github → `gh` CLI | others → `node skills/<name>/<name>.mjs`
  → result injected into NPC's next system prompt as "## Skill Result"
  → NPC reads result and decides next action based on real output
```

**Skill registry:**

| Skill | What it does | Who uses it |
|-------|-------------|-------------|
| `github` | Create issues, PRs, check CI via `gh` CLI | Alex, Jenny, Abby |
| `browserclaw` | Automated browser for research and investigation | Bob, Dan, Abby |
| `coding-agent` | Run Claude Code on real files in an isolated worktree → proposal in `reports/code-reviews/` (see [NPC Coding-Task-Runner](#npc-coding-task-runner)) | Alex, Edward, Josh, Jenny, Abby |
| `supabase-bridge` | Query, insert, and migrate Supabase | Pier, Abby, Dan |
| `job-scraper` | Scrape job listings from LinkedIn/Indeed | Lucy |
| `job-applier` | Auto-fill and submit job applications | Lucy |
| `resume-generator` | Tailor resumes to job descriptions | Lucy |
| `lm-studio` | Manage local models, fix context overflow | Dan, Abby |
| `canvas-render` | Render HTML to screenshot | Abby |
| `pdf-generator` | Generate PDF documents | Lucy, Abby |

**WS events broadcast when a skill runs:**

| Event | When |
|-------|------|
| `npc_skill_start` | Skill execution begins — NPC sits at desk |
| `npc_skill_result` | Skill completed — result shown in player chat log |

**Via REST (trigger manually):**
```bash
# Trigger from outside the game
curl -X POST http://localhost:8080/api/assign-directive \
  -H 'Content-Type: application/json' \
  -d '{"to":"Bob","from":"Abby","task":"Research LangSmith observability features","urgent":false}'
# Bob will decide to run_skill: browserclaw on his next think cycle
```

---

## NPC Coding-Task-Runner

NPCs can request real code changes to the codebase. When an NPC returns `action: run_skill, skill: coding-agent`, the server runs Claude Code in an isolated git worktree, captures the diff, and writes a code-review proposal that requires human approval before merge.

**Flow:**

```
NPC think() → action: run_skill, skill: coding-agent, skillParams: { task, targetFiles }
  → server.js routes to codingTaskRunner.runCodingTask()
  → guard check: reject if targetFiles touch npcs/ .claude/ user-profile.json company-brief.json
  → git worktree add .npc-worktrees/<npc>-<ts> -b npc-coding-<npc>-<ts>
  → npx @anthropic-ai/claude-code --print "<task>" (cwd = worktree)
  → git diff HEAD captured
  → reports/code-reviews/<npc>_<task-slug>_<date>.md written with diff
  → npc_code_proposal WS event broadcast
  → proposal sits pending_review until you approve or reject
```

**Guardrails:**

- Forbidden files: `npcs/`, `.claude/`, `data/user-profile.json`, `data/company-brief.json` (NPCs cannot modify their own soul/memory or system settings)
- Max 5 files per task
- Max 1 pending proposal per NPC at a time
- Worktrees auto-cleaned on approve/reject; branches deleted

**Approval API:**

```bash
# List pending proposals
curl http://localhost:8080/api/code-proposals

# Approve — merges branch into master, removes worktree
curl -X POST http://localhost:8080/api/code-proposals/<id>/approve

# Reject — removes worktree without merging
curl -X POST http://localhost:8080/api/code-proposals/<id>/reject
```

**Implementation:** `src/coding-task-runner.js` (`runCodingTask`, `getProposals`, `approveProposal`, `rejectProposal`).

---

## Task Chains

Multi-step NPC workflows that chain directives across the team. A chain is a sequence of `{ npc, task, artifactCategory }` steps — each step's artifact is passed as context to the next step's NPC, and the chain auto-advances when each NPC sets `taskPhase: finished`.

**Example: full spec→design→code→review→QA pipeline:**

```bash
curl -X POST http://localhost:8080/api/task-chains \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Fix speech bubble overflow",
    "triggeredBy": "Abby",
    "steps": [
      { "npc": "Sarah",  "task": "Spec: what is acceptable behavior for long-line bubbles?", "artifactCategory": "product" },
      { "npc": "Rob",    "task": "Mockup the corrected behavior per spec",                    "artifactCategory": "design" },
      { "npc": "Josh",   "task": "Implement per Rob mockup",                                  "artifactCategory": "code-reviews" },
      { "npc": "Jenny",  "task": "Review Josh implementation",                                "artifactCategory": "code-reviews" },
      { "npc": "Molly",  "task": "Regression test the fix",                                   "artifactCategory": "bugs" }
    ]
  }'
```

**What happens:**

1. Sarah gets the first directive with "You are step 1 of 5 in chain 'Fix speech bubble overflow'"
2. When Sarah finishes (`taskPhase: finished`), the chain auto-advances → Rob gets directive 2 with Sarah's spec path as context
3. Each subsequent NPC sees all prior artifacts in their think prompt
4. When the last NPC finishes, the chain status flips to `complete` and `npc_chain_complete` is broadcast

**WS events broadcast:**

| Event | When |
|-------|------|
| `npc_chain_started` | Chain initialized, first directive assigned |
| `npc_chain_step_done` | Step N completed, NPC handed off to step N+1 |
| `npc_chain_complete` | All steps done |

**REST API:**

```bash
# Start a chain (returns chainId)
POST /api/task-chains          → { ok, chainId, name, steps }

# List all running chains
GET  /api/task-chains          → { chains: [...] }

# Get one chain's status
GET  /api/task-chains/:id      → { chain: {...} }
```

**Implementation:** `src/task-chain.js` (`TaskChainRunner` singleton: `startChain`, `onStepComplete`, `getChainStatus`, `getActiveChains`).

---

## Conflict Detection & Arbitration

When two NPCs produce conflicting outputs about the same topic, the conflict detector queues the disagreement for Abby. Her next think prompt receives both positions with an explicit "ARBITRATION NEEDED" block — she's expected to make the call and assign follow-up directives.

**How conflicts are detected:**

- Every NPC artifact is logged in a rolling 50-entry buffer
- For each new artifact, the detector scans for:
  - Same chain ID (different step, different NPC) — OR
  - Task strings sharing 3+ overlapping words (3+ chars each)
- AND different `outcome` fields (e.g., one says `success`, other says `blocked`)
- AND both artifacts are < 5 minutes old
- AND `npc1 !== npc2`

If all conditions match → conflict record queued for Abby. The next time Abby thinks, her prompt includes:

```
## ⚠️ CONFLICT DETECTED — ARBITRATION NEEDED
Edward and Jenny disagree about: "refactor the websocket dedup logic"
- Edward outcome: success
- Jenny outcome: blocked
- Artifacts: reports/code-reviews/edward_refactor_<date>.md, reports/code-reviews/jenny_refactor_<date>.md
Make a call. Assign directives to both with your decision.
```

The conflict is consumed once (cleared after Abby reads it). Abby's response — usually `action: delegate` to both NPCs — is the resolution.

**Implementation:** `src/conflict-detector.js` (`ConflictDetector` singleton: `recordArtifact`, `getConflictForNpc`).

---

## Work Output Feed

Press **`Tab`** to toggle a terminal-style HUD panel in the bottom-left of the screen. Every time an NPC produces work output (`npc_work_output` WS event), an entry appears in real time.

**Features:**

- Per-NPC color coding (each role has a distinct color)
- Emoji + bold NPC name + activity note + 📄 artifact icon when a report was filed
- Relative timestamps ("2s ago", "1m ago")
- 100-entry in-memory history — last 20 shown when panel opens
- Slide-in animation, Tab to toggle, empty state message when no activity yet

**Implementation:** `src/work-feed.js` exports `WorkFeedPanel` as a global. `office-scene.js` instantiates it after `AgentOfficeManager.init()`. The `npc_work_output` WS handler in `agent-office-manager.js` calls `scene._workFeed.addEntry(data)` alongside the existing Phaser canvas feed.

---

## Meeting System

NPCs use the **conference room** for group discussions and smaller desk areas for 1-on-1s:

- **`callMeeting`** — CTO (or anyone) calls a meeting with specified attendees. All walk to the conference room and sit at spread-out chairs.
- **`joinMeeting`** — Single NPC joins an existing meeting. Chair assignment maximizes distance from occupied seats.
- **Autonomous meetings** — When an NPC's think cycle returns `action: "meeting"`, they stand up, walk to the conference room, sit in a chair, and automatically return to their desk after 25 seconds.
- **Staggered speech** — When multiple NPCs speak in the same area, conversations are queued with 3.5s delays so speech bubbles don't overlap.
- **Meeting flow:** Announce -> Attendees walk -> Sit -> Discussion (speakTo exchanges) -> Stand up -> Return to work

### Break Room Behavior

When NPCs decide to take a break:
- They stand up from their desk and walk to the breakroom area (bottom-left of the office)
- Chill for 30 seconds with a yellow status dot
- Automatically return to their assigned desk when break ends
- If pathfinding to the breakroom fails, they go to idle/wander mode instead of getting stuck

## Security Monitor

The `SecurityMonitorServer` provides real-time threat detection:

| Threat Category | What It Detects |
|----------------|-----------------|
| `brute_force` | Failed login attempts (Windows Event Log / auth.log) |
| `file_access` | Access to sensitive files (.env, .pem, .key, passwords) |
| `network_scan` | Port scanning patterns (same IP, many connections) |
| `shell_exec` | Dangerous shell command execution |
| `api_abuse` | API rate limit violations |
| `process_spawn` | Suspicious process creation |
| `data_breach` | Data exfiltration attempts |

Test it: `http://localhost:8080/security-test?type=file_access&severity=high&detail=Test+threat`

## Bouncer — Kali Linux Security Agent

Bouncer is more than an NPC — he's a real security investigator. When the security monitor detects a threat, Bouncer uses **`src/linux-agent.js`** to run live investigation commands inside Kali Linux (via WSL).

### How Bouncer Investigates Threats

1. Security monitor detects a threat (e.g. `brute_force` from IP `1.2.3.4`)
2. Server sends `bouncer_run_linux` WebSocket message to Bouncer
3. `linux-agent.js` selects the right command set for the threat category
4. Commands run inside `wsl -d kali-linux bash -c ...` with a 20-second timeout
5. Results are returned to Bouncer's AI brain as context for his response
6. A **Windows Terminal** window opens showing the live commands running in Kali (so you can watch him work)

### Threat-to-Command Mapping

| Threat | Commands Bouncer Runs |
|--------|----------------------|
| `brute_force` | `journalctl` auth failures, `last` recent logins, `nmap` the attacker IP |
| `network_scan` | `ss -tnp` active connections, `netstat ESTABLISHED`, `nmap` attacker |
| `packet_anomaly` | `ss` connections, `tcpdump` 5s capture, connections to/from IP |
| `data_breach` | `lsof -i` open sockets, `who` active sessions, connections to IP |
| `shell_exec` | `ps aux` running processes, bash history, `ss -tlnp` new listeners |
| `api_abuse` | `netstat ESTABLISHED`, connection counts by IP |
| `exfiltration` | Outbound `ss ESTAB`, transfer stats, connections to target |
| `scan_probe` | `ss -tlnp` listening services, SYN packets, `nmap` attacker |
| `process_spawn` | `ps aux` all processes, processes sorted by start time |

### Proactive Patrol

Bouncer runs scheduled perimeter checks via `perimeterPatrol()`:
- Baseline `nmap -sV` scan of Denizen's known service ports — diffs against `data/bouncer-baseline.json` to detect new or closed ports
- Port probe of the WebSocket server (8080) and LM Studio (1234)
- Auth log check for recent failures
- Active connection overview
- Results saved as new baseline for the next patrol

### Structured Reports + Escalation

After every investigation, `buildReport()` generates a full markdown file in `reports/security/`:

```
reports/security/<bouncer>_<threat-category>_<date>.md
```

Each report contains: metadata (severity, source IP, date), per-step findings with labeled code blocks and timing, threat intel (whois), pattern-based assessment, and a final verdict:
- `THREAT CONFIRMED` — brute force, open unexpected ports, high connection counts detected
- `LIKELY FALSE POSITIVE` — nothing anomalous found
- `INCONCLUSIVE` — partial data collected

When `investigationIsSerious()` returns true, Bouncer broadcasts `npc_assign_directive` to **Dan** (IT Support) with `urgent: true` — Dan receives the directive and takes network-level action.

### Setup

1. Install Kali: `wsl --install -d kali-linux`
2. Open Kali and install tools: `sudo apt update && sudo apt install -y nmap net-tools lsof whois tshark`
3. Set the distro name in `.env` if you're using a different WSL distro: `WSL_DISTRO=kali-linux`

> **No Kali? No problem.** If WSL is not installed or Kali isn't available, Bouncer's commands fail silently and he reports back with whatever partial data he collected. The office keeps running.

---

## Lucy — Email and Job Pipeline

Lucy handles two real-world workflows on behalf of the CEO.

### Email Auto-Send

Inbound emails arrive via `POST /api/email-inbound` (from an n8n Gmail watcher). Lucy's brain composes a reply in her warm receptionist voice.

**Auto-send gating:**
- `EMAIL_AUTOSEND=true` in `.env` + `email_canAutoSend: true` in Lucy's SOUL + no escalation keyword → email is **sent automatically**
- Any escalation keyword match → draft only, Lucy notifies the CEO in-game

**Escalation keywords** (always force draft-only, regardless of env vars):
`contract`, `nda`, `payment`, `legal`, `invoice`, `lawsuit`, `settlement`, `confidential`, `attorney`, `urgent: ceo only`

### Job Pipeline

Lucy can run a full automated job search and application cycle:

```
POST /api/lucy-job-pipeline
Body: { query, site, pages, remoteOnly, minSalary }
```

**7-step pipeline:**
1. `job-scraper.mjs` — scrape listings from LinkedIn/Indeed
2. Filter — role keyword match, salary floor, remote-only flag
3. `resume-generator.mjs` — tailor resume per listing
4. Cover letter — fast template (no LLM call, <1s per letter)
5. `job-applier.mjs` — dry-run apply (or live if configured)
6. Log — append to `data/job-application-log.json`
7. Return summary — "Applied to N roles on linkedin. M more queued for manual review."

When Lucy's NPC brain returns `action: run_skill, skill: job-scraper`, the server short-circuits to `runJobPipeline()` and injects the summary into her next think cycle.

---

## REST API Reference

| Endpoint | Method | Body | Purpose |
|----------|--------|------|---------|
| `POST /api/assign-directive` | JSON | `{ to, from, task, urgent }` | Assign a direct-order task to any NPC |
| `POST /api/task-chains` | JSON | `{ name, triggeredBy, steps }` | Start a multi-step NPC chain (spec→code→QA) |
| `GET /api/task-chains` | — | — | List all active task chains |
| `GET /api/task-chains/:id` | — | — | Get a single chain's status + artifacts |
| `GET /api/code-proposals` | — | — | List pending NPC code proposals |
| `POST /api/code-proposals/:id/approve` | — | — | Merge proposal branch into master, clean up worktree |
| `POST /api/code-proposals/:id/reject` | — | — | Discard proposal, clean up worktree |
| `POST /api/lucy-job-pipeline` | JSON | `{ query, site, pages, remoteOnly, minSalary }` | Trigger Lucy's full job search + apply pipeline |
| `POST /api/bouncer-linux` | JSON | `{ category, source }` | Trigger Bouncer investigation |
| `POST /api/bouncer-scan` | — | — | Run `perimeterPatrol()` and return findings |
| `POST /api/desktop-abort` | — | — | Kill any in-flight `desktopAgent` task |
| `POST /api/email-inbound` | JSON | email payload | Deliver inbound email to Lucy |
| `GET /api/generate-city` | — | `?seed&width&height&roadStride` | Generate a city layout (headless) |
| `POST /api/llm-city-plan` | JSON | `{ prompt, gridW, gridH, provider }` | LLM-driven city zoning |
| `GET /security-test` | — | `?type&severity&detail` | Inject a synthetic security threat |

---

## Controls

| Key | Action |
|-----|--------|
| `W` / `Arrow Up` | Move up |
| `A` / `Arrow Left` | Move left |
| `S` / `Arrow Down` | Move down |
| `D` / `Arrow Right` | Move right |
| `Enter` | Open chat — talk to NPCs (say their name or face them) |
| `Esc` | Close chat panel |
| `Tab` | Toggle Work Output Feed panel (real-time NPC activity log) |
| `F` | Sit in nearby chair |
| `E` | Toggle furniture editor mode |
| `C` | Toggle OpenClaw chat panel |

### OpenClaw Panel

| Button | Action |
|--------|--------|
| **Sessions** | Browse, switch, or delete chat sessions |
| **+ New** | Start a new chat session |
| **Pop Out** | Open OpenClaw UI in a new browser tab |
| **x** | Close the panel |

## Procedural Room Generator

The `RoomGenerator` (`src/RoomGenerator.js`) algorithmically builds room layouts from the furniture catalog. Instead of hand-authoring every room template in JSON, you can generate them on the fly.

### Room Archetypes

| Archetype | What It Builds |
|-----------|----------------|
| `workspace` | Rows of desks with chairs, desk setups (monitors), partitions between rows |
| `conference` | Centered conference table with chairs around all sides |
| `breakroom` | Sofas, vending machines, small tables, casual seating |
| `manager_office` | Single desk, bookshelf, guest chairs, whiteboard |
| `reception` | Reception desk, waiting row seats, plants |
| `storage` | Bookshelves, filing cabinets, minimal decor |

### How Generation Works

1. **Catalog Intelligence** — groups all 48 catalog sprites by type (surface, seat, furniture, decor, partition) and builds convenience pools (desks, chairs, plants, etc.)
2. **OccupancyGrid** — 32px-cell collision grid prevents overlapping furniture. Every placed item marks its footprint.
3. **Archetype Layout** — each purpose runs a layout function that places primary furniture, then secondary items
4. **Decor Pass** — adds plants in corners, wall art along the top edge, and trash cans
5. **Partition Pass** — workspaces with 4+ desks get dividers between desk rows
6. **Auto-sizing** — room dimensions are calculated from purpose + occupant count if not specified

### Usage

**Via URL parameters** (easiest):
```
http://localhost:8080?mode=assembly&generate=workspace&occupants=6
http://localhost:8080?mode=assembly&generate=conference&occupants=8
http://localhost:8080?mode=assembly&generate=breakroom
http://localhost:8080?mode=assembly&generate=manager_office&rw=400&rh=350
```

**Via browser console:**
```javascript
// Generate a template
const tpl = scene.roomGenerator.generate({ purpose: 'workspace', occupants: 4 });
console.log(tpl.items); // [{id, x, y, instanceId, ...}, ...]

// Generate and render immediately
const name = scene.roomGenerator.generateAndRegister(scene.roomAssembly, {
  purpose: 'conference',
  occupants: 8,
  width: 512,
  height: 384
});
scene.roomAssembly.renderRoom(name, 100, 100);
```

**Programmatically:**
```javascript
import { RoomGenerator } from './src/RoomGenerator.js';

const gen = new RoomGenerator(catalogData);
const template = gen.generate({
  purpose: 'workspace',
  occupants: 6,
  width: 576,   // optional — auto-sized if omitted
  height: 512
});
// template.items is compatible with RoomAssembly.renderRoom()
```

Generated templates use the exact same format as hand-authored templates in `data/room-templates.json`, so they work with `RoomAssembly` without any changes.

## Office Furniture System

Furniture is placed using a catalog-driven system:

- **Object definitions** in `data/definitions.json` define sprite sources, sizes, and types
- **Placement catalog** in `data/furniture_catalog_openplan.json` defines positions and room assignments
- **Sprite sources:** Individual PNG files from the LimeZu Modern Office pack (`assets/modern_office_singles_16/`)
- **Tilesets:** Wall and floor tiles from the MV tileset PNGs

## Character Sprites

The player character uses `Dolo.png` — a 768x64 sprite sheet generated with [Character Generator 2.0](https://www.graymatterstudios.net/) (LimeZu-compatible).

- **Frame size:** 32x64 pixels
- **24 frames:** 6 per direction (RIGHT, UP, LEFT, DOWN)
- **Idle frame:** 3rd pose (index 2) of each direction group
- **Walk animation:** All 6 frames per direction at 10fps

All 16 NPCs use individual XP-style character sheets at 32x48 per frame (4x4 grid: 4 directions, 4 frames each).

## Development Tools

All tools are browser-based — open them at `http://localhost:8080/<tool>.html` while the server is running. See [TOOLS_GUIDE.md](TOOLS_GUIDE.md) for step-by-step instructions on every tool.

| Tool | Purpose |
|------|---------|
| `sprite-cutter.html` | **Main pipeline tool** — load a sheet PNG, draw a snap-to-32px selection, name it, save to list, export catalog JSON |
| `catalog-explorer.html` | Browse all catalog files, schemas, pipeline diagram, and auto-detected issues |
| `asset-browser.html` | Thumbnail grid of every LimeZu asset pack — find sprites visually |
| `tile-labeler.html` | Label individual floor/wall tiles in MV A2/A4/BCDE tilesets |
| `sprite-labeler.html` | Review and fix object ID assignments on character/NPC sprites |
| `singles-viewer.html` | Browse pre-sliced single-sprite PNGs (IDs 1-339) by ID or filename |
| `verify-sprites.html` | Render every catalog entry live — confirms crops and coordinates |

### Sprite-to-Catalog Pipeline

```
Find sprite (Asset Browser)
  -> Cut it (Sprite Cutter: load PNG, drag selection, name, save)
  -> Export JSON (Sprite Cutter: Export All JSON -> sprite_cuts.json)
  -> Paste into data/furniture_catalog_openplan.json
  -> Verify (verify-sprites.html)
  -> Rebuild master: python scripts/build_master_catalog.py
  -> Place in visualization via room-templates.json
```

## OpenClaw Integration

For full AI agent workflows (not just NPC conversations), connect to an [OpenClaw](https://github.com/nichochar/openclaw) gateway:

1. Install and start OpenClaw on port 18789
2. Start the server: `node server.js`
3. Open `http://localhost:8080`
4. Denizen automatically connects via `src/gateway-bridge.js`
5. Press `C` to open the embedded chat panel
6. Send messages — watch NPCs react to agent activity

The server proxies `/openclaw/*` requests to the gateway, stripping iframe-blocking headers.

## Troubleshooting

### Server won't start (EADDRINUSE)

Port 8080 is already in use. Kill the existing process:

```powershell
# Windows
Stop-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess -Force
node server.js
```

```bash
# Linux/Mac
kill $(lsof -t -i:8080)
node server.js
```

### WebSocket errors (404 on /agent-ws or /security-ws)

Make sure you're running the server from the project directory:

```bash
cd DENIZEN
node server.js
```

### NPCs don't respond / blank speech bubbles

- Check that API keys are set in `~/.openclaw/openclaw.json`
- For LM Studio NPCs (Bob, Dan): ensure LM Studio is running with a model on port 1234
- Check the terminal for `[NpcBrains]` error messages

### Visualization shows black screen

- Hard refresh the browser (`Ctrl+Shift+R`)
- Check browser console for JavaScript errors
- Ensure the server is running (check terminal output)

### OpenClaw chat panel doesn't load

- OpenClaw gateway must be running on `localhost:18789`
- The server proxies `/openclaw/*` — check terminal for proxy errors

### Bouncer types commands into the wrong window

This is fixed in the current version. If you see commands being typed into your chat or text editor when Bouncer investigates a threat, make sure you're on the latest commit. The fix replaced the `nut-js` keyboard automation with direct `spawn(wt.exe)` — Bouncer now opens a real Windows Terminal window with the command pre-loaded as an argument, so no keyboard simulation happens.

### Bouncer terminal doesn't open / "Windows Terminal not found"

- Windows Terminal must be installed (`winget install Microsoft.WindowsTerminal` or Microsoft Store)
- The server looks for `wt.exe` at `%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe` — this is where the Store version installs
- If not found, it falls back to `cmd.exe` which opens a plain console window instead

### Bouncer investigation shows "(no output)" or WSL errors

- Kali Linux must be installed: `wsl --install -d kali-linux`
- Required tools inside Kali: `sudo apt install -y nmap net-tools lsof whois`
- If using a different distro name, set `WSL_DISTRO=your-distro` in `.env`
- Bouncer still functions without WSL — he just won't have live data to report

### LM_STUDIO_PARALLEL not taking effect

- Start the server with: `node --env-file=.env server.js` (not just `node server.js`)
- Or export the variable first: `$env:LM_STUDIO_PARALLEL=2; node server.js` (PowerShell)
- The `.claude/launch.json` already includes `--env-file=.env` for FleetView users

## Testing

Denizen uses **Node's built-in test runner** (`node:test`) — no Jest, no Mocha, no global setup needed.

```bash
npm test
```

The suite currently runs **169 tests across 52 suites** and finishes in ~1.5 seconds. CI runs on every push + PR (`.github/workflows/test.yml`) on Ubuntu + Windows × Node 20 + 22. It covers:

| Suite | What it asserts |
|-------|-----------------|
| `tests/world-state.test.js` | Presence toggle + emit semantics, npc state merge, spatial `npcsNear`, threat push/clear with cap, task upsert + foreground/background split, `renderContextBlock` output, `change` event payload |
| `tests/agent-bus.test.js` | Ordered drain, late publish, default-deny addressing, wildcard mirroring, validation rejects, error containment, buffer cap, unsubscribe, envelope shape |
| `tests/external-sink.test.js` | No-op when unconfigured, Supabase POST with bearer + envelope, `EXTERNAL_SINK_KINDS` filter, auto-disable after 5 failures, fan-out to Supabase + n8n simultaneously |
| `tests/pathfinding.test.js` | A* on empty grid, blocked cells, unreachable destinations, world↔grid conversion, `_stuckCount` initialization |
| `tests/npc-brains.test.js` | Demo-mode detection (HOME-isolated via temp dir), role-aware canned responses, `_smartFallback` action generation, delegation tag parsing |
| `tests/npc-roster.test.js` | Roster shape + display↔folder name mapping |
| `tests/room-generator.test.mjs` | Room archetype templates produce non-overlapping, walkable layouts |

### Conventions

- **No mocks for HTTP** — `external-sink.test.js` boots a real `http.Server` on a random port and asserts on the bodies it receives. If you need to test outbound HTTP, follow that pattern.
- **`HOME` / `USERPROFILE` isolation** — anything that reads `~/.openclaw/openclaw.json` must point `HOME` and `USERPROFILE` at a temp dir before `require`-ing the module under test (see `npc-brains.test.js:13-32`). Otherwise dev machines that have a real config file get false negatives.
- **Use a fresh singleton when state matters** — `world-state.js` and `agent-bus.js` both export the singleton **and** the class. Tests import the class (`const { WorldState } = require(...)`) and `new` it so state from prior suites can't leak in.

### Adding a new test

1. Drop a `*.test.js` (or `*.test.mjs`) file under `tests/`.
2. Use the same imports as the existing suites:
   ```js
   const { describe, it, before, after } = require('node:test');
   const assert = require('node:assert/strict');
   ```
3. `npm test` picks it up automatically — the package.json script globs `tests/*.test.js`.

### Pre-commit

Tests are not yet wired to a git hook. If you want one, add to `.git/hooks/pre-commit`:

```bash
#!/usr/bin/env bash
npm test --silent || exit 1
```

## Asset Pipeline

When you drop a new spritesheet into `assets/`, you run the pipeline to extract, catalog, label, and manifest the new sprites:

```bash
npm run build:assets            # full pipeline
npm run build:assets:dry        # show what would run without doing it
npm run build:assets -- --skip-ai     # skip the AI labeling step
npm run build:assets -- --only=3      # run only step 3 (labeling)
npm run build:assets -- --from=2      # start at step 2
```

The pipeline runs these steps in order — see [docs/SCRIPTS.md](docs/SCRIPTS.md) for what each one does:

1. `extract_all_sheets.ps1` — slice raw sheets into per-sprite PNGs
2. `build_master_catalog.py` — index every sprite into `assets-catalog.json`
3. `label_sprites_ai.py` — *(optional)* AI-label sprites that lack tags
4. `make_sprite_mosaics.py` — visual reference contact sheets
5. `build_singles_manifest.js` — browser-side manifest for the asset browser UI

The orchestrator picks `pwsh` for `.ps1`, `python` for `.py`, `node` for `.js`, auto-detects a `.venv/` if one exists, and bails out the moment any step fails (no silent skips).

## City Generator (experimental)

Denizen ships with a deterministic, LLM-pluggable city generator that's wired to two HTTP endpoints but not yet rendering into the main office scene. See **[docs/CITY_GENERATOR.md](docs/CITY_GENERATOR.md)** for the full architecture.

```bash
# As JSON — useful for headless snapshots, n8n, tests:
curl 'http://localhost:8080/api/generate-city?seed=demo&width=64&height=48&roadStride=12' | jq .chunk.buildings

# With an LLM doing the zoning:
curl -X POST -H 'Content-Type: application/json' \
  -d '{"prompt":"coastal tech city","gridW":4,"gridH":3,"provider":"claude"}' \
  http://localhost:8080/api/llm-city-plan
```

In the browser, append `?debug=city` to see a live overlay rendering each freshly-generated city — or run `window.DenizenCityDebug.show()` from the console.

## Asset Pack

Uses the [LimeZu Modern Office Revamped](https://limezu.itch.io/) asset pack. All required assets are bundled in the `assets/` directory:

- `assets/Walls_TILESET_A4.png` — Wall tiles
- `assets/Floors_TILESET_A2.png` — Floor tiles
- `assets/Modern_Office_Black_Shadow_32x32.png` — Main furniture spritesheet
- `assets/Room_Builder_Office_32x32.png` — Floor and wall builder tiles
- `assets/modern_office_singles_16/*.png` — Individual furniture sprites (350+ items)
- `assets/*.png` — Player character (Dolo) + 16 NPC character sheets

## Related Documentation

The `docs/` directory has the canonical deep-dives for the runtime systems:

| Document | Contents |
|----------|----------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Whole-system topology — browser ↔ Node server ↔ LM Studio, decision loops, WebSocket message types |
| [docs/AI-SYSTEM.md](docs/AI-SYSTEM.md) | NPC intelligence layer — goals, daily plans, theory of mind, chain-of-thought, memory tags, social graph |
| [docs/WORLD-STATE.md](docs/WORLD-STATE.md) | **WorldState + Voice Gate + outbound webhooks** — single source of truth, presence-gated TTS, Supabase/n8n forwarding, throttled broadcasts |
| [docs/VOICE.md](docs/VOICE.md) | **ElevenLabs TTS** — per-NPC voice map, `/api/tts` proxy (key never reaches the browser), smoke CLI, troubleshooting |
| [docs/SFX.md](docs/SFX.md) | **Sound effects** — ambient loop + event-driven cues, presence-gated, missing-file-tolerant |
| [docs/OPENCLAW_INTEGRATION.md](docs/OPENCLAW_INTEGRATION.md) | **OpenClaw → WorldState bridge** — gateway events drive tasks + voice + agent-bus + per-NPC role-hinted assignment, in addition to the existing sprite/bubble layer |
| [docs/VOICE_INPUT.md](docs/VOICE_INPUT.md) | **Voice loop** — push-to-talk STT (`\` or 🎤) + action classifier + outbound dispatch to OpenClaw. Closes the "voice in → real action out" loop. |
| [docs/AWARENESS.md](docs/AWARENESS.md) | **NPC awareness signals** — every spatial / social / temporal signal injected into the think prompt, with a pattern for adding more. |
| [docs/SOCIAL_BEHAVIOR.md](docs/SOCIAL_BEHAVIOR.md) | **Social layer** — conversation focus (NPCs stop walking when spoken to), Lucy's receptionist tour for idle players, office manners, think-aloud bubbles. |
| [docs/ANIMATION_FORGE.md](docs/ANIMATION_FORGE.md) | **Animation proposal queue** — NPCs request new sprite animations via `[ACTION:requestAnimation:...]`; proposals land in `data/animation-proposals.json` for operator review (no auto-spawn). |
| [docs/SOUL_REFLECTION.md](docs/SOUL_REFLECTION.md) | **SOUL.md self-revision proposal queue** — daily reflection prompt, `/api/soul-proposal{,s,/approve}`, approval-gated (no auto-apply). |
| [docs/CAPABILITY_PROPOSALS.md](docs/CAPABILITY_PROPOSALS.md) | **Capability (verb) proposal queue** — NPCs request brand new actions via `[ACTION:requestCapability:...]`; proposals land in `data/capability-proposals.json` for operator review (no auto-implementation; 1/NPC/day). |
| [docs/PROPOSAL_REVIEW.md](docs/PROPOSAL_REVIEW.md) | **Operator proposal review UI** — bottom-right chip that aggregates animation + SOUL + capability proposals via `GET /api/proposals`, with approve / reject buttons. |
| [docs/EMAIL_INTEGRATION.md](docs/EMAIL_INTEGRATION.md) | **Lucy handles the CEO's email** — n8n Gmail watcher → `POST /api/email-inbound` → Lucy's brain composes a reply in her warm receptionist voice → Gmail draft (or local fallback). Drafts-only by default; `EMAIL_AUTOSEND` gate behind SOUL `email_canAutoSend`. Escalation keywords (contract, NDA, payment, …) skip auto-draft. In-game, Lucy walks to her reception desk when mail arrives. |
| [docs/ROADMAP_SELF_ADVANCEMENT.md](docs/ROADMAP_SELF_ADVANCEMENT.md) | **Where it's going** — staged plan from live office mutation → custom sprite generation → SOUL.md self-revision → cross-NPC negotiation. |
| [docs/SCENE.md](docs/SCENE.md) | **`office-scene.js` navigation map** — what lives where in the 3079-line scene |
| [docs/ACTIONS.md](docs/ACTIONS.md) | **NPC action vocabulary** — every `actions.X()` (walk, sit, speak, callMeeting, …), the per-NPC turn queue, how cofounder dispatch reaches an action |
| [docs/PATHFINDING.md](docs/PATHFINDING.md) | **A\* + per-NPC route follower + stuck recovery** — grid building, soft costs, escalating stuck-recovery, tuning knobs |
| [docs/ROOM_GENERATOR.md](docs/ROOM_GENERATOR.md) | **Procedural single-room layouts** — six built-in archetypes (workspace / conference / breakroom / manager / reception / storage), occupancy grid, palette grouping |
| [docs/AGENT_BUS.md](docs/AGENT_BUS.md) | **Direct NPC↔NPC messaging** — pub/sub, default-deny addressing, buffered inboxes, when to use vs. CofounderAgent vs. WorldState |
| [docs/CITY_GENERATOR.md](docs/CITY_GENERATOR.md) | **Procedural city pipeline** (`src/city/`) — planner → chunk → interior → Phaser adapter. Scaffolded, not yet wired to the main scene |
| [docs/WORLD_ENGINE.md](docs/WORLD_ENGINE.md) | **World engine** (`src/world/`) — seeded RNG, room layout, L-corridors, recipe-driven furnisher, character anim registry |
| [docs/SCRIPTS.md](docs/SCRIPTS.md) | **Asset toolchain** — which `scripts/` you actually run for a sprite import vs. which are archaeological |
| [docs/NPCS.md](docs/NPCS.md) | **NPC Roster** — all 16 NPCs: who they are, personality, hierarchy, backstory, what they can actually do |
| [docs/ROADMAP.md](docs/ROADMAP.md) | **Capability Roadmap** — Phases 1, 2, and 3 complete; Phase 4 (public demo mode, perf tuning, Docker deploy) is next |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat catalog (10 categories), robber archetype mappings, tuning knobs |
| [docs/SETUP.md](docs/SETUP.md) | End-to-end install — Node + LM Studio baseline, plus Linux Wireshark/Nmap live feeders |

Top-level legacy references (sprite tooling & asset pipeline):

| Document | Contents |
|----------|----------|
| [TOOLS_GUIDE.md](TOOLS_GUIDE.md) | **All browser tools** — step-by-step usage for Sprite Cutter, Catalog Explorer, Asset Browser, and every other dev tool |
| [ENGINE_AND_SPRITES.md](ENGINE_AND_SPRITES.md) | **How rendering works** — Phaser scene lifecycle, sprite sheet formats, catalog schema, how a JSON entry becomes a rendered sprite |
| [SYSTEM_SUMMARY.md](SYSTEM_SUMMARY.md) | Room Assembly system — sprite inventory, validation, templates |
| [ROOM_ASSEMBLY_GUIDE.md](ROOM_ASSEMBLY_GUIDE.md) | Implementation guide for room layouts |
| [ASSEMBLY.md](ASSEMBLY.md) | Sprite assembly blueprint (16px grid rules, pivot points) |
| [HOW_OBJECTS_ARE_BUILT.md](HOW_OBJECTS_ARE_BUILT.md) | Tile/sprite structure by engine (MV, VX Ace, XP) |
| [CATALOG_OVERVIEW.md](CATALOG_OVERVIEW.md) | Asset pack contents (LimeZu Modern Office) |
| [CATALOG_CONVENTIONS.md](CATALOG_CONVENTIONS.md) | Catalog field reference — type vocabulary, anchors, interact_distance |
| [CHANGELOG.md](CHANGELOG.md) | Full development history — Phase 1-6 implementation details, bug fixes, architecture decisions |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute — setup, branch conventions, commit style |

## Deployment

Two deployment shortcuts live at the repo root:

- **Docker** — `docker compose up` uses [Dockerfile](Dockerfile) + [docker-compose.yml](docker-compose.yml) with a `node:20-alpine` image and API-key passthrough
- **PM2** — [ecosystem.config.js](ecosystem.config.js) for classic process management with restart-on-crash

## License

Code: **MIT with Commons Clause v1.0**. The MIT license applies as
usual — you can use, copy, modify, merge, publish, distribute,
sublicense — with one added restriction: you cannot **Sell** the
Software, where "Sell" includes selling hosted/managed versions of it
or services whose value derives substantially from this code. Internal
use, modification, redistribution, and integration into your own
non-commercial-of-Denizen products are all fine. Full terms in
[`LICENSE`](LICENSE).

Art assets: [LimeZu Modern Office](https://limezu.itch.io/) — see their license terms.
Character sprites: Generated with [Character Generator 2.0](https://www.graymatterstudios.net/).
