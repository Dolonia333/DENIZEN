# Denizen — Product Requirements Document (PRD)

> Living product spec. Pairs with [TECHNICAL_OVERVIEW.md](TECHNICAL_OVERVIEW.md)
> (how it's built) and [PRODUCT_MANUAL.md](PRODUCT_MANUAL.md) (how it's used).
> Status reflects the current build; see [ROADMAP.md](ROADMAP.md) for sequencing.

---

## 1. Vision

**Make a team of AI agents as legible and manageable as a team of people.**

Today, AI work is invisible — it happens inside chat windows and logs, with no
sense of who's doing what, whether it's trustworthy, or how it adds up. Denizen
turns an agent workforce into a **place you can see and run**: a visual office
where each agent is a character doing real business work, accountable to a human
operator, operating real tools (a CRM, research, email, compute), and powered by
whatever AI you already pay for.

**One-liner:** *Denizen is the operating layer for your AI company — a visible,
accountable office where AI agents run the business and you stay in control.*

---

## 2. Problem statement

1. **Opacity** — you can't see what autonomous agents are doing or why; trust and
   debugging are hard.
2. **Fragmentation** — agents, CRM data, compute, and identity live in separate,
   disconnected tools.
3. **Lock-in & cost** — agent platforms force a specific model/provider and meter
   usage instead of letting people use the AI subscription they already have.
4. **No accountability** — high-impact agent actions happen without review;
   attribution of work, data, and cost is murky.

---

## 3. Target users & personas

| Persona | Who | Primary need |
|---|---|---|
| **Solo founder / operator** | Runs a small business with AI leverage | A visible AI "staff" that does real work with minimal oversight |
| **Sales/CRM team** | Reps, managers, SDRs, AMs, marketers, support | A role- and industry-fit CRM their agents help operate |
| **Compute contributor** | Has a capable GPU rig | Earn credits by contributing idle compute |
| **AI power user** | Pays for Claude/ChatGPT/Cursor | Drive agents with their existing subscription, no new metering |
| **Engineering teams** (longer-term) | Teams adopting agentic workflows | Observability + governance for agent fleets |

Primary persona for v1: the **solo founder/operator** running a virtual company.

---

## 4. Goals & non-goals

### Goals
- G1. Render agent work as a **live, navigable world** (observability by default).
- G2. Ship a **complete, multi-role, multi-industry CRM** agents and humans share.
- G3. Let users **connect their own AI subscription** to agents with ~1 click (MCP).
- G4. Run agent compute on the **user's own machines** with credit attribution.
- G5. Enforce **identity, isolation, and human approval** on impactful actions.

### Non-goals (v1)
- Not a general-purpose game engine or world builder for third parties.
- Not a managed/metered LLM reseller (bring your own model/subscription).
- Not a public multi-tenant SaaS at scale yet (single-operator / small-team focus).
- Not a replacement for full ITSM/security suites (the bouncer is lightweight).

---

## 5. Product pillars & functional requirements

### Pillar A — The Office (observability) ✅ shipped
- **A1** Real-time pixel-art world; NPCs animate to reflect actual agent activity.
- **A2** Per-agent identity: persona ("soul"), goals, persistent memory, mood.
- **A3** Talk to any agent; assign directives; see status.
- **A4** Responsive clients: desktop, the **Denizen OS phone** UI, touch.
- **A5** World generation, pathfinding, layout editing.

### Pillar B — Meridian CRM ✅ shipped
- **B1** Workspace per org (contacts, deals, tasks, notes, companies, quotes, …).
- **B2** **Role dashboards** — 7 personas, each with tailored KPIs/widgets, switchable.
- **B3** **Industry editions** — 28 templates re-skin terminology, stages, fields,
  and dashboard spotlight widgets.
- **B4** Pipeline, sequences, email templates, automations (rules engine with
  real condition evaluation), analytics.
- **B5** Public intake forms (rate-limited), quote portal with e-sign + Stripe pay.
- **B6** Integrations: Resend email (+ delivery webhooks), Google/MS calendar.
- **B7** AI copilot over the workspace; spine sync to the entity registry.

### Pillar C — Bring-your-own-AI (MCP) ✅ shipped
- **C1** Per-NPC MCP gateway with agent tools (`get_status`, `update_memory`,
  `log_activity`).
- **C2** **OAuth 2.1 connector** (discovery + dynamic registration + PKCE +
  consent) so Claude.ai/ChatGPT/Cursor connect by URL alone.
