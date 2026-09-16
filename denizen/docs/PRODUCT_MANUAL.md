# Denizen — Product Manual

> A practical guide to using Denizen. For architecture see
> [TECHNICAL_OVERVIEW.md](TECHNICAL_OVERVIEW.md); for scope see [PRD.md](PRD.md).

---

## 1. What you get

Denizen gives you a **visible team of AI coworkers**. Instead of chatting with a
blank box, you walk into a pixel-art office where each character is an AI agent
with a job. You can see what they're working on, talk to them, hand them tasks,
and review their decisions — and they operate a real CRM, do research, draft
email, and run work on your own computers.

You run it like a tiny company: you're the CEO, the NPCs are your staff.

**Your team (NPCs)** includes agents like Lucy (research/browser), plus
specialists across sales, ops, and support — 18 in all, each with a defined
persona ("soul"), memory, and goals.

---

## 2. Getting started

### Landing → live demo
1. Open `/` (or `/landing`) — city hero with **Buzz** the lobby phone.
2. Press **B** or click Buzz for a high *beep beep*, then the live office demo (`/office?demo=1`).
3. Gold **Buzz** nameplate stays on the landing phone; the in-office corner phone FAB does not show that plate.

### Open the Office
1. Go to your Denizen URL (e.g. `https://denizen.dolonia.cloud`) or local `http://localhost:8080`.
2. The office loads. Move with **WASD/arrows**; click an NPC to talk.
3. On phone/tablet, the touch controls and the **Denizen OS phone** (📱 button)
   appear automatically.

### Sign in (pick your door)
- **Demo** — instant guest access to explore. Data is throwaway.
- **Team** — enter your team code, then your **name + work email**. This links
  your profile, chat memory, and credits to *you*.
- **CEO / Owner** — your owner login unlocks host stats, the compute fleet,
  approvals, and full control. CEO status is cryptographically granted, so it
  follows your real account, not whatever browser you're in.

> Tip: always sign in with your real account before pairing devices — a device
> paired during a *demo* session gets attributed to a throwaway guest.

---

## 3. Working with your AI team

- **Talk to an NPC**: click them (or use the chat dock / phone Chat app). Ask for
  status, give direction, or assign work.
- **Watch the work**: agents move, sit at desks, and animate as they act —
  that's the "observability" — you can literally see who's busy and on what.
- **Directives & approvals**: bigger or riskier agent actions surface as
  **proposals** you approve or reject (capabilities, code, animations). Nothing
  high-impact happens silently.
- **Memory**: agents remember what you tell them; their memory persists across
  sessions.

---

## 4. The Denizen OS phone (mobile + desktop)

Tap the **📱 button** to open the in-world phone — a concept "Denizen OS" home
screen with apps for Chat, the CRM, Studio Board, Business Studio, Compute, Profile, Settings, and more. Apps
that need a full surface (CRM, Studio Board, Business Studio) navigate to their own page; everything else
stays inside the phone HUD.
open as panels; favorites sit in the dock. Use it as the fast way to reach any
tool without hunting the toolbar. (Legacy toolbar: add `?phonemode=0` to the URL.)

---

## 5. Connect your own AI subscription (MCP)

You can drive any NPC from the AI you already pay for — Claude.ai, ChatGPT,
Cursor, or Claude Desktop — so your subscription's model becomes that agent's brain.

**The 1-click way (recommended):**
1. Click **Connect AI** (next to your assistant), choose the **1-Click** tab.
2. Copy the single **MCP URL**.
3. Paste it into your AI app's connector settings:
   - **Claude.ai** → Settings → Connectors → Add custom connector → paste → Connect
   - **ChatGPT** (Pro/Business) → Settings → Connectors → Add → paste
   - **Cursor** → Settings → MCP → Add → paste
4. Your AI opens a **Denizen sign-in** to authorize — approve it. Done.

No token to copy; authorization happens in your browser. Your AI can now read the
NPC's status and add memories/activity through the agent's tools. (Advanced tabs
still offer manual token setup for Companion/Cursor/API if you prefer.)

---

## 6. Meridian CRM

Open **CRM** from the phone or go to `/crm/`. It's a complete CRM your agents and
team operate together.

### Switch your dashboard by role
A row of role pills at the top of the dashboard reshapes everything for your job:
**Sales Rep, Sales Manager, SDR/BDR, Account Manager, Marketing, Support,
Founder/Exec.** Each shows the KPIs and widgets that matter to that role.

### Switch your industry
**Settings → Industry** offers 28 templates (Real Estate, Legal, Healthcare,
Insurance, Construction, Fitness, Solar, Agency, and more). Picking one re-labels
the whole CRM (e.g. *Deals → Listings/Cases/Policies*), changes pipeline stages and
custom fields, **and** reshapes the dashboard with industry-specific widgets.

