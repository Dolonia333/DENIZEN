# Denizen MCP UI Inspect



Stdio MCP server for Cursor and other agents to **see, click, and capture** Denizen UI and the real desktop.



## Install



```bash

cd apps/office/mcp-ui-inspect

npm install

cd ..

npx playwright install chromium

```



## Cursor (wired)



`.cursor/mcp.json` includes `denizen-ui-inspect` via `start.cjs`, which loads `denizen/.env` for `DENIZEN_URL`, `DENIZEN_TEAM_CODE`, and probe credentials.



Add to `denizen/.env` (gitignored):



```env

PROBE_OWNER_USER=Dolonia

PROBE_OWNER_PASS=your-password

DENIZEN_PUBLIC_URL=https://denizen.dolonia.cloud

```



Reload Cursor MCP after changes.



## Tools



| Tool | What it does |

|------|----------------|

| `capture_denizen_phone_app` | Login → open phone → screenshot Citizen ID, chat, mesh, etc. (desktop or iPhone viewport) |

| `capture_crm_tab` | Login → CRM sidebar tab → screenshot + blank check |

| `click_denizen_ui` | Login → optional phone app → click CSS selector → screenshot |

| `capture_desktop_screen` | Real Windows/macOS screenshot (nut-js) |

| `desktop_click` | Click / type / key on real desktop → follow-up screenshot |



All capture tools return **JSON metrics + inline PNG** in the MCP response.



### Phone app ids



`home`, `profile`, `chat`, `settings`, `compute`, `mesh`, `health`, `lm`, `approvals`, `browser`, `security`, `voice`, `presence`, `listen`



### CRM tab ids



`dashboard`, `contacts`, `sales`, `schedule`, `notes`, `packages`, `intake`, `email-templates`, `automations`, `analytics`, `ai`, `portal`, `data-tools`, `onboarding`, `settings`



## CLI (same scripts the MCP calls)



```bash

cd apps/office

$env:PROBE_OWNER_PASS="your-password"



node scripts/denizen-ui-inspect.mjs https://denizen.dolonia.cloud profile desktop

node scripts/capture-crm-tab.mjs https://denizen.dolonia.cloud dashboard

node scripts/denizen-ui-click.mjs https://denizen.dolonia.cloud "#denizen-phone-fab" home

node scripts/capture-desktop-screen.cjs

node scripts/desktop-click.cjs click '{"x":500,"y":400}'

```



Screenshots land in `reports/phone-ui/inspect/`, `reports/crm-ui/inspect/`, and `reports/desktop/`.



## Manual MCP config



```json

{

  "mcpServers": {

    "denizen-ui-inspect": {

      "command": "node",

      "args": ["C:/path/to/multbot/denizen/mcp-ui-inspect/start.cjs"]

    }

  }

}

```



Credentials come from `denizen/.env` — do not put passwords in `mcp.json`.

