'use strict';

/**
 * Meridian CRM personas for the 16 office NPCs — expertise overlays for /api/crm/assist
 * and player-chat CRM skill routing.
 */

const CRM_READ_SKILLS_LIST = [
  'crm-summary', 'crm-setup-status', 'crm-list-pipeline', 'crm-list-tasks', 'crm-at-risk',
  'crm-list-industries', 'crm-list-tickets', 'crm-get-intake-link', 'crm-pipeline-brief',
  'business-context-brief',
  'crm-recommend-package', 'crm-qualify-deal', 'crm-enrich-contact', 'crm-audit-workspace',
  'crm-export-snapshot', 'crm-draft-followup', 'intake-triage', 'lead-monitor',
  'rfp-pipeline-summary', 'proposal-outline', 'outcome-standup', 'org-benchmark',
  'crm-list-companies', 'crm-list-quotes', 'crm-list-automations', 'crm-analytics-summary',
  'crm-marketing-funnel', 'crm-calendar-status', 'crm-list-meetings',
];

const CRM_WRITE_SKILLS_LIST = [
  'crm-add-contact', 'crm-update-contact', 'crm-update-deal', 'crm-add-deal', 'crm-move-deal',
  'crm-mark-deal-outcome', 'crm-add-task', 'crm-schedule-followup', 'crm-apply-industry',
  'crm-add-ticket', 'crm-setup-wizard', 'crm-update-profile', 'crm-qualify-submission',
  'crm-draft-email', 'crm-enroll-sequence', 'crm-generate-quote', 'crm-dedupe-contacts',
  'crm-invite-teammate', 'crm-intake-to-pipeline', 'crm-save-at-risk-deal', 'intake-to-client',
  'crm-add-company', 'crm-link-company', 'crm-portal-link', 'crm-add-automation',
  'crm-add-sequence', 'crm-add-email-template', 'crm-import-contacts', 'crm-add-note',
  'crm-schedule-meeting', 'crm-sync-calendar',
];

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

const CRM_READ_SKILLS = CRM_READ_SKILLS_LIST.join(', ');
const CRM_WRITE_SKILLS = CRM_WRITE_SKILLS_LIST.join(', ');
const CRM_UI_HINT = 'Meridian CRM at /crm/ (Phone app + desktop); workspace in denizen_crm_workspaces.';

const SKILL_OWNERS = {
  'crm-qualify-submission': 'Lucy',
  'crm-intake-to-pipeline': 'Lucy',
  'crm-draft-email': 'Lucy',
  'crm-enroll-sequence': 'Lucy',
  'crm-invite-teammate': 'Lucy',
  'crm-schedule-followup': 'Lucy',
  'crm-add-contact': 'Lucy',
  'crm-update-contact': 'Lucy',
  'crm-get-intake-link': 'Lucy',
  'intake-triage': 'Lucy',
  'intake-to-client': 'Lucy',
  'crm-generate-quote': 'Sarah',
  'crm-recommend-package': 'Sarah',
  'crm-apply-industry': 'Sarah',
  'crm-qualify-deal': 'Sarah',
  'lead-monitor': 'Sarah',
  'proposal-outline': 'Sarah',
  'crm-add-deal': 'Marcus',
  'crm-update-deal': 'Marcus',
  'crm-move-deal': 'Marcus',
  'crm-mark-deal-outcome': 'Marcus',
  'crm-save-at-risk-deal': 'Marcus',
  'crm-enrich-contact': 'Bob',
  'crm-dedupe-contacts': 'Pier',
  'crm-audit-workspace': 'Pier',
  'crm-export-snapshot': 'Pier',
  'crm-pipeline-brief': 'Abby',
  'business-context-brief': 'Marcus',
  'crm-setup-wizard': 'Sarah',
  'crm-draft-followup': 'Roki',
  'outcome-standup': 'Abby',
  'rfp-pipeline-summary': 'Sarah',
  'crm-add-company': 'Marcus',
  'crm-link-company': 'Marcus',
  'crm-list-companies': 'Marcus',
  'crm-portal-link': 'Sarah',
  'crm-list-quotes': 'Sarah',
  'crm-add-sequence': 'Lucy',
  'crm-add-email-template': 'Lucy',
  'crm-add-note': 'Lucy',
  'crm-schedule-meeting': 'Lucy',
  'crm-list-meetings': 'Lucy',
  'crm-calendar-status': 'Dan',
  'crm-sync-calendar': 'Dan',
  'crm-add-automation': 'Dan',
  'crm-list-automations': 'Dan',
  'crm-import-contacts': 'Pier',
  'crm-analytics-summary': 'Abby',
  'crm-marketing-funnel': 'Sarah',
};

