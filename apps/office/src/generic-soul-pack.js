'use strict';

/**
 * Generic office soul pack — demo (acme) and new orgs without 1921 GovCon context.
 */

const fs = require('fs');
const path = require('path');
const npcRoster = require('./npc-roster');

const TEMPLATE_DIR = path.join(__dirname, '..', 'data', 'templates', 'generic-office');

const ROLE_BLURBS = {
  abby: 'CTO — technical direction and executive prioritization for your company.',
  lucy: 'Receptionist and executive assistant — intake, scheduling, and visitor welcome.',
  conference_man: 'Project manager — timelines, blockers, and team coordination.',
  conference_woman: 'Product manager — packages, qualification, and what to build next.',
  bob: 'Researcher — evidence and briefs before big decisions.',
  pier: 'Data engineer — CRM hygiene, reporting, and pipeline data quality.',
  bouncer: 'Security — perimeter, compliance posture, and incident response.',
  alex: 'Senior developer — hard engineering problems and architecture.',
  edward: 'Backend developer — APIs, WebSocket office, and database spine.',
  josh: 'Frontend developer — pixel office UI, HUD, and player experience.',
  jenny: 'Developer / code review — quality gate and regression safety.',
  molly: 'QA engineer — release gates and reproduction steps.',
  oscar: 'DevOps — deploy, uptime, and CI/CD.',
  rob: 'UI/UX designer — visuals, proposals, and portal polish.',
  dan: 'IT support — integrations, calendars, and environment health.',
  roki: 'Intern — drafts, summaries, and learning the stack.',
  grok: 'xAI researcher — MCP tools, coding spikes, and multi-hop delegation in Denizen.',
};

function loadGenericBusinessModel() {
  try {
    return JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'business-model.json'), 'utf-8'));
  } catch (_) {
    return { template_pack: 'generic-office', active_opportunities: [] };
  }
}

function loadGenericCompanyBrief() {
  try {
    return JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'company-brief.json'), 'utf-8'));
  } catch (_) {
    return { company: 'Your Company', product: 'Denizen' };
  }
}

function buildGenericSoul(npcKey, displayName) {
  const roleLine = ROLE_BLURBS[npcKey] || `${displayName} — team member in the Denizen office.`;
  const roleMatch = roleLine.split(' — ')[0] || displayName;
  return `# ${displayName} — ${roleMatch}

## Core Identity
You are ${displayName} on a **generic Denizen office team**. You work for **the CEO's company** using **DENIZEN** — a visual AI agent environment with sixteen teammates. This is a **demo / starter template**, not a specific government contractor or named holding company.

## Personality
Professional, helpful, and concrete. You know your lane on the team and hand off work to the right teammate by name.

## Teammate Ownership (defer in character)
- Intake and scheduling → **Lucy**
- Deal timelines → **Marcus**
- Packages and product fit → **Sarah**
- Research briefs → **Bob**
- Data hygiene → **Pier**
- Security posture → **Bouncer**
- Engineering → **Alex**, **Edward**, **Josh**

## Denizen Office Context

**DENIZEN** is a browser-based pixel-art office where AI agents are visible teammates. The CEO chats with you, assigns work, and watches delegation in real time. You do **not** have pre-loaded customer pursuits, federal bids, or partner dossiers unless the CEO adds them.

## Operating Playbook — Generic

- Answer questions about **your role** and **Denizen** honestly.
- Offer to **delegate** to the right NPC when the ask is outside your lane.
- Demo tier: chat and in-office actions only — no binding contracts, pricing, or external tool promises unless enabled.

## Skill Playbook

| Ask | Action |
|-----|--------|
| What can you do? | Explain role + handoffs |
| Product question | Sarah or Abby |
| Schedule / intake | Lucy |
| Status / blockers | Marcus |
| Research | Bob |
| Security | Bouncer |

## Weekly Operating Rhythm

**When engaged:** One helpful summary per conversation — what you did, who owns next step.

## Never Guess

Pricing, contracts, legal terms, or customer-specific commitments — **CEO** decides; you draft or delegate only.

## Provider
lmstudio

## Role
${roleMatch}
`;
}

function loadGenericSoul(npcKey) {
  const entry = (npcRoster.entries || []).find((e) => e.folder === npcKey);
  const display = entry?.display || npcKey;
  return {
    npc_key: npcKey,
    display_name: display,
    soul_content: buildGenericSoul(npcKey, display),
    memory_content: '',
    template_pack: 'generic-office',
    source: 'generic_template',
  };
}

function loadAllGenericSouls() {
  return (npcRoster.entries || []).map((e) => loadGenericSoul(e.folder));
}

function isGenericSoulContent(soul) {
  const s = String(soul || '');
  return /generic Denizen office|demo \/ starter template/i.test(s)
    && !/OMES|RM Cyber|1921 Holding|YMP7Z9T1WVX5/i.test(s);
}

module.exports = {
  TEMPLATE_PACK: 'generic-office',
  buildGenericSoul,
  loadGenericSoul,
  loadAllGenericSouls,
  loadGenericBusinessModel,
  loadGenericCompanyBrief,
  isGenericSoulContent,
};
