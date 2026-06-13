'use strict';

/**
 * Meridian CRM personas for the 16 office NPCs — expertise overlays for /api/crm/assist
 * and player-chat CRM skill routing.
 */

const CRM_NPC_PERSONAS = [
  { key: 'abby', name: 'Abby', title: 'CTO', expertise: 'strategy, team priorities, executive pipeline review', canWrite: true, setupOwner: ['ai', 'industry'] },
  { key: 'alex', name: 'Alex', title: 'Senior Developer', expertise: 'client demos, product walkthroughs, UI feedback on deals', canWrite: false, setupOwner: [] },
  { key: 'bob', name: 'Bob', title: 'Researcher', expertise: 'prospect research, competitive intel, technical discovery on deals', canWrite: false, setupOwner: [] },
  { key: 'jenny', name: 'Jenny', title: 'Developer', expertise: 'data migrations, backend delivery timelines, CRM integrations', canWrite: false, setupOwner: [] },
  { key: 'dan', name: 'Dan', title: 'IT Support', expertise: 'CRM access, calendar/email integrations, notification setup', canWrite: false, setupOwner: ['profile'] },
  { key: 'lucy', name: 'Lucy', title: 'Receptionist', expertise: 'intake, scheduling, contact logging, CRM ops', canWrite: true, setupOwner: ['invite', 'intake', 'contact'] },
  { key: 'bouncer', name: 'Bouncer', title: 'Security Guard', expertise: 'compliance flags, sensitive account handling', canWrite: false, setupOwner: [] },
  { key: 'conference_man', name: 'Marcus', title: 'Project Manager', expertise: 'delivery timelines, account health, sprint-linked deals', canWrite: true, setupOwner: ['deal'] },
  { key: 'conference_woman', name: 'Sarah', title: 'Product Manager', expertise: 'qualification, industry fit, packages, deal strategy', canWrite: true, setupOwner: ['packages', 'industry'] },
  { key: 'edward', name: 'Edward', title: 'Backend Developer', expertise: 'deployment scope, infra-heavy proposals, CRM webhooks', canWrite: false, setupOwner: [] },
  { key: 'josh', name: 'Josh', title: 'Frontend Developer', expertise: 'UX requirements, intake forms, client portal polish', canWrite: false, setupOwner: [] },
  { key: 'molly', name: 'Molly', title: 'QA Engineer', expertise: 'acceptance criteria, release gates on client work', canWrite: false, setupOwner: [] },
  { key: 'oscar', name: 'Oscar', title: 'DevOps Engineer', expertise: 'CRM uptime, integrations health, automation reliability', canWrite: false, setupOwner: [] },
  { key: 'pier', name: 'Pier', title: 'Data Engineer', expertise: 'CRM data hygiene, spine sync, reporting', canWrite: true, setupOwner: [] },
  { key: 'rob', name: 'Rob', title: 'UI/UX Designer', expertise: 'client touchpoints, proposal visuals, brand fit', canWrite: true, setupOwner: [] },
  { key: 'roki', name: 'Roki', title: 'Intern', expertise: 'lead lists, follow-up drafts, research support', canWrite: false, setupOwner: [] },
];

const CRM_READ_SKILLS = 'crm-summary, crm-setup-status, crm-list-pipeline, crm-list-tasks, crm-at-risk, crm-list-industries, crm-list-tickets';
const CRM_WRITE_SKILLS = 'crm-add-contact, crm-update-deal, crm-add-task, crm-apply-industry, crm-add-ticket';
const CRM_UI_HINT = 'Meridian CRM at /crm/ (Phone app + desktop); workspace in denizen_crm_workspaces.';

const byKey = Object.fromEntries(CRM_NPC_PERSONAS.map((p) => [p.key, p]));
const byName = Object.fromEntries(CRM_NPC_PERSONAS.map((p) => [p.name.toLowerCase(), p]));

function resolvePersona(npcKeyOrName) {
  const raw = String(npcKeyOrName || '').trim().toLowerCase();
  if (!raw) return null;
  return byKey[raw] || byName[raw] || null;
}

function crmSkillSuffix(canWrite) {
  const read = CRM_READ_SKILLS;
  const write = CRM_WRITE_SKILLS;
  return canWrite
    ? `${read}, ${write} (${CRM_UI_HINT})`
    : `${read} (${CRM_UI_HINT})`;
}

