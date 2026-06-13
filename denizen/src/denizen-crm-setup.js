'use strict';

const industryBridge = require('./denizen-crm-industry-bridge');

/** Onboarding steps — each has a primary NPC owner for office chat guidance. */
const ONBOARDING_STEPS = [
  { id: 'profile', label: 'Set up your profile', owner: 'Dan', tab: 'settings' },
  { id: 'invite', label: 'Invite team members', owner: 'Lucy', tab: 'onboarding' },
  { id: 'packages', label: 'Build your packages', owner: 'Sarah', tab: 'packages' },
  { id: 'intake', label: 'Share public intake form', owner: 'Lucy', tab: 'intake' },
  { id: 'contact', label: 'Add your first contact', owner: 'Lucy', tab: 'contacts' },
  { id: 'deal', label: 'Create your first deal', owner: 'Marcus', tab: 'sales' },
  { id: 'industry', label: 'Pick your industry template', owner: 'Sarah', tab: 'settings' },
  { id: 'ai', label: 'Try the Meridian AI assistant', owner: 'Abby', tab: 'ai' },
];

const NOTIFICATION_NPC = {
  'task-overdue': 'Marcus',
  'deal-won': 'Lucy',
  'pipeline-brief': 'Lucy',
  'at-risk': 'Marcus',
  'setup-reminder': 'Sarah',
  'ticket-overdue': 'Jenny',
  'team-inactive': 'Lucy',
};

function computeOnboardingProgress(state = {}, ctx = {}) {
  const onboarding = state.onboarding && typeof state.onboarding === 'object' ? state.onboarding : {};
  const industry = state.industryConfig && typeof state.industryConfig === 'object' ? state.industryConfig : {};
  const contacts = Array.isArray(state.contacts) ? state.contacts : [];
  const deals = Array.isArray(state.deals) ? state.deals : [];
  const packages = Array.isArray(state.packages) ? state.packages : [];
  const submissions = Array.isArray(state.submissions) ? state.submissions : [];
  const profile = ctx.profile || state.userPrefs?.profile || {};

  const done = {
    profile: !!(profile.name && profile.name !== 'Guest'),
    invite: Number(ctx.teamCount || 0) > 1,
    packages: packages.length > 0,
    intake: submissions.length > 0,
    contact: contacts.length > 0,
    deal: deals.length > 0,
    industry: !!(industry.id && industry.id !== 'custom'),
    ai: !!onboarding.triedAi,
  };

  const steps = ONBOARDING_STEPS.map((s) => ({
    ...s,
    done: !!done[s.id],
  }));
  const completed = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done) || null;

  return {
    steps,
    completed,
    total: steps.length,
    percent: Math.round((completed / steps.length) * 100),
    next,
    done,
  };
}

function buildSetupSummary(state = {}, ctx = {}) {
  let summarizeWorkspace;
  try { ({ summarizeWorkspace } = require('./denizen-crm-assist')); } catch (_) {
    summarizeWorkspace = () => ({});
  }
  const summary = summarizeWorkspace(state);
  const progress = computeOnboardingProgress(state, ctx);
  const industry = state.industryConfig || {};
  const prefs = state.userPrefs?.notifications || {};

  return {
    ...summary,
    industry: industry.id ? { id: industry.id, name: industry.name, icon: industry.icon } : null,
    onboarding: progress,
    notifications: {
      email: prefs.email !== false,
      inApp: prefs.inApp !== false,
      dealAlerts: prefs.dealAlerts !== false,
      taskReminders: prefs.taskReminders !== false,
      weeklyDigest: prefs.weeklyDigest !== false,
    },
    crmUrl: '/crm/',
  };
}

function formatSetupSummaryText(setup) {
  const lines = [];
  lines.push(`Meridian CRM: ${setup.contactCount} contacts, ${setup.openDealCount} open deals, ${setup.pendingTaskCount} open tasks (${setup.overdueTaskCount} overdue).`);
  if (setup.industry) lines.push(`Industry: ${setup.industry.icon || ''} ${setup.industry.name} (${setup.industry.id}).`);
  else lines.push('Industry template not set — ask Sarah or Lucy to help pick one.');
  lines.push(`Setup: ${setup.onboarding.completed}/${setup.onboarding.total} (${setup.onboarding.percent}%).`);
  if (setup.onboarding.next) {
    lines.push(`Next step: ${setup.onboarding.next.label} — ${setup.onboarding.next.owner} can help (/crm/ → ${setup.onboarding.next.tab}).`);
  }
  if (setup.atRiskCount) lines.push(`${setup.atRiskCount} at-risk deal(s) — Marcus tracks delivery health.`);
  return lines.join(' ');
}

function buildNpcSetupGuidance(npcName, setup) {
  const personaSteps = setup.onboarding.steps.filter((s) => s.owner === npcName && !s.done);
  if (!personaSteps.length) return '';
  const lines = personaSteps.map((s) => `- ${s.label} (open /crm/ → ${s.tab})`);
  return `Your CRM setup tasks for this team:\n${lines.join('\n')}`;
}

function notificationNpcForKind(kind) {
  return NOTIFICATION_NPC[kind] || 'Lucy';
}

function shouldNotify(state, kind) {
  const prefs = state?.userPrefs?.notifications || {};
  if (kind === 'task-overdue') return prefs.taskReminders !== false;
  if (kind === 'deal-won') return prefs.dealAlerts !== false;
  if (kind === 'pipeline-brief') return prefs.inApp !== false;
  if (kind === 'at-risk') return prefs.dealAlerts !== false;
  if (kind === 'setup-reminder') return prefs.inApp !== false;
  if (kind === 'ticket-overdue') return prefs.taskReminders !== false;
  if (kind === 'team-inactive') return prefs.inApp !== false;
  return prefs.inApp !== false;
}

function parseFieldsFromTask(taskText, fields = []) {
  const text = String(taskText || '');
  const out = {};
  for (const field of fields) {
    const re = new RegExp(`${field}[:\\s]+([^,\\n]+)`, 'i');
    const m = text.match(re);
    if (m) out[field] = m[1].trim();
  }
  const emailM = text.match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (emailM && !out.email) out.email = emailM[0];
  return out;
}

module.exports = {
  ONBOARDING_STEPS,
  NOTIFICATION_NPC,
  computeOnboardingProgress,
  buildSetupSummary,
  formatSetupSummaryText,
  buildNpcSetupGuidance,
  notificationNpcForKind,
  shouldNotify,
  parseFieldsFromTask,
  formatIndustryList: industryBridge.formatIndustryList,
  listIndustries: industryBridge.listIndustries,
  resolveIndustryId: industryBridge.resolveIndustryId,
  getIndustryTemplate: industryBridge.getIndustryTemplate,
};
