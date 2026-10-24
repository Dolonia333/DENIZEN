# Denizen CRM — Architecture & Production Roadmap

**End-user guide (every tab and button):** [USER_GUIDE.md](./USER_GUIDE.md)

**Competitive analysis (vs Salesforce / HubSpot):** [COMPETITIVE_ANALYSIS.md](./COMPETITIVE_ANALYSIS.md)

This document describes how the CRM works today, which features are real vs. UI-only, and what it takes to make each area production-grade.

## System overview

```
┌─────────────────────────────────────────────────────────────────┐
│  CRM SPA (crm/vendor → /crm/)                                   │
│  React + localStorage (meridian_*) + debounced cloud sync       │
└───────────────┬───────────────────────────────┬─────────────────┘
                │ PUT/GET workspace              │ POST actions
                ▼                                ▼
┌───────────────────────────┐    ┌────────────────────────────────┐
│  denizen_crm_workspaces   │    │  denizen-crm-routes.js         │
│  (Supabase, per org)      │    │  send-email, assist, sequences │
└───────────────┬───────────┘    │  intake-handoff, events        │
                │                └────────────────────────────────┘
                ▼
┌───────────────────────────┐
│  denizen-crm-spine.js     │  mirrors contacts → leads/clients
│                           │  deals → crm_deal registry
└───────────────────────────┘
```

**Truth model:** The workspace JSON blob is the source of truth for CRM entities. Server routes handle side effects (email, AI, scheduler, office events) but most CRUD is client → `PUT /api/crm/workspace`.

---

## Data Tools (implemented)

| Capability | Status |
|------------|--------|
| CSV import (contacts, deals, tasks, companies, notes) | Real |
| Import modes (append, skip dupes, update by email, replace) | Real |
| Column mapping UI + custom fields in CSV | Real |
| Export CSV per entity + full JSON backup | Real |
| JSON restore (merge / replace workspace) | Real |
| Duplicate detection + merge | Real |
| Bulk contact status/tag/delete | Real |
| Data health panel | Real |
| Audit log viewer + export | Real |
| Per-contact GDPR JSON export | Real |
| Clear entity (contacts, deals, tasks, …) | Real |

---

## Feature audit: real vs UI-only

### Tier 1 — Core CRM (mostly real)

| Area | Status | Notes |
|------|--------|-------|
| Contacts, deals, tasks, notes, companies | **Real** | CRUD + cloud sync + spine mirror |
| Pipeline kanban | **Real** | Stage changes, deal comments, email engagement in drawer |
| Packages + quotes + PDF | **Real** | Client PDF; email via Resend |
| Email templates + compose | **Real** | Resend or mailto fallback |
| Sequences | **Real** | Server scheduler ticks steps |
| Intake workflow | **Real** | Manual/import + `POST /api/crm/intake` (org slug); embed docs in Intake tab |
| AI tab | **Real** | `/api/crm/assist`; threads persisted in `aiThreads` |
| Analytics | **Real** | Live metrics + `metricSnapshots` daily trends (scheduler 1:00) |
| Data Tools | **Real** | See above |

### Tier 2 — UI shell or partial (needs backend work)

| Area | Status | What it takes to make real |
|------|--------|---------------------------|
| **Client portal** (`#/portal/:token`) | **Real** | Sign + Stripe Checkout (`/checkout`, `/stripe-webhook`). |
| **Public intake form** | **Real** | `POST /api/crm/intake`; hosted HTML page optional. |
| **Email open/click tracking** | **Partial** | `POST /api/crm/resend-webhook` implemented; configure Resend dashboard in prod. |
| **Automations** | **Real** | Server triggers: `deal_created`, `deal_lost`, `deal_won`, `deal_moved`, `deal_stale`, `task_overdue`, `contact_added`, `form_submitted`, `quote_sent`. Actions: `create_task`, `notify`, `update_field`, `draft_email`, `webhook` (n8n). Runs logged in `automationRuns`. |
| **Settings notifications** | **Real** | Persisted in workspace `userPrefs.notifications` (cloud sync). Weekly digest runs Monday 9:00 server local time via `denizen-crm-digest`. |
| **Settings profile email/TZ** | **Real** | Workspace `userPrefs.profile` (cloud sync). |
| **Dashboard trends** | **Real** | Computed from deal close dates + live workspace metrics. |
| **Dashboard follow-up actions** | **Real** | Compose, note, snooze wired to handlers. |
| **Sales Lead Generator** | **Real** | Rule-based `calcLeadScore` from contacts/deals/emails/notes. |
| **Deal drawer timeline** | **Real** | Built from `notes` + `auditLog` + `emailLog`. |
| **Notes tab fake chat** | **Real** | Demo auto-replies removed; team roster from `/api/crm/team`; activity from board edits. |
| **Notes demo boards** | **Real** | Empty state when `noteBoards` is `[]`; no silent demo seed. |
| **Onboarding invites** | **Real** | `POST /api/crm/team/invite` sends email via Resend; roster from `/api/crm/team`. |
| **Sales Hub dashboard** | **Real** | Leads/deals from workspace; pipeline pie chart auto-derived from live deals. |
| **Calendar sync** | **Real** | Google/Microsoft OAuth; tokens in `calendarConnections`; sync imports meetings. |
| **Activity feed FAB** | **Real** | Seeds from workspace `auditLog`; live updates from deal/contact/note/task changes. |
| **Outbound webhooks** | **Real** | `workspace.integrations.outboundWebhooks` — Settings UI; fires on `contact_added` / `deal_won`. |
| **Task assignees** | **Real** | Assignee picker from `/api/crm/team` roster. |