const NPC_ALLOWED_SKILLS = {
  lucy: new Set([
    ...CRM_READ_SKILLS_LIST,
    'crm-add-contact', 'crm-update-contact', 'crm-qualify-submission', 'crm-intake-to-pipeline',
    'crm-draft-email', 'crm-enroll-sequence', 'crm-invite-teammate', 'crm-schedule-followup',
    'crm-get-intake-link', 'crm-setup-wizard', 'crm-add-task', 'intake-triage', 'intake-to-client',
    'crm-add-sequence', 'crm-add-email-template', 'crm-add-note', 'crm-schedule-meeting',
  ]),
  sarah: new Set([
    ...CRM_READ_SKILLS_LIST,
    'crm-apply-industry', 'crm-setup-wizard', 'crm-generate-quote', 'crm-recommend-package',
    'crm-qualify-deal', 'crm-add-deal', 'lead-monitor', 'proposal-outline', 'rfp-pipeline-summary',
    'crm-portal-link', 'crm-marketing-funnel',
  ]),
  marcus: new Set([
    ...CRM_READ_SKILLS_LIST,
    'crm-add-deal', 'crm-update-deal', 'crm-move-deal', 'crm-mark-deal-outcome',
    'crm-save-at-risk-deal', 'crm-add-task', 'crm-schedule-followup',
    'crm-add-company', 'crm-link-company', 'crm-schedule-meeting',
  ]),
  bob: new Set([
    ...CRM_READ_SKILLS_LIST,
    'crm-enrich-contact', 'proposal-outline', 'research',
  ]),
  pier: new Set([
    ...CRM_READ_SKILLS_LIST,
    'crm-dedupe-contacts', 'crm-audit-workspace', 'crm-export-snapshot', 'crm-update-contact',
    'entity-link', 'crm-import-contacts',
  ]),
  abby: new Set([
    ...CRM_READ_SKILLS_LIST,
    'crm-pipeline-brief', 'crm-setup-wizard', 'outcome-standup', 'org-benchmark',
    'crm-apply-industry', 'crm-mark-deal-outcome', 'crm-analytics-summary',
  ]),
  dan: new Set([
    ...CRM_READ_SKILLS_LIST,
    'crm-setup-status', 'crm-update-profile', 'health-check',
    'crm-calendar-status', 'crm-sync-calendar', 'crm-list-meetings',
    'crm-add-automation', 'crm-list-automations',
  ]),
  roki: new Set([
    ...CRM_READ_SKILLS_LIST,
    'crm-draft-followup', 'crm-add-task', 'crm-list-pipeline', 'crm-list-tasks',
  ]),
  rob: new Set([
    ...CRM_READ_SKILLS_LIST,
    'crm-draft-email', 'crm-generate-quote',
  ]),
};

const byKey = Object.fromEntries(CRM_NPC_PERSONAS.map((p) => [p.key, p]));
const byName = Object.fromEntries(CRM_NPC_PERSONAS.map((p) => [p.name.toLowerCase(), p]));

function resolvePersona(npcKeyOrName) {
  const raw = String(npcKeyOrName || '').trim().toLowerCase();
  if (!raw) return null;
  return byKey[raw] || byName[raw] || null;
}