- **C3** Connect UI with a 1-click path; legacy bearer-token paths retained.
- **C4** Rate limiting + token hashing; 401s advertise discovery.

### Pillar D — Compute mesh ✅ shipped (with known gaps)
- **D1** Node registration, heartbeat, FIFO job claim/complete.
- **D2** Desktop worker runs jobs (LLM inference) on the user's GPU.
- **D3** Credits ledger + daily contribution totals; per-node attribution.
- **D4** *Gap:* no capability-aware job targeting (any node may claim any job);
  weak/offline nodes naturally do little. (See Risks / Roadmap.)

### Pillar E — Identity, governance & security ✅ shipped
- **E1** Tiered access (demo/team/CEO) with HMAC-signed, rolling grants.
- **E2** Strict per-user data isolation; tunnel-aware locality (no host-info bleed).
- **E3** Human approval for capability/code/animation/soul proposals.
- **E4** Lightweight security monitor (bouncer) + threat feed.
- **E5** Per-machine, explicit desktop permission grants.

### Pillar F — Autonomy & intelligence 🔶 evolving
- **F1** Prediction → outcome learning loop (mirofish).
- **F2** Research chains (Lucy browser/search), scheduled background work.
- **F3** Intelligence spine feeding CRM/world signals into agent context.

---

## 6. Key user flows

1. **First run** → open office → choose door (demo/team/CEO) → meet your agents.
2. **Delegate work** → click an agent → assign a directive → watch it act →
   approve any proposal it raises.
3. **Connect my AI** → Connect AI → copy MCP URL → paste into Claude.ai →
   authorize → my subscription now powers that agent.
4. **Run the CRM** → pick my role → (optionally) pick my industry → work the
   pipeline; agents assist; automations fire.
5. **Contribute compute** → install desktop app → pair to my account → grant
   capabilities → earn credits as my GPU runs jobs.

---

## 7. Success metrics

- **Activation**: % of new operators who reach "first delegated task completed."
- **BYO-AI adoption**: # of agents connected via MCP / # active operators.
- **CRM stickiness**: weekly active workspaces; deals/contacts created per week.
- **Compute**: live contributor nodes; jobs completed/day; credits issued.
- **Trust**: proposal approval latency; % impactful actions gated by approval.
- **Reliability**: server uptime behind tunnel; job success rate; p95 think latency.

---

## 8. Technical requirements & constraints

- **BYO model**: must work with local (LM Studio) and cloud LLMs; never hard-require
  a single vendor.
- **Standards-based connect**: MCP authorization (OAuth 2.1 + PKCE, RFC 8414/9728/7591).
- **Data**: Supabase/Postgres; per-org isolation; service-role access server-side only.
- **Security**: signed grants; no trust of client-set privilege flags;
  fail-closed webhook verification; input limits + rate limits on public endpoints.
- **Deploy**: single Node process + Cloudflare Tunnel + Tailscale mesh; restart
  required to ship server changes.
- **Performance**: world stays interactive at 60fps target; agent think jobs are
  async via the compute queue.

---

## 9. Risks & open questions

| # | Risk / question | Mitigation / note |
|---|---|---|
| R1 | Compute jobs aren't capability-targeted → weak nodes idle, station does all work | Add job routing by node capability/hardware (roadmap) |
| R2 | Devices paired during demo sessions mis-attribute compute/credits | Guard pairing to require a real account; surface "who is this paired to" |
| R3 | Single-process server; restart needed for changes; one zombie can corrupt data | Process supervision; single-instance guard; health/runbook |
| R4 | MCP consent relies on same-browser Denizen session | Document; consider server-side session handoff for hosted connectors |
| R5 | Many undocumented integration env vars (Stripe/calendar/Resend) | Centralize config doc + startup validation |
| R6 | Scope breadth (game + CRM + mesh + autonomy) risks focus | Keep solo-operator persona as the v1 north star |

---

## 10. Roadmap (themes)

- **Now**: harden identity/compute attribution; MCP OAuth GA; CRM role/industry
  depth; cleanup of stale fleet state.
- **Next**: capability-aware compute routing; credits/economy surfacing; richer
  agent autonomy (prediction-driven action); deeper governance UI.
- **Later**: multi-operator/team scale; marketplace of agent souls/skills;
  broader integration catalog.

Detailed sequencing: [ROADMAP.md](ROADMAP.md) and
[ROADMAP_SELF_ADVANCEMENT.md](ROADMAP_SELF_ADVANCEMENT.md).
