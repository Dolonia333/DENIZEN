# Contributing to AI Office Game

Thanks for your interest in contributing! Here's how to get involved.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ai-office-game-.git
   cd ai-office-game-
   npm install
   node server.js
   ```
3. Open `http://localhost:8080` to verify the game runs before making changes.

## Ways to Contribute

### Reporting Bugs
Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md) on GitHub Issues. Include your OS, Node version, browser, and any terminal/console output.

### Suggesting Features
Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md). The more detail the better.

### Editing NPC Personalities
Each NPC's personality lives in a plain markdown file — no coding required:

```
npcs/abby/SOUL.md      ← Edit to change Abby's personality
npcs/abby/MEMORY.md    ← NPC's persistent memory (auto-written at runtime)
```

Change the soul file, restart `node server.js`, and the NPC is different. No code changes needed.

### Code Contributions

**Before starting large work**, open an issue first so we can discuss the approach.

Preferred areas:
- New AI provider integrations (add to `src/npc-brains.js`)
- NPC behaviour improvements (`src/npc-agent-controller.js`)
- Pathfinding / movement fixes (`src/pathfinding.js`)
- Office layout / furniture additions (`data/furniture_catalog_openplan.json`)
- Security monitor enhancements (`security-monitor-server.js`)

## Development Workflow

1. Create a branch: `git checkout -b my-feature`
2. Make your changes
3. Test in **demo mode** (no API keys) — `node server.js` — game must work fully
4. Test with a live provider if your change touches AI code
5. Commit with a clear message: `git commit -m "feat: add Gemini provider for Pier"`
6. Push and open a Pull Request against `main`

## Commit Style

Use conventional commit prefixes where possible:

| Prefix | Use for |
|--------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `npc:` | Soul file / NPC personality change |
| `docs:` | Documentation only |
| `refactor:` | Code cleanup, no behaviour change |
| `chore:` | Tooling, dependencies |

## Code Style

- Plain JavaScript (ES6+), no transpiler required
- Keep server-side code in `server.js` / `src/`
- Keep client-side Phaser code in `office-scene.js` / `src/`
- NPC identity stays in `npcs/*/SOUL.md` — avoid hardcoding personalities in JS

## Asset Licensing

The LimeZu Modern Office art assets have their own license — do **not** add new art without confirming compatibility with [LimeZu's terms](https://limezu.itch.io/).

## Questions?

Open a GitHub Issue or start a Discussion. We're happy to help.