function skillOwner(skill) {
  return SKILL_OWNERS[skill] || 'Lucy';
}

function canNpcRunSkill(npcKeyOrName, skill, extraSkills = null) {
  const persona = resolvePersona(npcKeyOrName);
  const skillName = String(skill || '').trim().toLowerCase();
  if (skillName && Array.isArray(extraSkills) && extraSkills.map((s) => String(s).toLowerCase()).includes(skillName)) {
    return true;
  }
  if (!persona || !skill) return true;
  const allowed = NPC_ALLOWED_SKILLS[persona.key];
  if (!allowed) {
    if (!persona.canWrite && isWriteSkill(skill)) return false;
    return true;
  }
  return allowed.has(skill);
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
  const allowed = NPC_ALLOWED_SKILLS[persona.key];
  const skillHint = allowed
    ? `Your primary skills: ${[...allowed].filter((s) => s.startsWith('crm-')).slice(0, 8).join(', ')}.`
    : '';
  return [
    `You are ${persona.name}, ${persona.title} on this Denizen team.`,
    `CRM specialty: ${persona.expertise}.`,
    setupHint,
    skillHint,
    persona.canWrite
      ? 'You may run CRM writes in your specialty — defer other writes to the owning teammate.'
      : 'You read CRM data and advise — defer writes to the teammate who owns that action.',
    'Stay in character: short, practical, and distinct from a generic copilot.',
    'When setup is incomplete, tell the user the next onboarding step and which teammate owns it.',
  ].filter(Boolean).join(' ');
}

function buildPlayerChatCrmBlock(npcKeyOrName, setupSummary) {
  const persona = resolvePersona(npcKeyOrName);
  if (!persona || !setupSummary) return '';
  let crmSetup;
  let operator;
  try { crmSetup = require('./denizen-crm-setup'); } catch (_) { return ''; }
  try { operator = require('./denizen-crm-operator'); } catch (_) {}
  const guidance = crmSetup.buildNpcSetupGuidance(persona.name, setupSummary);
  const lines = [
    `## Meridian CRM (your team workspace)`,
    crmSetup.formatSetupSummaryText(setupSummary),
    operator?.getOperatorHint?.() || '',
    `You can run CRM skills via run_skill or answer from this snapshot.`,
    persona.canWrite
      ? 'You may execute CRM writes in your specialty.'
      : 'You are read-only for CRM writes — suggest the action and name who should run it.',
  ];
  if (guidance) lines.push(guidance);
  return lines.join('\n');
}

function isCrmRelatedMessage(message) {
  const msg = String(message || '');
  return /\b(crm|meridian|pipeline|deal|deals|contact|contacts|prospect|intake|follow.?up|onboarding|industry template|setup|notification|task reminder|at.?risk|won deal|closed won|add contact|update contact|update deal|move deal|log contact|packages|intake form|overdue|tasks?|ticket|support|campaign|marketing|quote|sequence|email draft|duplicate|audit|enroll|qualify|brief|rfp|proposal|triage|leads?|company|companies|calendar|meeting|portal|automation|analytics|import|template|funnel)\b/i.test(msg);
}

function isBusinessRelatedMessage(message) {
  const msg = String(message || '');
  return /\b(triage|leads?|rfp|proposal|standup|outcome|benchmark|hot lead|intake forms?)\b/i.test(msg)
    && !isCrmRelatedMessage(msg);
}

