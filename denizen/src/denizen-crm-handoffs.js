'use strict';

const crmMutations = require('./denizen-crm-mutations');

function nextId(list) {
  const ids = (list || []).map((r) => Number(r?.id) || 0);
  return ids.length ? Math.max(...ids) + 1 : Date.now();
}

/**
 * When intake submission is qualified, ensure contact + deal exist in workspace state.
 */
function intakeQualifiedHandoff(state, submission) {
  if (!submission) return { state, changed: false };
  const out = JSON.parse(JSON.stringify(state || {}));
  const contacts = Array.isArray(out.contacts) ? [...out.contacts] : [];
  const deals = Array.isArray(out.deals) ? [...out.deals] : [];
  const email = String(submission.clientEmail || '').trim().toLowerCase();
  const name = String(submission.clientName || '').trim() || email;
  const company = String(submission.company || '').trim();

  let contact = contacts.find((c) => email && String(c?.email || '').toLowerCase() === email);
  let changed = false;
  if (!contact) {
    contact = {
      id: nextId(contacts),
      name,
      company,
      email: email || '',
      phone: '',
      status: 'Prospect',
      tags: ['intake'],
      score: 60,
      lastContact: new Date().toISOString().slice(0, 10),
      interactions: 1,
      leadSource: 'intake',
    };
    contacts.push(contact);
    changed = true;
  }

  const dealTitle = `${company || name} — Intake`;
  const hasDeal = deals.some((d) => String(d?.title || '') === dealTitle);
  if (!hasDeal) {
    deals.push({
      id: nextId(deals),
      title: dealTitle,
      contact: contact.name,
      value: 0,
      stage: 'Lead',
      probability: 15,
      closeDate: new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10),
      daysInStage: 0,
      health: 'good',
      leadSource: 'intake',
    });
    changed = true;
  }

  if (!changed) return { state, changed: false };
  out.contacts = contacts;
  out.deals = deals;
  return { state: out, changed: true };
}

function findOverdueTasks(state) {
  const today = new Date().toISOString().slice(0, 10);
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  return tasks.filter((t) => t && !t.done && t.due && String(t.due) < today);
}

async function pipelineBriefForOrg(orgId) {
  const result = await crmMutations.listPipeline(orgId, { limit: 10 });
  return result.summary;
}

module.exports = {
  intakeQualifiedHandoff,
  findOverdueTasks,
  pipelineBriefForOrg,
};