### Daily use
- **Contacts / Pipeline / Schedule** — the core workspace.
- **Proposals & Intake** — public intake forms feed leads in; convert to deals.
- **Quotes & Portal** — send a quote; clients view, e-sign, and pay (Stripe) via a
  public link.
- **Sequences & Email Templates** — automated follow-up; Resend delivery tracking.
- **Automations** — rules like "when a deal is won, create a task / send webhook."
  Conditions support `deal.value >= 10000`, `stage:Proposal`, AND/OR, and keywords.
- **AI assistant** — ask the CRM copilot to summarize, suggest actions, draft.
- **Calendar** — connect Google/Microsoft to sync meetings.
- **Data Management** — import/export, load demo data, restore.

**MCP** — prefer `crm_working_set` (or `agency_working_set` with Studio Board) first:

| Tool | Purpose |
|------|---------|
| `crm_working_set` / `crm_pipeline_brief` | Live pipeline + at-risk (read) |
| `crm_list_tasks` | Open CRM follow-ups |
| `crm_upsert_contact` / `crm_upsert_deal` / `crm_move_deal` | First-class CRM writes |
| `crm_upsert_task` / `crm_complete_task` / `crm_add_note` | Tasks + notes |
| `crm_park_deal` | Park scrape/research to watchlist |
| `crm_draft_email` / `send_draft` / `mail_policy_status` | Mail under policy |

CRM deals may carry optional `studio_task_ids`; Studio Board tasks may carry optional `deal_id` / `contact_id` so sales and delivery stay linked without merging the apps. The CRM deal slideout **Studio Board** panel and MCP agency tools share the same bridge (`denizen-agency-bridge`) and HTTP routes under `/api/crm/deals/:id/studio-tasks`.

## 6b. Studio Board (Agency Tracker)

Open **Studio Board** from the phone, the CRM sidebar link, or go to `/studio-board/` (deep-link with `?deal=` / `?task=` from a CRM deal). Like CRM, it opens as
its own full-page app — not an in-phone iframe. New boards start **empty** with no sample people or tasks; templates only set categories/stages. It's a Monday.com-style work board for
agency pipelines: **Calendar**, **Table**, **Board**, **Timeline**, **My Day**, **Team**,
**Activity**, and **Settings**. Create tasks, custom columns, blockers, automations,
filter by type, save views, and clear the board. Use **← Back to office** to return to Denizen.

When you're signed into a **team** office, the board syncs to your org
(`GET|PUT /api/studio-board/workspace`, plus `PATCH /tasks/:id`, presence heartbeats)
so teammates and MCP agents share the same truth. Visible tabs poll ~every 4s and
rebase on conflicts instead of silently dropping local edits. Live presence shows who
is viewing or editing. Owner/admin roles gate Settings structure (stages, columns,
automations); members keep full task CRUD. Offline/demo still falls back to browser
storage. **My Day** matches your Denizen login to a board person (or offers “Use my login”).

**MCP (ChatGPT / Cursor / team token)** — same pattern as CRM. Prefer
`studio_board_working_set` first (or `agency_working_set` when coordinating sales + delivery), then:

| Tool | Purpose |
|------|---------|
| `studio_board_working_set` | Open / overdue / stuck + people + stages |
| `studio_board_brief` | Short briefing for standup |
| `studio_board_list_tasks` / `get_task` | Filtered list or full task detail |
| `studio_board_upsert_task` / `delete_task` | Create, update, or delete (fields, dates, blockers) |
| `studio_board_advance_task` / `assign_task` | Move stage / assign (respects blockers) |
| `studio_board_add_comment` | Comment on a task |
| `studio_board_add_subtask` / `toggle_subtask` / `delete_subtask` | Checklist items |
| `studio_board_list_events` / `upsert_event` / `delete_event` | Meetings & follow-ups |
| `studio_board_list_people` / `upsert_person` / `delete_person` | Team strip |
| `studio_board_list_notes` / `send_note` | Teammate inbox notes |
| `studio_board_get_config` / `update_config` | Categories, pipeline, ACL |
| `studio_board_list_columns` / `upsert_column` / `set_field` | Custom columns |
| `studio_board_set_dates` / `set_blockers` / `timeline` | Timeline / Gantt |
| `studio_board_list_automations` / `upsert_automation` | When→then rules |
| `studio_board_standup` | Standup or weekly recap text |
| `studio_board_my_day` | Overdue / due today / meetings for a person |

**Agency (CRM ↔ Board)** — use when coordinating both systems (same ops as the CRM deal panel):

