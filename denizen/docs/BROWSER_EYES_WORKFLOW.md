# Browser eyes — ChatGPT Plus as referee (no API keys)

Default path for web work when Lucy’s Playwright mirror is live. ChatGPT Custom GPT (Connect AI Actions) is the eyes; Denizen only opens the browser and applies clicks.

## Why this path

- **No `OPENAI_API_KEY`** — stays inside ChatGPT Plus + Connect AI Actions.
- **Anti-hallucination** — every action returns an AFTER screenshot; the model must describe it before claiming success.
- **Human can watch** — same feed in Denizen 🌐 (Watch / Drive / Point).
- **Local LM Studio vision** — optional backup only; never sole truth for web UI.

## Loop

1. **`browserBegin`** `{ url | query }` — open browser + first screenshot  
2. **Describe** only what the screenshot shows (never invent UI)  
3. **`browserStep`** `{ type, x, y | text | key }` — one action + AFTER screenshot  
4. **Describe** the AFTER frame; correct with another `browserStep` or stop with verified facts  

Prefer `browserBegin` / `browserStep` over bare `browserOpen` / `browserAct` / `browserScreenshot`.  
Do **not** use `runNpcSkill computer-use` for web when this loop works.

## Surfaces

| Client | Entry |
|--------|--------|
| ChatGPT Custom GPT | OpenAPI Actions → `browserBegin`, `browserStep` (re-import after updates) |
| Claude / Cursor MCP | tools `browser_begin`, `browser_step` |
| REST | `POST /api/npc-sync/browser-begin`, `POST /api/npc-sync/browser-step` |

Token needs **skills** scope (Standard or Full Connect AI).

## Frame images

`screenshot_url` / `screenshot_markdown` use a short-lived token (`/api/npc-sync/browser-frame?token=…`) so ChatGPT can fetch the JPEG without a Bearer header. Tokens expire ~90s — call begin/step/screenshot again for a fresh URL.

## Related

- Template: `data/templates/chatgpt-npc-assistant.yaml`
- Implementation: `src/browser-eyes.js`
- Gateway / OpenAPI: `src/denizen-npc-mcp-gateway.js`
