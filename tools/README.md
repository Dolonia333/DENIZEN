# Maintenance & one-off tools

Scripts moved from the repo root during the monorepo reorganization. They are **not** part of the Denizen runtime.

| Script | Purpose |
|--------|---------|
| `translate_*.py` | Batch i18n for Star-Office-UI (Chinese → English) |
| `fix_apostrophes.py` | Apostrophe cleanup in translated strings |
| `check_remaining.py` | Audit remaining untranslated strings |
| `grok-denizen-mcp-wire.py` | Grok ↔ Denizen MCP wiring helper |
| `audit-session.js` | Session audit utility |
| `test-brave-setup.js` | Brave Search API setup smoke test |
| `debug-brave-search.md` | Notes for Brave search debugging |

Run from repo root with Python 3 or Node as appropriate. Paths inside the translate scripts may need a `BASE` update if your checkout layout differs.
