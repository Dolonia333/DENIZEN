# Multbot Monorepo Map

This repository (`multbot`) is a **monorepo** that hosts Denizen (the main product) plus home-lab infrastructure, companion apps, and embedded gateways. The GitHub project is branded **DENIZEN**, but the local checkout root is `multbot/`.

## Top-level layout

```
multbot/
├── denizen/          # Main app — pixel-art AI agent office (Node + Phaser)
├── infra/            # Home lab ops — NAS, Kali, Tailscale, Supabase
├── VisionClaw/       # Android companion app (camera/audio relay)
├── openclaw/         # Embedded OpenClaw gateway (gitignored)
├── MONOREPO.md       # This file — repo-wide map
├── .github/workflows/# CI — desktop-release.yml
├── watchdog.ps1      # Service watchdog (gateway, bridge, Denizen, cloudflared)
├── check-status.ps1  # Quick process + port status
├── RUN_OPENCLAW_AND_STAR_OFFICE.ps1
├── OPENCLAW_STAR_OFFICE_QUICKSTART.md
└── translate_*.py    # i18n batch scripts for Star-Office-UI
```

## `denizen/` — main app

**Denizen** is a real-time visual observability layer for AI agents. Sixteen NPCs are LLM-backed agents with personalities (`SOUL.md`), memory (`MEMORY.md`), and real tool execution. The browser renders a Phaser pixel-art office; `server.js` is the Node HTTP/WebSocket/API monolith.

| Start here | Path |
|------------|------|
| Quick start | [denizen/README.md](denizen/README.md) |
| Doc index | [denizen/docs/DOCS_INDEX.md](denizen/docs/DOCS_INDEX.md) |
| Architecture | [denizen/docs/ARCHITECTURE.md](denizen/docs/ARCHITECTURE.md) |
| Module map | [denizen/docs/WORKSPACE_ARCHITECTURE.md](denizen/docs/WORKSPACE_ARCHITECTURE.md) |
| Server routes | [denizen/docs/SERVER.md](denizen/docs/SERVER.md) |

```bash
cd denizen
npm install
npm start
# → http://localhost:8080 (8081 in Dolonia lab when PORT=8081 in .env)
```

### Jelly (`denizen/jelly/`)

**Jelly** is Denizen's skill executor — the runtime that dispatches NPC tool calls (GitHub, market watch, browser automation, Supabase data actions, etc.). Skill dispatch goes through Jelly, not the OpenClaw gateway. See [denizen/docs/JELLY_INTEGRATION.md](denizen/docs/JELLY_INTEGRATION.md).

## `infra/` — home lab

Operations tooling for the Dolonia home fleet: Synology NAS (self-hosted Supabase + fleet agent), Kali Linux compute worker, Tailscale mesh, and database migrations.

| Topic | Doc |
|-------|-----|
| Full infra guide | [infra/README.md](infra/README.md) |
| Compute mesh | [denizen/docs/COMPUTE_MESH.md](denizen/docs/COMPUTE_MESH.md) |

One-command mesh deploy from repo root:

```powershell
py infra/finish-all-mesh.py
```

## `VisionClaw/` — Android app

Kotlin/Android companion that streams camera frames and audio to a Denizen relay over WebSocket. Useful for mobile presence and remote observation. Not required to run Denizen locally.

## `openclaw/` — embedded gateway (gitignored)

The OpenClaw assistant gateway lives here as a **gitignored embedded checkout**. Clone or vendor it locally; it is not committed. Denizen integrates with OpenClaw via bridge scripts and the in-browser chat panel. See [denizen/docs/OPENCLAW_INTEGRATION.md](denizen/docs/OPENCLAW_INTEGRATION.md).

Root scripts that touch OpenClaw:

| Script | Purpose |
|--------|---------|
| `watchdog.ps1` | Restarts gateway (18789), bridge (18790), Denizen (8081), cloudflared |
| `check-status.ps1` | Lists node/python/cloudflared processes and listening ports |
| `RUN_OPENCLAW_AND_STAR_OFFICE.ps1` | Launches OpenClaw + Star-Office-UI together |
| `OPENCLAW_STAR_OFFICE_QUICKSTART.md` | URLs and first-run steps |

## Root `translate_*.py` — i18n batch scripts

One-shot Python scripts at the repo root that translate Chinese strings in **Star-Office-UI** frontend files to English. They are **not** part of Denizen's runtime i18n.

| Script | Scope |
|--------|-------|
| `translate_all.py` | Broad Star-Office-UI frontend sweep |
| `translate_frontend.py` | Remaining frontend strings |
| `translate_game.py` | Game-related UI strings |
| `translate_index.py` | Index/entry HTML |
| `translate_cleanup.py` | Cleanup pass for leftover Chinese |
| `translate_final*.py` | Incremental final passes (numbered variants) |

Run from repo root with Python 3. Paths inside the scripts are machine-specific; adjust `BASE` if your checkout differs.

## `.github/workflows` — CI

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `desktop-release.yml` | Tag `desktop-v*` or manual dispatch | Build Denizen Desktop for Windows/macOS/Linux, publish release artifacts |

See [denizen/desktop/README.md](denizen/desktop/README.md) for local Desktop setup.

## Where to start reading docs

| Audience | Path |
|----------|------|
| **Anyone** | This file → [denizen/docs/DOCS_INDEX.md](denizen/docs/DOCS_INDEX.md) |
| **New contributor** | [denizen/docs/SETUP.md](denizen/docs/SETUP.md) → [VISITOR_ONBOARDING.md](denizen/docs/VISITOR_ONBOARDING.md) → [ARCHITECTURE.md](denizen/docs/ARCHITECTURE.md) |
| **Operator / deploy** | [COMPUTE_MESH.md](denizen/docs/COMPUTE_MESH.md) → [infra/README.md](infra/README.md) → [PRODUCTION_DEPLOY.md](denizen/docs/PRODUCTION_DEPLOY.md) → [TESTING.md](denizen/docs/TESTING.md) |
| **Developer** | [WORKSPACE_ARCHITECTURE.md](denizen/docs/WORKSPACE_ARCHITECTURE.md) → [SERVER.md](denizen/docs/SERVER.md) → [ARCHITECTURE.md](denizen/docs/ARCHITECTURE.md) → [SCRIPTS.md](denizen/docs/SCRIPTS.md) |
