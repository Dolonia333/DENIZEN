'use strict';

/**
 * Compact Meridian CRM operator reference for NPC prompts and chat context.
 * Full UI docs: denizen/crm/USER_GUIDE.md
 */

const CRM_TABS = [
  { id: 'dashboard', label: 'Dashboard', hint: 'KPIs, follow-ups, at-risk, goals' },
  { id: 'contacts', label: 'Contacts', hint: 'People, groups, import/export' },
  { id: 'sales', label: 'Sales', sub: ['leads', 'pipeline', 'hub', 'quotas'], hint: 'Pipeline kanban, lead scores, rep performance' },
  { id: 'schedule', label: 'Schedule', sub: ['tasks', 'calendar', 'interactions'], hint: 'Tasks, meetings, Google/Outlook sync' },
  { id: 'companies', label: 'Companies', hint: 'B2B accounts, ARR/MRR, linked contacts' },
  { id: 'support', label: 'Support', hint: 'Support tickets' },
  { id: 'marketing', label: 'Marketing', hint: 'Campaigns, funnel, lead sources' },
  { id: 'notes', label: 'Notes', hint: 'Team boards + interaction log' },
  { id: 'sequences', label: 'Sequences', hint: 'Multi-step email/task cadences' },
  { id: 'packages', label: 'Packages', hint: 'Productized offers for quotes' },
  { id: 'intake', label: 'Proposals & Intake', hint: 'Quotes, public intake form, submissions' },
  { id: 'email-templates', label: 'Email Templates', hint: 'Merge-field templates + compose' },
  { id: 'automations', label: 'Automations', hint: 'If-this-then-that server rules' },
  { id: 'analytics', label: 'Analytics', hint: 'Funnel, win rate, revenue trends' },
  { id: 'ai-prospector', label: 'AI Prospector', hint: 'Research prospects → import contacts' },
  { id: 'ai', label: 'AI Assistant', hint: 'In-CRM copilot threads' },
  { id: 'portal', label: 'Portal', hint: 'Client quote view, sign, Stripe pay' },
  { id: 'data-tools', label: 'Data Management', hint: 'CSV import/export, dedupe, audit, GDPR' },
  { id: 'onboarding', label: 'Setup', hint: '8-step team onboarding wizard' },
  { id: 'settings', label: 'Settings', hint: 'Profile, notifications, integrations, webhooks' },
];

const SKILL_GROUPS = {
  setup: ['crm-setup-wizard', 'crm-setup-status', 'crm-apply-industry', 'crm-update-profile', 'crm-get-intake-link', 'crm-invite-teammate'],
  intake: ['crm-qualify-submission', 'crm-intake-to-pipeline', 'crm-generate-quote', 'crm-portal-link', 'crm-list-quotes'],
  pipeline: ['crm-list-pipeline', 'crm-add-deal', 'crm-update-deal', 'crm-move-deal', 'crm-mark-deal-outcome', 'crm-save-at-risk-deal', 'crm-qualify-deal', 'crm-at-risk', 'crm-pipeline-brief'],
  contacts: ['crm-add-contact', 'crm-update-contact', 'crm-enrich-contact', 'crm-dedupe-contacts', 'crm-import-contacts', 'crm-add-company', 'crm-link-company', 'crm-list-companies'],
  comms: ['crm-draft-email', 'crm-draft-followup', 'crm-enroll-sequence', 'crm-add-sequence', 'crm-add-email-template', 'crm-schedule-followup', 'crm-add-note'],
  calendar: ['crm-calendar-status', 'crm-sync-calendar', 'crm-schedule-meeting', 'crm-list-meetings'],
  ops: ['crm-add-task', 'crm-list-tasks', 'crm-add-ticket', 'crm-list-tickets', 'crm-add-automation', 'crm-list-automations'],
  intel: ['crm-analytics-summary', 'crm-marketing-funnel', 'crm-audit-workspace', 'crm-export-snapshot', 'crm-recommend-package', 'crm-summary'],
};

const ALL_CRM_SKILLS = [...new Set(Object.values(SKILL_GROUPS).flat())];

function formatRunSkillLine() {
  return `denizen-data CRM skills: ${ALL_CRM_SKILLS.join(', ')}. Use [RUN_SKILL:skill-name:{"param":"value"}] or natural language — server infers the skill. Open CRM at /crm/ (Phone app). Wrong NPC → defer to skill owner.`;
}

function formatTabGuide(maxTabs = 8) {
  return CRM_TABS.slice(0, maxTabs).map((t) => `${t.label} (${t.id}): ${t.hint}`).join('; ');
}

function formatOperatorBlock(npcName) {
  const groups = Object.entries(SKILL_GROUPS)
    .map(([k, skills]) => `${k}: ${skills.slice(0, 6).join(', ')}`)
    .join('\n');
  return [
    '## Meridian CRM operator map',
    formatRunSkillLine(),
    `Tabs: ${formatTabGuide(10)}…`,
    'Skill groups:',
    groups,
    npcName ? `You are ${npcName} — run only skills in your allowlist; defer others with Ask {owner} chip.` : '',
  ].filter(Boolean).join('\n');
}

function getOperatorHint(maxLen = 600) {
  const line = formatRunSkillLine();
  return line.length > maxLen ? `${line.slice(0, maxLen - 3)}…` : line;
}

module.exports = {
  CRM_TABS,
  SKILL_GROUPS,
  ALL_CRM_SKILLS,
  formatRunSkillLine,
  formatTabGuide,
  formatOperatorBlock,
  getOperatorHint,
};
