'use strict';

/**
 * Meridian CRM working-set filters (server twin of crm/vendor working-set).
 * Open pipeline = live pursuits only. Watchlist / expired / seed stay out of $.
 */

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

const CLOSED_STATUSES = new Set([
  'lost', 'disqualified', 'won', 'closed', 'void',
]);

const NON_PIPELINE_STATUSES = new Set([
  'watchlist', 'expired', 'parked', 'archived',
]);

function isWatchlistDeal(d) {
  const status = norm(d?.status);
  const stage = norm(d?.stage);
  const tags = (d?.tags || []).map(norm);
  if (status === 'watchlist' || status === 'parked') return true;
  if (tags.includes('watchlist') || tags.includes('not-pipeline') || tags.includes('federal-rfp')) return true;
  if (stage.includes('watch') || stage.includes('research')) return true;
  return false;
}

function isClosedDeal(d) {
  const status = norm(d?.status);
  const stage = norm(d?.stage);
  if (CLOSED_STATUSES.has(status)) return true;
  if (stage === 'closed won' || stage === 'closed lost') return true;
  if (stage.includes('lost') || stage.includes('disqual')) return true;
  return false;
}

function isExpiredDeal(d) {
  const status = norm(d?.status);
  const stage = norm(d?.stage);
  if (status === 'expired') return true;
  if (stage.includes('expired')) return true;
  return false;
}

function isOpenPipelineDeal(d) {
  if (!d) return false;
  if (isClosedDeal(d)) return false;
  if (isWatchlistDeal(d)) return false;
  if (isExpiredDeal(d)) return false;
  if (NON_PIPELINE_STATUSES.has(norm(d.status))) return false;
  return true;
}

function isOpenTask(t) {
  if (!t || t.done) return false;
  const st = norm(t.status);
  return !['done', 'closed', 'completed'].includes(st);
}

function isOverdueTask(t, today = new Date().toISOString().slice(0, 10)) {
  if (!isOpenTask(t)) return false;
  const due = String(t.due || '').slice(0, 10);
  return Boolean(due && due < today);
}

function isAtRiskWorkingDeal(d, today = new Date().toISOString().slice(0, 10)) {
  if (!isOpenPipelineDeal(d)) return false;
  if (norm(d.health) === 'at-risk') return true;
  const next = String(d.closeDate || '').slice(0, 10);
  return Boolean(next && next < today);
}

function activeCompanies(companies) {
  return (companies || []).filter((c) => {
    const st = norm(c?.status);
    return !['archived', 'void', 'deleted'].includes(st);
  });
}

const PHILOSOPHY = [
  'One object = one job: company, contact, deal, task, note.',
  'Open pipeline only if who / what / next step / by when are clear.',
  'Watchlist RFPs are research — not open deals and not pipeline $.',
  'Unknown dollar amount stays $0. Never invent values.',
  'One open verb-task per live deal. Close or kill stale hygiene chores.',
  'Empty workspace is valid — seed data is worse than empty.',
].join(' ');

const LOCAL_CHECKLIST = [
  '1. READ crm_working_set or crm_pipeline_brief (do not guess counts)',
  '2. If empty → help user add real company/contact/deal — do not invent seed',
  '3. Keep / park / kill before enriching anything',
  '4. One mutation max; prefer run_skill wait=false + get_skill_job on slow LM',
  '5. Writes: crm-capture / crm-add-* / crm-mark-deal-outcome only with explicit facts',
];

