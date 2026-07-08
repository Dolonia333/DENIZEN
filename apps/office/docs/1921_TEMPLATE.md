# 1921 GovCon Template Pack

> Master template for Denizen multi-user onboarding. Source: **1921 Strategic Partnership Dossier** (RM Cyber, June 2026) + **DENIZEN Technical Dossier v1.6.0**.

Canonical data: [`data/business-model.json`](../data/business-model.json) · Souls: [`npcs/`](../npcs/) · Seed: `node scripts/seed-agent-souls.js zion 1921-govcon`

---

## Company structure

| Entity | Role |
|--------|------|
| **1921 Holding Co., LLC** | Strategic parent — Angela Van Zandt, CEO |
| **Dolonia Data Tech Solutions (DDT)** | Technology arm — Zion Van Zandt, CEO |
| **Dolonia Engineering** | Dr. Ed Van Zandt — aerospace / manufacturing (541330) |
| **DENIZEN** | Visual AI OS — capture intelligence, CRM, 16 agents |
| **I.W.I.N.** | Workforce apprenticeships (DOL-aligned) |
| **SmartContainer™** | Infrastructure commercialization (partnership phase) |

**UEI:** YMP7Z9T1WVX5 · **CAGE:** 9T6Y5 · **Location:** Oklahoma City, OK (HUBZone)

**Certifications:** WOSB, MBE, WBE, SDB, AABE

---

## Strategic thesis

> Systems that help people navigate complex systems.

Capture loop: Opportunity → Research → Qualification → Capture → **DENIZEN intelligence** → Teaming → Proposal → Performance → Knowledge.

---

## Key NPC roles (1921 mapping)

| NPC | 1921 role |
|-----|-----------|
| **Abby** | CTO + capture strategy; executive pipeline; DENIZEN platform owner |
| **Lucy** | EA / intake / proposals / compliance scheduling; front door |
| **Marcus** | Capture tracker; deal timelines; OMES/teaming; at-risk federal bids |
| **Sarah** | Product / SmartContainer vision; packages; qualification |
| **Bob** | Prospect research; competitive intel; federal discovery |
| **Pier** | CRM data hygiene; spine sync; reporting |
| **Bouncer** | Compliance / security posture for gov work |
| **Alex + engineering** | DENIZEN product delivery (Zion's tech arm) |
| **Roki** | Research support; pipeline monitoring |

---

## Active pursuit (template default)

**OMES EV00000919** — Oklahoma state IT modernization; DDT/1921 as prime; **RM Cyber** (Benjamin Ballard) as cyber teaming partner.

**Critical blocker:** Teaming agreement with RM Cyber before October 2026 submission window. **Owner:** Marcus.

---

## Joint pursuit areas (RM Cyber)

- Government modernization
- Workforce technology (I.W.I.N.)
- Rural innovation (SmartContainer + connectivity)
- Healthcare systems
- Smart infrastructure / IoT
- AI-enabled operations (DENIZEN + cyber posture)

**Partnership type:** Joint pursuits — not passive investment.

---

## DENIZEN product one-liner

Real-time visual observability layer for AI agents — 16 LLM teammates, Meridian CRM, intelligence spine (~82.5% prediction accuracy in operator deployment).

---

## Template onboarding flow (target)

1. User signs up → new `org_id`
2. Clone `1921-govcon` template → `agent_souls` + `business-model` org row
3. User edits company name, pursuits, partners in UI or JSON
4. Office boots with hydrated souls + business context

---

## Files in this pack

| Asset | Path |
|-------|------|
| Business model | `data/business-model.json` |
| Company brief | `data/company-brief.json` |
| Souls (source of truth until DB seed) | `npcs/*/SOUL.md` |
| DB souls | `agent_souls` table after seed |
| Business context module | `src/compute/denizen-business-context.js` |