function inferBusinessAction(message) {
  const msg = String(message || '').trim();
  if (!msg) return null;
  if (/\b(triage|review)\b.*\b(intake|leads?)\b/i.test(msg) || /\bintake\b.*\btriage\b/i.test(msg)) {
    return { skill: 'intake-triage', params: { task: msg }, source: 'infer-business' };
  }
  if (/\b(hot|open|new)\b.*\bleads?\b/i.test(msg) || /\bleads?\b.*\b(monitor|today)\b/i.test(msg)) {
    return { skill: 'lead-monitor', params: { task: msg }, source: 'infer-business' };
  }
  if (/\b(proposal|outline)\b.*\b(rfp|bid|deal)\b/i.test(msg)) {
    return { skill: 'proposal-outline', params: { task: msg }, source: 'infer-business' };
  }
  if (/\b(rfp|bid)\b.*\b(pipeline|status|summary)\b/i.test(msg)) {
    return { skill: 'rfp-pipeline-summary', params: { task: msg }, source: 'infer-business' };
  }
  if (/\b(standup|outcome|shipped|team progress)\b/i.test(msg)) {
    return { skill: 'outcome-standup', params: { task: msg }, source: 'infer-business' };
  }
  try {
    const officeStatus = require('../compute/office-status-brief');
    if (officeStatus.isOfficeStatusQuery(msg)) {
      return { skill: 'outcome-standup', params: { task: msg, hours: 24 }, source: 'infer-office-status' };
    }
  } catch (_) {}
  if (/\b(convert|intake)\b.*\bclient\b/i.test(msg)) {
    return { skill: 'intake-to-client', params: { task: msg }, source: 'infer-business' };
  }
  return null;
}