function buildAssistPersonaBlock(npcKeyOrName) {
  const persona = resolvePersona(npcKeyOrName);
  if (!persona) return '';
  const setupHint = persona.setupOwner?.length
    ? `You help with CRM setup steps: ${persona.setupOwner.join(', ')}.`
    : '';
  return [
    `You are ${persona.name}, ${persona.title} on this Denizen team.`,
    `CRM specialty: ${persona.expertise}.`,
    setupHint,
    persona.canWrite
      ? 'You may add contacts, update deals, create tasks, and apply industry templates when appropriate.'
      : 'You read CRM data and advise on setup/management — defer writes to Lucy, Marcus, Sarah, Pier, Rob, or Abby.',
    'Stay in character: short, practical, and distinct from a generic copilot.',
    'When setup is incomplete, tell the user the next onboarding step and which teammate owns it.',
  ].filter(Boolean).join(' ');
}

function buildPlayerChatCrmBlock(npcKeyOrName, setupSummary) {
  const persona = resolvePersona(npcKeyOrName);
  if (!persona || !setupSummary) return '';
  let crmSetup;
  try { crmSetup = require('./denizen-crm-setup'); } catch (_) { return ''; }
  const guidance = crmSetup.buildNpcSetupGuidance(persona.name, setupSummary);
  const lines = [
    `## Meridian CRM (your team workspace)`,
    crmSetup.formatSetupSummaryText(setupSummary),
    `You can run CRM skills via run_skill or answer from this snapshot.`,
    persona.canWrite
      ? 'You may execute CRM writes (contacts, deals, tasks, industry template).'
      : 'You are read-only for CRM writes — suggest the action and name who should run it (Lucy, Marcus, Sarah, Pier, Rob, Abby).',
  ];
  if (guidance) lines.push(guidance);
  return lines.join('\n');
}

function isCrmRelatedMessage(message) {
  const msg = String(message || '');
  return /\b(crm|meridian|pipeline|deal|deals|contact|contacts|prospect|intake|follow.?up|onboarding|industry template|setup|notification|task reminder|at.?risk|won deal|closed won|add contact|update deal|move deal|log contact|packages|intake form|overdue|tasks?|ticket|support|campaign|marketing)\b/i.test(msg);
}

