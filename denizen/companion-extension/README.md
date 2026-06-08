# Denizen Companion — Chrome Extension

Sync clipboard, text selections, and quick notes to your Denizen NPC without configuring MCP or API keys in ChatGPT, Claude, or Cursor.

## Install (developer / team)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`denizen/companion-extension`)

## Connect

1. Run Denizen (`npm start` in `denizen/`)
2. Enter with a **team** session and **claim an NPC**
3. Click **Connect AI** — the **Companion** tab syncs your token automatically
4. Open the extension popup — you should see your NPC name

## Usage

- **Right-click** any selected text → **Send selection to Denizen NPC**
- **Ctrl+Shift+D** — push clipboard contents as a memory
- **Popup** — refresh NPC status, type a memory, log activity

## Manual setup

If auto-sync fails, open the popup setup form and paste:

- Denizen URL (e.g. `http://localhost:8080` or `http://localhost:8081` on Dolonia lab)
- NPC key (e.g. `roki`)
- Bearer token from Connect AI modal

## Permissions

- `storage` — save connection locally
- `contextMenus` — right-click send selection
- `clipboardRead` — Ctrl+Shift+D clipboard push
- Host access to Denizen origins only (localhost + production)
