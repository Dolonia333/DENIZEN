# Denizen Companion (v1.6)

Provider-agnostic browser extension that syncs **any** app or AI workflow with your claimed Denizen NPC — no MCP config, no API keys, no subscription ToS issues.

## Architecture

```
[Any app / ChatGPT / Claude / notes]
        │ selection / clipboard / hotkey
        ▼
[Denizen Companion extension]
        │ Bearer token (from Connect AI)
        ▼
POST /api/npc-sync/memory | activity
GET  /api/npc-sync/status
        ▼
[Denizen office NPC brain + DB memories]
```

The extension uses the same REST shim as ChatGPT Custom GPT Actions (v1.4).

## Install

1. Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked**
2. Select folder: `denizen/companion-extension`
3. Open Denizen → claim NPC (team session) → **Connect AI**
4. Credentials sync automatically to the extension

## Features

| Action | How |
|--------|-----|
| Auto-connect | Connect AI in office saves token via `visitor-companion-bridge.js` |
| Send selection | Right-click highlighted text → **Send to Denizen NPC** |
| Send clipboard | `Ctrl+Shift+D` (Mac: `Cmd+Shift+D`) |
| Popup | Refresh status, quick memory, log activity |
| Manual fallback | Paste token in popup if auto-sync missed |

## Code map

| Path | Role |
|------|------|
| `companion-extension/` | Chrome MV3 extension |
| `src/denizen-companion-api.js` | REST client (tested in Node) |
| `src/visitor-companion-bridge.js` | Office → extension credential bridge |
| `src/visitor-mcp-connect-ui.js` | Connect AI (Companion tab first) |

## Security

- Token stored in `chrome.storage.local` on the user's machine only
- Same bearer token scope as MCP gateway (one NPC per token)
- Rate limits apply server-side (`DENIZEN_MCP_RATE_LIMIT`)

## Local ports

The extension auto-connects on `localhost:8080`, `127.0.0.1:8080`, **`8081`** (Dolonia lab `PORT=8081`), and `https://denizen.dolonia.cloud`.

## Tags

| Release | Tag |
|---------|-----|
| v1.5 | `v1.5-companion-extension` — initial Chrome extension |
| v1.6 | `v1.6.0` — compute mesh milestone; extension adds port 8081 |