function inferCrmAction(message) {
  const msg = String(message || '').trim();
  if (!msg) return null;
  const lower = msg.toLowerCase();
  const params = () => ({ ...parseCrmParams(msg), task: msg });

  if (!isCrmRelatedMessage(msg)) return null;

  if (/\b(omes|ev\d{6,}|teaming|business context)\b/i.test(msg)
    || (/\b(blocker|critical)\b/i.test(msg) && /\b(bid|solicitation|pipeline|crm)\b/i.test(msg))
    || (/\b(cross.?check|compare)\b/i.test(msg) && /\b(pipeline|crm)\b/i.test(msg) && /\b(bid|solicitation)\b/i.test(msg))) {
    return { skill: 'business-context-brief', params: params(), source: 'infer-crm-business' };
  }

  if (/\b(pipeline|crm)\b.*\bbrief\b/i.test(msg) || /\bbrief\b.*\b(pipeline|crm)\b/i.test(msg)) {
    return { skill: 'crm-pipeline-brief', params: params(), source: 'infer-crm' };
  }
  if (/\b(qualify|process)\b.*\b(intake|submission)\b/i.test(msg) || /\bintake\b.*\bqualify\b/i.test(msg)) {
    return { skill: 'crm-qualify-submission', params: params(), source: 'infer-crm' };
  }
  if (/\bintake\b.*\b(pipeline|crm|deal)\b/i.test(msg) || /\b(convert|push)\b.*\bintake\b/i.test(msg)) {
    return { skill: 'crm-intake-to-pipeline', params: params(), source: 'infer-crm' };
  }
  if (/\b(draft|write|compose)\b.*\b(email|message)\b/i.test(msg)) {
    return { skill: 'crm-draft-email', params: params(), source: 'infer-crm' };
  }
  if (/\b(draft|write)\b.*\bfollow.?up\b/i.test(msg) && !/\bemail\b/i.test(msg)) {
    return { skill: 'crm-draft-followup', params: params(), source: 'infer-crm' };
  }
  if (/\b(enroll|start)\b.*\b(sequence|welcome)\b/i.test(msg)) {
    return { skill: 'crm-enroll-sequence', params: params(), source: 'infer-crm' };
  }
  if (/\b(portal|client)\b.*\b(link|url)\b/i.test(msg) || /\b(generate|get|share)\b.*\bportal\b/i.test(msg)) {
    return { skill: 'crm-portal-link', params: params(), source: 'infer-crm' };
  }
  if (/\b(generate|create|build)\b.*\bquote\b/i.test(msg) && !/\bportal\b/i.test(msg)) {
    return { skill: 'crm-generate-quote', params: params(), source: 'infer-crm' };
  }
  if (/\b(which|recommend|fit)\b.*\bpackage\b/i.test(msg) || /\bpackage\b.*\bbudget\b/i.test(msg)) {
    return { skill: 'crm-recommend-package', params: params(), source: 'infer-crm' };
  }
  if (/\b(qualify|score|assess)\b.*\bdeal\b/i.test(msg)) {
    return { skill: 'crm-qualify-deal', params: params(), source: 'infer-crm' };
  }
  if (/\b(save|rescue|fix)\b.*\b(at.?risk|risky|stalled)\b/i.test(msg)) {
    return { skill: 'crm-save-at-risk-deal', params: params(), source: 'infer-crm' };
  }
  if (/\b(research|enrich|brief)\b.*\b(contact|prospect|company|account)\b/i.test(msg)) {
    return { skill: 'crm-enrich-contact', params: params(), source: 'infer-crm' };
  }
  if (/\b(duplicate|dedupe|merge)\b.*\bcontact/i.test(msg)) {
    return { skill: 'crm-dedupe-contacts', params: params(), source: 'infer-crm' };
  }
  if (/\b(audit|health check)\b.*\b(crm|workspace|data)\b/i.test(msg)) {
    return { skill: 'crm-audit-workspace', params: params(), source: 'infer-crm' };
  }
  if (/\b(export|snapshot|dump)\b.*\b(crm|contacts|pipeline)\b/i.test(msg)) {
    return { skill: 'crm-export-snapshot', params: params(), source: 'infer-crm' };
  }
  if (/\b(schedule|set)\b.*\bfollow.?up\b/i.test(msg)) {
    return { skill: 'crm-schedule-followup', params: params(), source: 'infer-crm' };
  }
  if (/\b(invite)\b.*\b(team|teammate|email)\b/i.test(msg) && !/\bcrm setup\b/i.test(msg)) {
    return { skill: 'crm-invite-teammate', params: params(), source: 'infer-crm' };
  }
  if (/\b(update|edit|change)\b.*\bcontact\b/i.test(msg)) {
    return { skill: 'crm-update-contact', params: params(), source: 'infer-crm' };
  }
  if (/\b(mark|close)\b.*\bdeal\b.*\b(won|lost)\b/i.test(msg) || /\bdeal\b.*\b(won|lost)\b/i.test(msg)) {
    return { skill: 'crm-mark-deal-outcome', params: params(), source: 'infer-crm' };
  }
  if (/\b(move)\b.*\bdeal\b.*\b(stage|to)\b/i.test(msg)) {
    return { skill: 'crm-move-deal', params: params(), source: 'infer-crm' };
  }

  if (/\b(add|create|new)\b.*\bcompan(y|ies)\b/i.test(msg)) {
    return { skill: 'crm-add-company', params: params(), source: 'infer-crm' };
  }
  if (/\b(list|show)\b.*\bcompan(y|ies)\b/i.test(msg)) {
    return { skill: 'crm-list-companies', params: params(), source: 'infer-crm' };
  }
  if (/\b(link|attach)\b.*\b(contact|company)\b/i.test(msg)) {
    return { skill: 'crm-link-company', params: params(), source: 'infer-crm' };
  }
  if (/\b(list|show)\b.*\bquotes?\b/i.test(msg)) {
    return { skill: 'crm-list-quotes', params: params(), source: 'infer-crm' };
  }
  if (/\bsync\b.*\bcalendar\b/i.test(msg) || /\bcalendar\b.*\bsync\b/i.test(msg)) {
    const provider = /\boutlook|microsoft\b/i.test(msg) ? 'microsoft' : 'google';
    return { skill: 'crm-sync-calendar', params: { ...params(), provider }, source: 'infer-crm' };
  }
  if (/\b(connect|calendar)\b.*\b(google|outlook|microsoft|status)\b/i.test(msg)
    || /\bcalendar\b.*\b(connect|status|linked)\b/i.test(msg)) {
    return { skill: 'crm-calendar-status', params: params(), source: 'infer-crm' };
  }
  if (/\b(schedule|book|set up)\b.*\bmeeting\b/i.test(msg)) {
    return { skill: 'crm-schedule-meeting', params: params(), source: 'infer-crm' };
  }
  if (/\b(list|show|upcoming)\b.*\bmeetings?\b/i.test(msg)) {
    return { skill: 'crm-list-meetings', params: params(), source: 'infer-crm' };
  }
  if (/\b(list|show)\b.*\bautomation/i.test(msg)) {
    return { skill: 'crm-list-automations', params: params(), source: 'infer-crm' };
  }
  if (/\b(add|create|new)\b.*\bautomation\b/i.test(msg)) {
    return { skill: 'crm-add-automation', params: params(), source: 'infer-crm' };
  }
  if (/\b(analytics|metrics|win rate|conversion)\b/i.test(msg)) {
    return { skill: 'crm-analytics-summary', params: params(), source: 'infer-crm' };
  }
  if (/\b(marketing|funnel|lead source)\b/i.test(msg)) {
    return { skill: 'crm-marketing-funnel', params: params(), source: 'infer-crm' };
  }
  if (/\b(add|create|new)\b.*\bsequence\b/i.test(msg)) {
    return { skill: 'crm-add-sequence', params: params(), source: 'infer-crm' };
  }
  if (/\b(add|create|new)\b.*\b(email )?template\b/i.test(msg)) {
    return { skill: 'crm-add-email-template', params: params(), source: 'infer-crm' };
  }
  if (/\b(import)\b.*\bcontact/i.test(msg) || /\bcsv\b.*\bimport/i.test(msg)) {
    return { skill: 'crm-import-contacts', params: params(), source: 'infer-crm' };
  }
  if (/\b(add|log|create)\b.*\bnote\b/i.test(msg)) {
    return { skill: 'crm-add-note', params: params(), source: 'infer-crm' };
  }

  if (/\b(list|show|what)\b.*\b(industr|vertical|template)/i.test(msg)) {
    return { skill: 'crm-list-industries', params: params(), source: 'infer-crm' };
  }

  if (/\b(apply|set|use|switch|configure)\b.*\b(industry|vertical|template)\b/i.test(msg)
    || /\b(industry|vertical)\b.*\b(saas|govcon|real estate|healthcare|legal|agency|consulting|sales)\b/i.test(msg)) {
    const industryBridge = require('./denizen-crm-industry-bridge');
    const words = msg.replace(/[^a-z0-9\s-]/gi, ' ').split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += 1) {
      const id = industryBridge.resolveIndustryId(words.slice(i, i + 3).join(' '))
        || industryBridge.resolveIndustryId(words[i]);
      if (id) return { skill: 'crm-apply-industry', params: { ...params(), templateId: id }, source: 'infer-crm' };
    }
    return { skill: 'crm-list-industries', params: params(), source: 'infer-crm' };
  }

  if (/\b(continue|next step|keep going|resume)\b.*\b(crm|setup|onboarding)\b/i.test(msg)
    || /\b(crm|setup)\b.*\b(continue|next step|keep going|resume)\b/i.test(msg)) {
    return { skill: 'crm-setup-wizard', params: { mode: 'continue', ...params() }, source: 'infer-crm' };
  }

  if (/\b(set up everything|full setup|complete setup|setup wizard|run setup|bootstrap|configure everything)\b/i.test(msg)
    || /\b(set up|configure)\b.*\b(crm|meridian)\b.*\b(all|complete|full|everything|team)\b/i.test(msg)) {
    return { skill: 'crm-setup-wizard', params: { mode: 'interactive', ...params() }, source: 'infer-crm' };
  }

  if (/\b(setup|onboarding|getting started|configure crm|stand up|set up)\b.*\b(crm|meridian)\b/i.test(msg)
    || /\b(crm|meridian)\b.*\b(setup|onboarding|getting started)\b/i.test(msg)) {
    return { skill: 'crm-setup-status', params: params(), source: 'infer-crm' };
  }

  if (/\b(add|create|open|log|new)\b.*\b(ticket|support case|support request)\b/i.test(msg)
    || /\b(ticket|support)\b.*\b(add|create|open|log)\b/i.test(msg)) {
    return { skill: 'crm-add-ticket', params: params(), source: 'infer-crm' };
  }

  if (/\b(list|show|open|my)\b.*\b(tickets?|support cases?)\b/i.test(msg)
    || /\b(tickets?|support queue)\b.*\b(open|overdue|sla)\b/i.test(msg)) {
    const overdue = /\boverdue|sla\b/i.test(msg);
    return { skill: 'crm-list-tickets', params: { ...params(), overdue: overdue ? 1 : 0 }, source: 'infer-crm' };
  }

  if (/\b(add|create|schedule|remind)\b.*\b(task|follow.?up|reminder)\b/i.test(msg)) {
    return { skill: 'crm-add-task', params: params(), source: 'infer-crm' };
  }

  if (/\b(overdue|open|pending|my)\b.*\b(tasks?|to.?dos?)\b/i.test(msg)
    || /\b(tasks?|to.?dos?)\b.*\b(due|overdue|today)\b/i.test(msg)) {
    const overdue = /\boverdue\b/i.test(msg);
    return { skill: 'crm-list-tasks', params: { ...params(), overdue: overdue ? 1 : 0 }, source: 'infer-crm' };
  }

  if (/\b(at.?risk|risky|stalled|stuck)\b.*\b(deal|pipeline|account)/i.test(msg)) {
    return { skill: 'crm-at-risk', params: params(), source: 'infer-crm' };
  }

  if (/\b(intake|public form)\b.*\b(link|url|share)\b/i.test(msg)
    || /\b(share|get|show)\b.*\bintake\b/i.test(msg)) {
    return { skill: 'crm-get-intake-link', params: params(), source: 'infer-crm' };
  }

  if (/\b(?:enter|add|put|log|save|create|type|insert)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:into|to|in)\s+(?:the\s+)?(?:crm|meridian|contacts?)\b/i.test(msg)
    || /\b(enter|add|put|log|save|create|type|insert)\b.*\b(name|contact|person|lead)\b.*\b(crm|meridian|contacts?)\b/i.test(msg)
    || /\b(crm|meridian|contacts?)\b.*\b(enter|add|put|log|save|create|type|insert)\b.*\b(name|contact|person|lead)\b/i.test(msg)
    || /\b(add|create|log|new)\b.*\bcontact\b/i.test(msg)
    || /\bcontact\b.*\b(add|create|log)\b/i.test(msg)) {
    return { skill: 'crm-add-contact', params: params(), source: 'infer-crm' };
  }
  if (/\b(add|create|new|open)\b.*\bdeal\b/i.test(msg) && !/\b(update|move|mark|close|won|lost)\b/i.test(msg)) {
    return { skill: 'crm-add-deal', params: params(), source: 'infer-crm' };
  }
  if (/\b(update|move|mark|close|won|lost)\b.*\bdeal\b/i.test(msg) || /\bdeal\b.*\b(stage|pipeline|won|lost|move)\b/i.test(msg)) {
    return { skill: 'crm-update-deal', params: params(), source: 'infer-crm' };
  }
  if (/\b(list|show|open|what).*\b(deal|pipeline|deals)\b/i.test(msg) || /\bpipeline\b/i.test(lower)) {
    return { skill: 'crm-list-pipeline', params: params(), source: 'infer-crm' };
  }
  if (/\b(crm|meridian|summary|summarize|how many|count|status|notification)\b/i.test(lower)) {
    return { skill: 'crm-setup-status', params: params(), source: 'infer-crm' };
  }
  return { skill: 'crm-summary', params: params(), source: 'infer-crm' };
}

