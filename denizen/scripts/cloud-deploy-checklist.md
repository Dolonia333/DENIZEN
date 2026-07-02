# Cloud deploy checklist (denizen.dolonia.cloud)

Run on the production host after syncing code from this repo.

## 1. Environment

Ensure `.env` (or `.env.production`) includes:

```bash
DENIZEN_TEAM_OWNER_EMAIL=zionvanzandt@gmail.com
DENIZEN_PUBLIC_URL=https://denizen.dolonia.cloud
```

## 2. Database

From repo root:

```bash
py -3 infra/apply-migrations-psycopg.py
```

## 3. CRM build

```bash
cd denizen
npm run build:crm
```

## 4. Owner role heal (one-time)

```bash
cd denizen
node scripts/promote-team-owner.js
```

## 5. Restart server

Restart the Node process on port 8081 (systemd, pm2, or NAS task).

## 6. Verify

```bash
cd denizen
DENIZEN_URL=https://denizen.dolonia.cloud npm run smoke:phone
DENIZEN_URL=https://denizen.dolonia.cloud npm run smoke:crm
```

# 6. MCP UI inspect (Cursor): reload MCP after deploy; credentials from denizen/.env via mcp-ui-inspect/start.cjs

Log out and log in once in the browser after deploy (unified Login path).