function inferCrmAction(message) {
  const msg = String(message || '').trim();
  if (!msg) return null;
  const lower = msg.toLowerCase();

  if (!isCrmRelatedMessage(msg)) return null;

  if (/\b(list|show|what)\b.*\b(industr|vertical|template)/i.test(msg)) {
    return { skill: 'crm-list-industries', params: { task: msg }, source: 'infer-crm' };
  }

  if (/\b(apply|set|use|switch|configure)\b.*\b(industry|vertical|template)\b/i.test(msg)
    || /\b(industry|vertical)\b.*\b(saas|govcon|real estate|healthcare|legal|agency|consulting|sales)\b/i.test(msg)) {
    const industryBridge = require('./denizen-crm-industry-bridge');
    const words = msg.replace(/[^a-z0-9\s-]/gi, ' ').split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += 1) {
      const id = industryBridge.resolveIndustryId(words.slice(i, i + 3).join(' '))
        || industryBridge.resolveIndustryId(words[i]);
      if (id) return { skill: 'crm-apply-industry', params: { templateId: id, task: msg }, source: 'infer-crm' };
    }
    return { skill: 'crm-list-industries', params: { task: msg }, source: 'infer-crm' };
  }

  if (/\b(setup|onboarding|getting started|configure crm|stand up|set up)\b.*\b(crm|meridian)\b/i.test(msg)
    || /\b(crm|meridian)\b.*\b(setup|onboarding|getting started)\b/i.test(msg)) {
    return { skill: 'crm-setup-status', params: { task: msg }, source: 'infer-crm' };
  }

  if (/\b(add|create|open|log|new)\b.*\b(ticket|support case|support request)\b/i.test(msg)
    || /\b(ticket|support)\b.*\b(add|create|open|log)\b/i.test(msg)) {
    return { skill: 'crm-add-ticket', params: parseCrmParams(msg), source: 'infer-crm' };
  }

  if (/\b(list|show|open|my)\b.*\b(tickets?|support cases?)\b/i.test(msg)
    || /\b(tickets?|support queue)\b.*\b(open|overdue|sla)\b/i.test(msg)) {
    const overdue = /\boverdue|sla\b/i.test(msg);
    return { skill: 'crm-list-tickets', params: { overdue: overdue ? 1 : 0, task: msg }, source: 'infer-crm' };
  }

  if (/\b(add|create|schedule|remind)\b.*\b(task|follow.?up|reminder)\b/i.test(msg)) {
    return { skill: 'crm-add-task', params: parseCrmParams(msg), source: 'infer-crm' };
  }

  if (/\b(overdue|open|pending|my)\b.*\b(tasks?|to.?dos?)\b/i.test(msg)
    || /\b(tasks?|to.?dos?)\b.*\b(due|overdue|today)\b/i.test(msg)) {
    const overdue = /\boverdue\b/i.test(msg);
    return { skill: 'crm-list-tasks', params: { overdue: overdue ? 1 : 0, task: msg }, source: 'infer-crm' };
  }

  if (/\b(at.?risk|risky|stalled|stuck)\b.*\b(deal|pipeline|account)/i.test(msg)) {
    return { skill: 'crm-at-risk', params: { task: msg }, source: 'infer-crm' };
  }

  if (/\b(add|create|log|new)\b.*\bcontact\b/i.test(msg) || /\bcontact\b.*\b(add|create|log)\b/i.test(msg)) {
    return { skill: 'crm-add-contact', params: parseCrmParams(msg), source: 'infer-crm' };
  }
  if (/\b(update|move|mark|close|won|lost)\b.*\bdeal\b/i.test(msg) || /\bdeal\b.*\b(stage|pipeline|won|lost|move)\b/i.test(msg)) {
    return { skill: 'crm-update-deal', params: parseCrmParams(msg), source: 'infer-crm' };
  }
  if (/\b(list|show|open|what).*\b(deal|pipeline|deals)\b/i.test(msg) || /\bpipeline\b/i.test(lower)) {
    return { skill: 'crm-list-pipeline', params: { task: msg }, source: 'infer-crm' };
  }
  if (/\b(crm|meridian|summary|summarize|how many|count|status|notification)\b/i.test(lower)) {
    return { skill: 'crm-setup-status', params: { task: msg }, source: 'infer-crm' };
  }
  return { skill: 'crm-summary', params: { task: msg }, source: 'infer-crm' };
}

function parseCrmParams(message) {
  const msg = String(message || '');
  const out = { task: msg };
  const emailM = msg.match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (emailM) out.email = emailM[0];

  const nameM = msg.match(/\b(?:contact|for|named?|add)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (nameM) out.name = nameM[1].trim();

  const companyM = msg.match(/\b(?:at|from|company)\s+([A-Z][A-Za-z0-9&.\s-]{2,40})/);
  if (companyM) out.company = companyM[1].trim();

  const stageM = msg.match(/\b(?:stage|move to|mark as)\s+["']?([^"',\n]+?)["']?(?:\s|$|\.)/i);
  if (stageM) out.stage = stageM[1].trim();

  const dealM = msg.match(/\bdeal\s+["']?([^"'\n]+?)["']?(?:\s+to|\s*$)/i);
  if (dealM) out.title = dealM[1].trim();

  const taskM = msg.match(/\b(?:task|follow.?up|remind(?:er)?)\s+(?:to\s+)?["']?([^"'\n.]+?)["']?(?:\s+due|\s*$|\.)/i);
  if (taskM) out.title = taskM[1].trim();

  const dueM = msg.match(/\bdue\s+(\d{4}-\d{2}-\d{2}|\w+\s+\d{1,2})/i);
  if (dueM) out.due = dueM[1];

  return out;
}

const CRM_WRITE_ACTIONS = new Set([
  'crm-add-contact',
  'crm-update-deal',
  'crm-add-task',
  'crm-apply-industry',
  'crm-add-ticket',
]);

function isWriteSkill(skill) {
  return CRM_WRITE_ACTIONS.has(skill);
}

module.exports = {
  CRM_NPC_PERSONAS,
  CRM_READ_SKILLS,
  CRM_WRITE_SKILLS,
  CRM_UI_HINT,
  CRM_WRITE_ACTIONS,
  resolvePersona,
  crmSkillSuffix,
  buildAssistPersonaBlock,
  buildPlayerChatCrmBlock,
  isCrmRelatedMessage,
  inferCrmAction,
  parseCrmParams,
  isWriteSkill,
};