function parseCrmParams(message) {
  const msg = String(message || '');
  const out = { task: msg };
  const emailM = msg.match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (emailM) out.email = emailM[0];

  const nameM = msg.match(/\b(?:contact|for|named?|add|invite)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (nameM) out.name = nameM[1].trim();

  const enterIntoCrm = msg.match(/\b(?:enter|add|put|log|save|type|insert)\s+(?:a\s+)?(?:name\s+)?(?:for\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:into|to|in)\s+(?:the\s+)?(?:crm|meridian|contacts?)\b/i);
  if (enterIntoCrm) out.name = enterIntoCrm[1].trim();

  const nameIntoCrm = msg.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:into|to|in)\s+(?:the\s+)?(?:crm|meridian|contacts?)\b/i);
  if (nameIntoCrm && !out.name) out.name = nameIntoCrm[1].trim();

  const companyM = msg.match(/\b(?:at|from|company|submission)\s+([A-Z][A-Za-z0-9&.\s-]{2,40})/);
  if (companyM) out.company = companyM[1].trim();

  const stageM = msg.match(/\b(?:stage|move to|mark as)\s+["']?([^"',\n]+?)["']?(?:\s|$|\.)/i);
  if (stageM) out.stage = stageM[1].trim();

  const dealM = msg.match(/\bdeal\s+["']?([^"'\n]+?)["']?(?:\s+to|\s*$)/i);
  if (dealM) out.title = dealM[1].trim();

  const taskM = msg.match(/\b(?:task|follow.?up|remind(?:er)?)\s+(?:to\s+)?["']?([^"'\n.]+?)["']?(?:\s+due|\s*$|\.)/i);
  if (taskM) out.title = taskM[1].trim();

  const dueM = msg.match(/\bdue\s+(\d{4}-\d{2}-\d{2}|\w+\s+\d{1,2})/i);
  if (dueM) out.due = dueM[1];

  if (/\bwindows\b/i.test(msg)) out.platform = 'windows';
  if (/\bmac|macos\b/i.test(msg)) out.platform = 'macos';
  if (/\blinux\b/i.test(msg)) out.platform = 'linux';

  return out;
}

