# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Fixed
- **#2** NPC `MEMORY.md` files now capped at 200 lines — prevents unbounded disk growth and oversized AI prompts (`src/npc-brains.js`)
- **#3** NPC stand-up Y offset now uses chair facing direction (`backFacing ? -16 : +16`) instead of always `+16` — fixes clipping into back-facing chairs (`src/agent-actions.js`)
- **#4** `_stuckCount` initialized to `0` in `NpcPathFollower` constructor — removes reliance on runtime `|| 0` patch (`src/pathfinding.js`)
- **#4** `_standingMeetingNpcs` initialized in `AgentActions` constructor — eliminates lazy-init guard (`src/agent-actions.js`)
- **#5** `DELEGATE` response parser now logs a warning when an unknown NPC target is encountered, instead of silently discarding it (`src/npc-brains.js`)
- **#11** Demo mode threshold now excludes LM Studio from the remote provider count — demo mode activates correctly when only local providers are configured (`src/npc-brains.js`)

### Added
- `LICENSE` — official MIT license file (GitHub now detects it automatically)
- `CONTRIBUTING.md` — fork, run, edit NPC souls, commit style, asset license rules
- `.github/ISSUE_TEMPLATE/bug_report.md` — structured bug report form
- `.github/ISSUE_TEMPLATE/feature_request.md` — structured feature request form
- `.github/PULL_REQUEST_TEMPLATE.md` — PR checklist including demo mode and console checks
- `SECURITY.md` — vulnerability disclosure policy

### Fixed (documentation)
- README troubleshooting section referenced wrong directory name (`pixel-office-game` → `ai-office-game-`)

## [0.3.0] — 2026-03-22

### Added
- Zero-config demo mode — game works without any API keys
- Player chat system — press Enter to talk to NPCs, they walk over and respond
- Smart NPC fallbacks — context-aware scripted responses infer meaning from player messages
- A* pathfinding with stuck detection and automatic rerouting
- Security monitor server — real-time threat detection (file access, network scans, shell exec, API abuse)
- 16 NPC soul files (`npcs/*/SOUL.md`) — personality-driven system prompts
- NPC persistent memory (`npcs/*/MEMORY.md`) — conversations saved across sessions
- Meeting system — CTO can call meetings, NPCs walk to conference room, sit and discuss

## [0.2.0] — 2026-03-15

### Added
- Soul file architecture (OpenClaw pattern) — NPC identity from plain markdown files
- 16-NPC hierarchy — org chart with reporting structure and role-specific actions
- Multi-provider NPC brains — Claude, Grok, Gemini, Kimi, LM Studio per NPC
- Cofounder agent (CTO brain) — autonomous thinking loop every 15–30s

## [0.1.0] — 2026-03-19 (Initial commit)

### Added
- Pixel art office scene built with Phaser 3 and LimeZu Modern Office asset pack
- Basic NPC sprites and player character (`Dolo.png`)
- Furniture catalog system (`data/furniture_catalog_openplan.json`)
- Room assembly system (`src/RoomAssembly.js`, `src/RoomBuilder.js`)
- Node.js HTTP/WebSocket server (`server.js`)
- Development tools: asset browser, sprite cutter, tile labeler