### Tier 3 — External integrations (not started)

| Integration | Approach |
|-------------|----------|
| HubSpot / Salesforce import | Use Data Tools CSV today; native sync needs OAuth + field mapping service |
| Google Contacts | People API sync job |
| n8n (self-hosted) | **Outbound** webhooks on `deal_won`, `contact_added` → n8n Webhook trigger URLs (Settings → Integrations). **Inbound** via `POST /api/crm/intake` or an n8n HTTP Request node. |

---

## Recommended build phases

### Phase A — Data integrity (done in this pass)

- Full Data Tools: import/export/restore/merge/health/audit
- Custom field CSV round-trip
- Multi-entity CSV

### Phase B — Portal & intake (done)

1. `GET /api/crm/quote/:token` — public read-only quote ✓
2. `PortalPage` loads from API ✓
3. Signatures in workspace `quotes[].portalSignatures` (synced) ✓
4. `POST /api/crm/intake` — public form submission ✓
5. Stripe Checkout + webhook ✓

**Schema addition:**

```sql
-- optional: separate table for portal tokens if quotes get large
create table denizen_crm_portal_tokens (
  token text primary key,
  org_id uuid references organizations(id),
  quote_id bigint not null,
  expires_at timestamptz
);
```

### Phase C — Automations & email analytics (mostly done)

1. Resend webhook endpoint ✓
2. Automation condition evaluator ✓
3. Server-side `notify` / `update_field` ✓
4. Configure Resend webhook URL + `RESEND_WEBHOOK_SECRET` in production — **ops step**

### Phase D — Dashboard & settings persistence (done)

1. Dashboard actions wired ✓
2. Computed metrics ✓
3. Workspace `userPrefs` + `onboarding` + `availability` ✓

### Phase E — Calendar & team (done)

1. Org member API for assignees ✓ (`GET /api/crm/team`)
2. Google + Microsoft Calendar OAuth ✓
3. Onboarding checklist + email invites ✓ (`POST /api/crm/team/invite`)
4. Weekly digest cron ✓ (`denizen-crm-digest`)
5. Outbound n8n webhooks ✓ (Settings → Integrations)
6. `GET /api/crm/health` — route diagnostic for deploys ✓

---

## API surface (today)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/crm/health` | Route list (deploy diagnostic) |
| GET/PUT | `/api/crm/workspace` | Full state sync |
| GET | `/api/crm/workspace/stream` | SSE teammate updates |
| POST | `/api/crm/send-email` | Resend + attachments |
| POST | `/api/crm/assist` | AI copilot |
| POST | `/api/crm/sequence/enroll` | Enroll contact |
| POST | `/api/crm/intake-handoff` | Qualified intake → CRM |
| POST | `/api/crm/intake-ingest` | Server-token (`INTAKE_INGEST_TOKEN`) intake → company/contact/deal/task/note; idempotent; new clients only; no outbound messages |
| POST | `/api/crm/event` | Office events (deal-won, etc.) |

## API surface (added)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/crm/quote/:token` | Public portal quote |
| POST | `/api/crm/quote/:token/sign` | E-signature |
| POST | `/api/crm/quote/:token/event` | Portal analytics |
| POST | `/api/crm/intake` | Public form submit |
| POST | `/api/crm/resend-webhook` | Email tracking |
| POST | `/api/crm/quote/:token/checkout` | Stripe Checkout session |
| POST | `/api/crm/stripe-webhook` | Mark quote paid |
| GET | `/api/crm/calendar/status` | Calendar connection status |
| GET | `/api/crm/calendar/google/connect` | Start Google OAuth |
| GET | `/api/crm/calendar/microsoft/connect` | Start Microsoft OAuth |
| POST | `/api/crm/calendar/sync` | Import external events |
| GET | `/api/crm/team` | Org members for assignees |
| GET | `/crm/intake.html?org=slug` | Hosted public intake form |

---

## Testing strategy

| Layer | Tool |
|-------|------|
| CSV / data management | Vitest (`crm-csv.test.ts`, `crm-data-management.test.ts`) |
| Email / sequences | Node test (`denizen-crm-email.test.js`) |
| Workspace sync | Integration test against Supabase dev |
| Portal / intake | Node (`denizen-crm-portal.test.js`) + Playwright e2e (optional) |

---

## Key files

| Path | Role |
|------|------|
| `crm/vendor/src/components/crm/CRMApp.tsx` | Root state + tab routing |
| `crm/vendor/src/lib/crm-data-management.ts` | Import/merge/health/restore |
| `crm/vendor/src/lib/crm-csv.ts` | RFC4180 CSV parsers |
| `crm/vendor/src/hooks/use-crm-cloud-sync.ts` | Cloud sync |
| `denizen/src/denizen-crm-routes.js` | HTTP API |
| `denizen/src/denizen-crm-store.js` | Supabase workspace persistence |
| `denizen/src/denizen-crm-spine.js` | Leads/clients/deals mirror |