const CRM_WRITE_ACTIONS = new Set(CRM_WRITE_SKILLS_LIST);

function isWriteSkill(skill) {
  return CRM_WRITE_ACTIONS.has(skill);
}

function deferSkillPlan(message, skill, owner) {
  return {
    skill: 'crm-setup-status',
    params: {
      task: message,
      deferTo: owner || skillOwner(skill),
      deferredSkill: skill,
    },
    source: 'infer-crm-defer',
  };
}

function isCrmDataEntryIntent(message) {
  const msg = String(message || '');
  if (!isCrmRelatedMessage(msg)) return false;
  if (/\b(?:enter|add|put|log|save|create|type|insert)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:into|to|in)\s+(?:the\s+)?(?:crm|meridian|contacts?)\b/i.test(msg)) {
    return true;
  }
  return /\b(enter|add|put|log|save|create|type|insert|update)\b/i.test(msg)
    && /\b(name|contact|person|lead|email|deal|crm|meridian|contacts?)\b/i.test(msg);
}

function inferCrmWriteAction(message) {
  const plan = inferCrmAction(message);
  if (plan && isWriteSkill(plan.skill)) return plan;
  return null;
}

module.exports = {
  CRM_NPC_PERSONAS,
  CRM_READ_SKILLS,
  CRM_WRITE_SKILLS,
  CRM_READ_SKILLS_LIST,
  CRM_WRITE_SKILLS_LIST,
  CRM_UI_HINT,
  CRM_WRITE_ACTIONS,
  NPC_ALLOWED_SKILLS,
  SKILL_OWNERS,
  resolvePersona,
  skillOwner,
  canNpcRunSkill,
  deferSkillPlan,
  crmSkillSuffix,
  buildAssistPersonaBlock,
  buildPlayerChatCrmBlock,
  isCrmRelatedMessage,
  isBusinessRelatedMessage,
  inferBusinessAction,
  inferCrmAction,
  inferCrmWriteAction,
  isCrmDataEntryIntent,
  parseCrmParams,
  isWriteSkill,
};
