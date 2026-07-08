# Meridian CRM — Complete User Guide

Meridian (Deal Weaver) is a **Sales Manager CRM** embedded in **Denizen**. Open it from **Denizen → Phone → CRM** or at `/crm/` on your Denizen server.

This guide explains **how the CRM works**, **every main area**, and **what buttons do**.

For technical setup, see [README.md](./README.md) and [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Table of contents

1. [How the CRM works](#1-how-the-crm-works)
2. [Global UI (every screen)](#2-global-ui-every-screen)
3. [Dashboard](#3-dashboard)
4. [Contacts](#4-contacts)
5. [Sales](#5-sales)
6. [Schedule](#6-schedule)
7. [Companies](#7-companies)
8. [Notes](#8-notes)
9. [Sequences](#9-sequences)
10. [Packages](#10-packages)
11. [Proposals & Intake](#11-proposals--intake)
12. [Email Templates](#12-email-templates)
13. [Automations](#13-automations)
14. [Analytics](#14-analytics)
15. [AI Prospector](#15-ai-prospector)
16. [AI Assistant](#16-ai-assistant)
17. [Portal](#17-portal)
18. [Data Management](#18-data-management)
19. [Setup (Onboarding)](#19-setup-onboarding)
20. [Settings](#20-settings)
21. [Industry terminology](#21-industry-terminology)
22. [Keyboard shortcuts](#22-keyboard-shortcuts)
23. [Public & client-facing surfaces](#23-public--client-facing-surfaces)
24. [Sync status meanings](#24-sync-status-meanings)

---

## 1. How the CRM works

### What it is

- A **team workspace** for sales managers: contacts, pipeline, tasks, proposals, email, analytics.
- **One org = one shared workspace** when signed into Denizen with Supabase configured.
- **Industry templates** change labels (e.g. Contacts → Patients, Deals → Projects) and pipeline stages — not a different app per industry yet.

### Data flow

```
Browser (CRM UI)
  ↔ localStorage (meridian_* keys) — instant saves
  ↔ Denizen API (GET/PUT /api/crm/workspace) — team sync
  ↔ Supabase (denizen_crm_workspaces) — cloud truth per org
```

- **Signed in + Supabase:** changes debounce and sync to the team; you see who last edited.
- **Not signed in / no org:** data stays in **this browser only** (local mode).
- **New workspaces start empty.** Load sample data from **Data Management** or **Settings** if you want a demo.

### Product category

This build is **Sales Manager CRM** — pipeline, quotas, Sales Hub, lead scoring, team oversight. Other role/industry dashboards are planned separately.

---

## 2. Global UI (every screen)

### Top bar

| Control | What it does |
|---------|----------------|
| **Edition title** | Shows industry edition (e.g. Sales Cloud, Media Cloud). |
| **Sync label** | Team name, save status, last editor (when cloud sync is on). |
| **Notification bell** | Opens notifications panel (deal/task alerts). |
| **Back to Denizen** (phone) | Returns to Denizen phone OS (`/?phone=1`). |

### Left sidebar (desktop)

Collapsible groups:

| Group | Items |
|-------|--------|
| **MAIN** | Dashboard, Contacts, Sales, Schedule |
| **WORKSPACE** | Companies, Notes, Sequences, Packages, Proposals & Intake, Email Templates, Automations |
| **INTELLIGENCE** | Analytics, AI Prospector, AI, Portal |
| **SYSTEM** | Data Management, Setup, Settings |

- **Badge numbers** on Contacts / Sales / Schedule = record counts or open items.
- **Industry labels** apply (e.g. Contacts may show as Patients).

### Mobile bottom bar

Fixed tabs: **Dashboard · Contacts · Sales · Schedule**. Swipe left/right to change tab.

### Floating action button (FAB) + dock

Bottom-right **+** launcher opens quick-create:

| Action | Opens |
|--------|--------|
| **Create Contact** | New contact modal |
| **New Deal** | New deal modal |
| **Log Interaction** | New note modal |
| **New Task** | New task modal |

**Dock buttons** (draggable, reorderable):

| Button | What it does |
|--------|----------------|
| **+** (launcher) | Same as FAB menu above |
| **Activity** | Activity feed — recent CRM actions from audit log |
| **Chat** | Toggles **Global Team Chat** (in-app scratch pad; not Denizen office chat) |

Dock is hidden on some full-screen tabs (e.g. Portal).

### Command palette

**Ctrl+K** (or **Cmd+K** on Mac):

- Jump to any sidebar page
- Search contacts, deals, tasks, companies, notes
- Open a contact in the drawer

### Global Team Chat

Floating chat widget (all routes). Share cards from Contacts, Pipeline, Tasks, Charts. **Not synced** to Denizen office — local CRM scratch pad.

### Contact drawer

Click a contact anywhere → side drawer with profile, deals, timeline, **Share to chat**, compose email.

### Toasts

Short confirmations (saved, synced, email sent, errors) bottom-right.

### Modals (from FAB or inline buttons)

| Modal | Purpose |
|-------|---------|
| Add/Edit Contact | Name, email, company, status, groups, custom fields |
| Add/Edit Deal | Title, contact, value, stage, probability, owner |
| Add Note | Contact, type, text |
| Add Task | Title, due date, assignee, contact |
| Email compose | Template, subject, body; sends via Resend or mailto |

**Escape** closes modals, mobile sidebar, or FAB menu.

---

## 3. Dashboard

**Purpose:** Sales manager home — pipeline health, follow-ups, tasks, goals.

### Status bar (top right)

| Chip | Click → |
|------|---------|
| **Meetings** (today) | Schedule |
| **Overdue** tasks | Tasks view |
| **At Risk** deals | Sales / pipeline |

### KPI cards

| Card | Meaning |
|------|---------|
| Pipeline value | Sum of open deals |
| Weighted pipeline | Probability-adjusted forecast |
| Closed won | Won revenue + count |
| Contacts | Total + customer count |

### Quick action pills

| Button | Goes to |
|--------|---------|
| Create Contact | Contacts (opens create flow) |
| Launch Pipeline | Sales → Pipeline |
| View Tasks | Schedule → Tasks |
| Open Analytics | Analytics |
| Schedule Meeting | Schedule |
| Sales Hub | Sales → Hub |

### Panels

| Panel | What it does |
|-------|----------------|
| **Goals** | Team/quarter goals vs progress |
| **Follow-up reminders** | Deals with no contact 7+ days; draft email, log call, snooze |
| **Tasks due** | Open tasks; **All tasks →** opens slide-over |
| **Top scored contacts** | AI lead scores; link to Lead Gen |
| **At risk** | Deals marked at-risk; compose / note actions |
| **Recent notes** | Latest logged interactions |
| **Charts** (lazy) | Stage funnel, revenue trend, deal health pie — share to Global Chat |

---

## 4. Contacts

**Purpose:** People you sell to (label varies by industry).

| Action | What it does |
|--------|----------------|
| **Search / filter** | Find by name, company, status |
| **Groups** | Tag contacts into segments |
| **+ Add contact** | Create modal |
| **Row click** | Open contact drawer |
| **Edit / Delete** | Update or remove contact |
| **Import** | CSV file picker (also in Data Management) |
| **Export** | Download contacts CSV |
| **Share to chat** | Post contact card to Global Team Chat |

---

## 5. Sales

Four **sub-tabs** (labels follow industry config):

### 5.1 Leads

**Purpose:** Lead generation and scoring.

| Area | What it does |
|------|----------------|
| Lead scores | Rule-based scoring from emails, notes, deals, tasks |
| Top leads list | Ranked prospects |
| Model tuning | Adjust lead scoring weights (persisted) |

### 5.2 Pipeline

**Purpose:** Move deals through stages.

**View toggles:**

| View | What it does |
|------|----------------|
| **Kanban** | Drag cards between stages; click deal for drawer (comments, email log, timeline) |
| **Swipe** (mobile) | Swipe cards to advance stage |
| **AI Probability** | Suggested win % per deal |
| **Velocity** | Time-in-stage analytics |

**Deal card actions:** Edit, delete, change stage, add comment, compose email.

### 5.3 Sales Hub

**Purpose:** **Team manager dashboard** — rep performance, team KPIs, discussion queue.

| Element | What it does |
|---------|----------------|
| KPI row | Total pipeline, weighted forecast, avg deal size, win %, YTD revenue, hot leads |
| **Rep performance** | Per-owner pipeline bars and stats |
| **Leads / Active deals** tables | All owners; **💬** pulls item into team discussion |
| **Team discussion** | Side panel for flagged leads/deals |
| Draggable chart panels | Revenue, pipeline pie, performance (manager layout) |

### 5.4 Quotas

| Toggle | What it does |
|--------|----------------|
| **Manager View** | All reps’ quotas |
| **My Quotas** | Personal quota progress |

Create/edit quotas by rep, period, revenue or deals-closed targets.

---

## 6. Schedule

Three **sub-tabs:**

### 6.1 Tasks & Meetings

| Action | What it does |
|--------|----------------|
| Task list | Toggle done, edit, delete |
| **+ Task** | New task with due date, assignee |
| Meetings list | Upcoming meetings linked to contacts |
| **+ Meeting** | Schedule with contact, time, type |
| Availability | Work hours / meeting types (for booking) |

### 6.2 Calendar

| View | What it does |
|------|----------------|
| Month / Week / Day / Agenda | Calendar layouts |
| **Connect Google** | OAuth — sync Google Calendar events into meetings |
| **Connect Outlook** | OAuth — sync Microsoft calendar |
| **Sync** | Pull external events after connected |
| **+ Meeting** | Create CRM meeting |
| **Download .ics** | Export meeting to calendar app |
| Heatmap | Meeting density by day |

### 6.3 Interactions

**Purpose:** History of logged calls, emails, meetings (from Notes). Filter and delete entries.

---

## 7. Companies

**Purpose:** Account-level view (B2B).

| Action | What it does |
|--------|----------------|
| Company list | ARR, MRR, health, linked contacts |
| **+ Company** | Add organization |
| Drill-down | Contacts and deals at that company |

---

## 8. Notes

**Purpose:** Team boards + interaction log.

| Area | What it does |
|------|----------------|
| **Boards** | Kanban-style note boards (team roster from Denizen API when signed in) |
| Cards | Move between columns; activity from real edits |
| Empty state | No demo fake chat — add boards or use Interactions tab |

---

## 9. Sequences

**Purpose:** Multi-step email/task cadences.

| Action | What it does |
|--------|----------------|
| **+ Sequence** | Define steps (email, wait, task) |
| **Enroll contact** | Start sequence for a contact |
| Server scheduler | Runs steps every ~5 min when Denizen + Supabase are up |
| **Compose** | Jump to email for a step |

---

## 10. Packages

**Purpose:** Productized offers (website tiers, service bundles).

| Action | What it does |
|--------|----------------|
| **+ Package** | Name, price, line items, description |
| Link to quotes | Used in Proposals & Intake |
| PDF | Generate proposal PDF (client-side) |

---

## 11. Proposals & Intake

**Purpose:** Quotes for clients + inbound lead forms.

| Area | What it does |
|------|----------------|
| **Quotes** | Build, send, track status (draft → sent → signed → paid) |
| **Portal link** | Generate client-facing URL (`#/portal/:token`) |
| **Intake form config** | Questions for public form |
| **Submissions** | Leads from public form; qualify → auto contact + deal |
| **Public URL** | `/crm/intake.html?org=YOUR_ORG_SLUG` |

---

## 12. Email Templates

| Action | What it does |
|--------|----------------|
| **+ Template** | Subject/body with merge fields (`{{name}}`, `{{deal.title}}`, etc.) |
| **Compose** | Open email composer with template |
| Send | Via **Resend** (server) or **mailto:** fallback |

---

## 13. Automations

**Purpose:** If-this-then-that rules on the server.

| Trigger examples | Actions |
|------------------|---------|
| Deal created / won / lost / moved / stale | Create task, notify, update field, draft email, webhook |
| Task overdue, contact added, form submitted | Same |

| UI | What it does |
|----|----------------|
| **+ Automation** | Build trigger + conditions + actions |
| Run log | See `automationRuns` history |

---

## 14. Analytics

**Purpose:** Funnel and revenue charts from live workspace data.

| Charts / metrics | Source |
|------------------|--------|
| Pipeline by stage | Deals |
| Win rate, cycle time | Deal close dates |
| Daily snapshots | Server scheduler (1:00 AM) |

---

## 15. AI Prospector

**Purpose:** Research and add prospect leads (imports into contacts).

| Action | What it does |
|--------|----------------|
| Search / criteria | Find prospects |
| **Import to CRM** | Creates contact + optional deal |

---

## 16. AI Assistant

**Purpose:** Chat copilot over **your workspace data**.

| Feature | What it does |
|---------|----------------|
| Chat threads | Persisted in `aiThreads` |
| Context | Contacts, deals, tasks sent to `/api/crm/assist` |
| Suggested actions | Open tab, create task from reply |
| Provider | LM Studio or configured NPC providers; **rules fallback** if no AI |

Ask: pipeline summary, today’s priorities, intake status, follow-up drafts.

---

## 17. Portal

**Purpose:** Preview how **clients** see a quote (manager view inside CRM).

Real client access is the **public link** from a quote (`#/portal/:token`) — sign, pay (Stripe if configured).

---

## 18. Data Management

Six sections:

### Import

| Control | What it does |
|---------|----------------|
| Entity type | Contacts, deals, tasks, companies, notes |
| **Import mode** | Append · Skip duplicates · Update by email · Replace all |
| Column mapping | Map CSV headers to fields + custom fields |
| **Import N** | Apply selected rows |

### Export

Download CSV per entity or **full workspace JSON** backup.

### Manage

Bulk contact actions, duplicate merge, clear entity types.

### Health

Data quality checks (missing emails, orphan deals, etc.).

### Audit

View/export `auditLog` (who changed what).

### Backup

Restore workspace from JSON (merge or replace).

**Load sample CRM data** — demo seed (explicit; not auto-loaded for new teams).

---

## 19. Setup (Onboarding)

| Area | What it does |
|------|----------------|
| **Getting started checklist** | Links to profile, invites, packages, intake, first contact/deal, AI |
| **Team members** | Roster from `/api/crm/team` |
| **Invite by email** | Sends invite via Resend when configured |

---

## 20. Settings

| Section | What it does |
|---------|----------------|
| **Profile** | Email, timezone, notification prefs (synced to workspace) |
| **Industry** | Pick template (Sales, Media, Healthcare, …) — sets stages & fields |
| **Terminology** | Rename Contact, Deal, Pipeline, etc. |
| **Stages & Statuses** | Edit pipeline stages, contact statuses, note types |
| **Custom Fields** | Add fields on contacts/deals (text, number, select, date, …) |
| **Notifications** | Email/in-app toggles, weekly digest |
| **Integrations** | Outbound webhooks: `deal_won`, `contact_added` → n8n or other URLs |

**Load demo data** may appear here (same as Data Management).

---

## 21. Industry terminology

**Settings → Industry** picks a vertical template. Each template sets:

- **Labels** (Contact → Stakeholder, Deal → Opportunity, etc.)
- **Pipeline stages** (e.g. GovCon: Capture → RFP → Submitted → Awarded)
- **Custom fields** (NAICS, ARR, clearance level, workload type, …)
- **Dashboard spotlight** (industry-specific chart on the role dashboard)

Use the **search box** to filter 40+ templates (e.g. `SaaS`, `govcon`, `healthcare`).

### Technology & cloud

| Template | Deal label | Key fields |
|----------|------------|------------|
| B2B Sales | Deal | ARR, MRR, contract length |
| **Software as a Service (SaaS)** | Subscription | ARR, MRR, seats, plan tier, trial end, NDR, churn risk |
| **Infrastructure as a Service (IaaS)** | Workload | Workload type, monthly spend, region, SLA, compliance |
| MSP / IT Services | Managed Service | Endpoints, stack, SLA tier, MRR |
| Cybersecurity | Engagement | Service line, framework, MRR |
| Telecommunications | Circuit / Service | Service type, MRC, term |

### Government & defense

| Template | Deal label | Key fields |
|----------|------------|------------|
| **Government Contracting** | Opportunity | NAICS, contract vehicle, set-aside, clearance, POP, solicitation # |
| Aerospace & Defense | Program | Platform, ITAR, clearance, contract vehicle |

### Other high-value verticals (selection)

Real Estate, Legal, Healthcare, Consulting, Education, Recruitment, Media, Financial Services, Nonprofit, Manufacturing, Retail, Insurance, Construction, Hospitality, Logistics, Agency, Solar, E-Commerce, Pharma & Life Sciences, Property Management, Franchise, Staffing, and more.

**Competitive positioning:** See [COMPETITIVE_ANALYSIS.md](./COMPETITIVE_ANALYSIS.md) for how Meridian compares to Salesforce, HubSpot, and the recommended feature roadmap.

Sidebar and dashboard use these labels via **useCRMTranslation**.

---

## 22. Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl/Cmd + K** | Command palette |
| **1–9, 0** | Jump to sidebar item 1–10 (when not typing in a field) |
| **Escape** | Close modal, sidebar, or FAB |

Mobile: swipe bottom bar to change main tab.

---

## 23. Public & client-facing surfaces

| URL / route | Who uses it | Purpose |
|-------------|-------------|---------|
| `/crm/` | Your team | Full CRM (this guide) |
| `/crm/intake.html?org=SLUG` | Prospects | Public lead form → `POST /api/crm/intake` |
| `/crm/#/portal/TOKEN` | Clients | View/sign/pay quote |

---

## 24. Sync status meanings

| Label | Meaning |
|-------|---------|
| **Synced** | Saved to team workspace |
| **Saving…** | Debounced PUT in flight |
| **Local** | Browser-only; not signed in or no cloud |
| **No session** | Open Denizen and sign in |
| **No org** | User has no org_id — check Denizen team setup |
| **Conflict** | Someone else saved newer data — reload offered |
| **Error** | API/ network failure — retry |

---

## Quick reference: sidebar order (keyboard 1–0)

| Key | Tab |
|-----|-----|
| 1 | Dashboard |
| 2 | Contacts |
| 3 | Sales |
| 4 | Schedule |
| 5 | Companies |
| 6 | Notes |
| 7 | Sequences |
| 8 | Packages |
| 9 | Proposals & Intake |
| 0 | Email Templates |

(Continue through Automations, Analytics, … via sidebar or Command palette.)

---

## Related docs

| Doc | Audience |
|-----|----------|
| [README.md](./README.md) | Build, deploy, env vars |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Real vs UI-only, API list |
| [COMPETITIVE_ANALYSIS.md](./COMPETITIVE_ANALYSIS.md) | vs Salesforce/HubSpot, roadmap |
| [../docs/DATABASE_SCHEMA.md](../docs/DATABASE_SCHEMA.md) | Supabase tables |

---

*Meridian CRM — Sales Manager edition. Hosted on Denizen. Vendor source: `crm/vendor/` (from [remix-of-deal-weaver](https://github.com/kaiser-create/remix-of-deal-weaver)).*