function buildWorkingSet(input = {}) {
  const today = input.today || new Date().toISOString().slice(0, 10);
  const deals = Array.isArray(input.deals) ? input.deals : [];
  const contacts = Array.isArray(input.contacts) ? input.contacts : [];
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const companies = activeCompanies(input.companies || []);

  const pipelineDeals = deals.filter(isOpenPipelineDeal);
  const watchlistDeals = deals.filter(isWatchlistDeal);
  const expiredDeals = deals.filter(isExpiredDeal);
  const openTasks = tasks.filter(isOpenTask);
  const overdueTasks = openTasks.filter((t) => isOverdueTask(t, today));
  const atRiskDeals = pipelineDeals.filter((d) => isAtRiskWorkingDeal(d, today));
  const pipelineValue = pipelineDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const empty = pipelineDeals.length === 0
    && contacts.length === 0
    && openTasks.length === 0
    && companies.length === 0;

  return {
    philosophy: PHILOSOPHY,
    checklist: LOCAL_CHECKLIST,
    empty,
    counts: {
      contacts: contacts.length,
      companies: companies.length,
      open_pipeline: pipelineDeals.length,
      open_pipeline_value: pipelineValue,
      watchlist: watchlistDeals.length,
      expired: expiredDeals.length,
      open_tasks: openTasks.length,
      overdue_tasks: overdueTasks.length,
      at_risk: atRiskDeals.length,
    },
    pipelineDeals: pipelineDeals.map(summarizeDeal),
    watchlistDeals: watchlistDeals.slice(0, 15).map(summarizeDeal),
    expiredDeals: expiredDeals.slice(0, 5).map(summarizeDeal),
    openTasks: openTasks.slice(0, 15).map(summarizeTask),
    overdueTasks: overdueTasks.slice(0, 10).map(summarizeTask),
    atRiskDeals: atRiskDeals.map(summarizeDeal),
    contacts: contacts.slice(0, 20).map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      company: c.company,
      status: c.status,
    })),
    companies: companies.slice(0, 15).map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
    })),
    next_steps: empty
      ? [
        'Workspace is empty — good. Add real companies/contacts first.',
        'Then one deal per pursuit with stage + $0 if unknown.',
        'Then one verb task per open deal with a due date this week.',
      ]
      : [
        overdueTasks.length ? `Clear ${overdueTasks.length} overdue task(s) or close the deal.` : null,
        atRiskDeals.length ? `At-risk: next date missed on ${atRiskDeals.length} live deal(s).` : null,
        pipelineDeals.some((d) => !d.contact) ? 'Link contacts on orphan deals or delete them.' : null,
        'Do not promote watchlist RFPs until go/no-go.',
      ].filter(Boolean),
  };
}

function summarizeDeal(d) {
  return {
    id: d.id,
    title: d.title,
    stage: d.stage,
    status: d.status,
    value: Number(d.value) || 0,
    contact: d.contact || '',
    company: d.company || '',
    health: d.health,
    closeDate: d.closeDate || '',
    tags: d.tags || [],
    studio_task_ids: Array.isArray(d.studioTaskIds) ? d.studioTaskIds.map(String)
      : (Array.isArray(d.studio_task_ids) ? d.studio_task_ids.map(String) : []),
  };
}

function summarizeTask(t) {
  return {
    id: t.id,
    title: t.title,
    due: t.due,
    contact: t.contact || '',
    dealId: t.dealId ?? t.deal_id ?? null,
    priority: t.priority,
  };
}

function playbookResource() {
  return {
    name: 'Meridian CRM agent playbook',
    philosophy: PHILOSOPHY,
    checklist: LOCAL_CHECKLIST,
    objects: {
      company: 'Account — not dolonia as a customer of itself',
      contact: 'Person with email + role; never duplicate the same human',
      deal: 'One pursuit with stage, owner, next date; $0 if unknown',
      task: 'One next action on one deal; due in the future',
      note: 'What happened — not instructions to the AI',
    },
    keep_park_kill: {
      keep: 'Live partners/clients with a named human and next step',
      park: 'Federal scrape / research watchlist — not open pipeline',
      kill: 'NPC seed, hygiene chores, orphan deals with no human',
    },
    mcp: {
      read_first: ['crm_working_set', 'crm_pipeline_brief', 'crm_list_tasks', 'crm://working-set'],
      mutate_via: ['run_skill crm-capture', 'run_skill crm-add-contact', 'run_skill crm-add-deal', 'run_skill crm-mark-deal-outcome'],
      slow_local: 'Use run_skill with wait=false then get_skill_job; one mutation per turn',
      cloud: 'Team token: crm_* tools + crm://working-set resource; do not invent pipeline $',
    },
  };
}

module.exports = {
  PHILOSOPHY,
  LOCAL_CHECKLIST,
  isWatchlistDeal,
  isClosedDeal,
  isExpiredDeal,
  isOpenPipelineDeal,
  isOpenTask,
  isOverdueTask,
  isAtRiskWorkingDeal,
  activeCompanies,
  buildWorkingSet,
  playbookResource,
};