| Tool | Purpose |
|------|---------|
| `agency_working_set` | Joint CRM + Board brief + linked pairs |
| `agency_list_deal_tasks` | List board tasks linked to a CRM deal |
| `agency_link_deal_task` / `agency_unlink_deal_task` | Bind or remove deal ↔ board task both ways |
| `agency_create_delivery_task` | Create linked delivery task from any deal |
| `agency_handoff_won_deal` | Closed Won → create linked delivery task |
| `agency_advance_deal_task` | Advance a linked board task |

## 6c. Business Studio (Founder OS)

Open **Business Studio** from the phone (next to CRM and Studio Board) or go to
`/business-studio/`. Like CRM and Studio Board, it opens as its own full-page app —
not an in-phone iframe. Use **← Back to office** to return to Denizen.

It's an evidence-gated founder OS: programs (E3/PAVE as a template, not hard-coded),
roadmap, goals, experiments, metrics, Funding Readiness, Market Sizing, Moat Builder,
Discovery Lab, Capital Pathway, and Data Room. Mentor/investor views use ACL filters
so shared advice never exposes private notes.

When you're signed into a **team** office, the workspace syncs to your org
(`GET|PUT /api/business-studio/workspace`) with mentor recommendation endpoints under
`/api/business-studio/`. Offline/demo falls back to browser storage (`dz-bs:`).

**MCP** — `business_studio_*` tools (working set, progress, evidence, funding) share
the same team/NPC gateway scopes as CRM write tools where mutations are needed.

---

## 7. Compute fleet (contribute your machines)

Denizen can run AI work on **your** computers and credit you for it.

- **The desktop app** turns a machine into a *node*. It pairs to your account,
  asks which capabilities to allow (run code, read files, contribute compute…),
  and then quietly runs jobs (mainly local LLM inference on your GPU).
- **Your station** (your main rig with a strong GPU) is the workhorse. Other
  machines (a laptop) can join the same fleet under your account.
- **Credits** accrue to the account a node is paired to — so make sure each
  machine is paired to *your* account, not a demo guest.
- See your fleet and live nodes from the Compute app / CRM compute views.

---

## 8. Desktop app

1. Install the Denizen desktop app and launch it.
2. **Pair**: it opens your browser to Denizen — **sign in as your real account**,
   and the computer links automatically.
3. **Permissions**: choose what the agents may do on this machine.
4. It then contributes compute and can run desktop tasks you approve.

To **re-pair** a machine to a different account: in the app re-run *Link this
computer*, or delete the setup file (`%APPDATA%\Denizen\denizen-desktop-setup.json`
on Windows) and relaunch to run the setup wizard again.

---

## 9. Companion browser extension

Install the companion extension (Chrome) to push text or context from any web AI
straight to an NPC ("Send to Denizen NPC", or **Ctrl+Shift+D**). It's the
provider-agnostic option when you don't want to set up MCP.

---

## 10. Settings & security

- **Your profile** is yours: each user sees their *own* identity and data — not
  the owner's. (This was hardened so tunnel/team visitors can't inherit host info.)
- **Approvals**: high-impact agent actions need your sign-off.
- **Permissions**: desktop capabilities are explicit and per-machine.
- **CEO/owner** controls (host stats, fleet, approvals) require your verified
  owner login.

---

## 11. Troubleshooting

| Symptom | Likely cause & fix |
|---|---|
| "Bad gateway" on the public URL | Tunnel points at the wrong port, or the server isn't running. Confirm the server is up and `cloudflared` routes to its port; restart the tunnel/service. |
| A teammate sees the owner's stats | Stale/incorrect session — sign out and back in with the team code + work email. (Identity isolation is enforced server-side.) |
| Compute shows your rig under a demo guest | The desktop app was paired during a demo session. Re-pair it signed into your real account (see §8). |
| Laptop "connected" but does 0 jobs | Expected if it's a weak/integrated-GPU machine, frequently offline, or the only jobs are LLM inference your station claims first. |
| Phone app button does nothing | Hard-refresh (cache-bust). If it's a role-gated tool you don't have access to, it stays hidden. |
| DB rows "impossibly" revert | A stale/zombie server process may still be writing. Ensure only one server instance is running. |
| Changes to the server don't take effect | The live process is running old code — restart it (pm2/service). |

---

## 12. Glossary

- **Office** — the live world you walk around in.
- **NPC / Agent** — one of your AI coworkers.
- **Soul** — an NPC's persona/goals definition.
- **Station** — your primary, powerful computer in the fleet.
- **Node** — any machine contributing compute.
- **MCP** — the standard that lets your AI subscription connect to an agent.
- **Meridian** — the built-in CRM.
- **Grant** — the signed token that proves your CEO/access rights.
- **Credits** — what you earn for contributing compute.
