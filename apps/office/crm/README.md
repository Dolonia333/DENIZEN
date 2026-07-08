# Deal Weaver CRM (Denizen phone app)

Copy of [remix-of-deal-weaver](https://github.com/kaiser-create/remix-of-deal-weaver), served as a **full page** at `/crm/`. Open it from **Denizen → Phone → CRM** (navigates here; not an in-phone iframe).

**User guide (every tab, button, and feature):** [USER_GUIDE.md](./USER_GUIDE.md)

**Market comparison (Salesforce, HubSpot, roadmap):** [COMPETITIVE_ANALYSIS.md](./COMPETITIVE_ANALYSIS.md)

## Build

```bash
npm run build:crm
```

Output: `crm/dist/` (gitignored). Denizen serves it when you open the CRM phone app.

## Dev (CRM only, port 8090)

```bash
npm run dev:crm
```

For full in-phone testing, build and run Denizen (`npm start`), then open **http://localhost:8080/crm/** (same host as the API).

`npm run dev:crm` (port 8090) proxies `/api` to Denizen — set `VITE_DENIZEN_API=http://127.0.0.1:8081` if your server uses another port.

### NAS / production deploy

1. Copy the full CRM backend to the server: all `apps/office/src/denizen-crm-*.js` files and the updated `apps/office/server.js`.
2. Run `npm run build:crm` on the server (or build locally and copy `apps/office/crm/dist/`).
3. Apply migrations: `py -3 infra/apply-migrations-psycopg.py` (from repo root).
4. **Restart Denizen** (`npm start`) — a stale process causes `CRM route not found` on the AI tab.
5. Verify: `GET https://YOUR_HOST/api/crm/health` should list `POST /api/crm/assist`.
6. Smoke test: `npm run smoke:crm` (Playwright + CEO login).

## Team sync (Supabase)

When signed into Denizen, CRM data syncs to `denizen_crm_workspaces` (one row per org). Teammates in the same org share contacts, deals, tasks, companies, goals, sequences, note boards, etc.

- API: `GET/PUT /api/crm/workspace`, `POST /api/crm/assist`, `POST /api/crm/event`, `POST /api/crm/send-email`, `POST /api/crm/sequence/enroll` (session auth via cookies / `X-Session-Id` + `X-Session-Token`)
- **Public intake**: hosted form at `/crm/intake.html?org=YOUR_ORG_SLUG` or `POST /api/crm/intake`
- **Client portal**: `#/portal/:token` with sign + optional Stripe pay (`POST /api/crm/quote/:token/checkout`)
- **Calendar sync**: Google / Microsoft OAuth (`/api/crm/calendar/*/connect`) imports events into meetings
- **Email send**: compose from templates/contacts; delivers via **Resend** when `RESEND_API_KEY` is set, else `mailto:` fallback + `emailLog` entry; package sends attach a generated proposal PDF when Resend is configured
- **Data Tools**: CSV import/export (contacts, deals, tasks, companies, notes), merge modes, column mapping, duplicate merge, bulk ops, health checks, JSON backup/restore, audit log, GDPR export
- **Proposal PDF**: client-side generation via jsPDF + html2canvas (download from quotes/packages; no print dialog)
- **Architecture**: see [ARCHITECTURE.md](./ARCHITECTURE.md) for real vs UI-only features and production roadmap
- **Sequences**: enroll contacts; server scheduler runs email/task steps every ~5 min
- New teams start **empty**; load sample data from Settings or Data Tools (avoids accidental demo upload)
- Live updates via SSE (`/api/crm/workspace/stream`) + 30s polling; shows last editor name
- Companies, Sequences, Goals on dashboard; expanded AI context + action buttons
- Intake qualified → auto contact + deal; server automations on save; 8am pipeline brief to office
- Contacts mirror to `leads` / `clients` (including no-email via registry); deals → `crm_deal` registry; spine leads pull on load
- Deal won → office WebSocket `crm_event` → work feed + chat
- NPCs: `crm-summary`, `crm-list-pipeline`, `crm-add-contact`, `crm-update-deal`

Apply migrations if missing (from repo root):

```bash
py -3 infra/apply-migrations-psycopg.py
```

Key CRM migrations: `20260611000003_denizen_crm_workspace.sql`, `20260612000001_denizen_crm_portal_tokens.sql`.

### Production webhooks (operator setup)

| Service | Dashboard URL | Env var |
|---------|---------------|---------|
| Resend email tracking | `https://YOUR_HOST/api/crm/resend-webhook` | `RESEND_WEBHOOK_SECRET` |
| Stripe portal payments | `https://YOUR_HOST/api/crm/stripe-webhook` | `STRIPE_WEBHOOK_SECRET` |

### n8n on your NAS (outbound CRM events)

Denizen does not need Zapier. Point CRM **Settings → Integrations** at n8n **Webhook** trigger URLs.

1. In n8n, create a workflow with **Webhook** (method: POST). Use a path like `deal-won` or `contact-added`.
2. Copy the URL n8n shows (often `http://NAS_IP:5678/webhook/deal-won` on a local install).
3. Paste into CRM Settings → Integrations for each event.
4. Ensure the machine running Denizen can reach that URL (same LAN is enough for `http://192.168.x.x:5678/...`).

Payload shape:

```json
{ "event": "deal_won", "org_id": "…", "at": "2026-06-11T…", "deal": { … } }
```

```json
{ "event": "contact_added", "org_id": "…", "at": "2026-06-11T…", "contact": { … } }
```

For **inbound** (n8n → CRM), use an n8n **HTTP Request** node: `POST https://YOUR_HOST/api/crm/intake` with your org slug in the body.

## Source

Vendor tree: `crm/vendor/` (cloned from GitHub). Vite `base` is `/crm/` so asset paths work inside Denizen.
