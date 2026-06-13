'use strict';

const { sendCrmEmail } = require('./denizen-crm-email');
const { postWebhook } = require('./denizen-crm-webhooks');

function cloneState(state) {
  return JSON.parse(JSON.stringify(state || {}));
}

function nextId(list) {
  const ids = (list || []).map((r) => Number(r?.id) || 0);
  return ids.length ? Math.max(...ids) + 1 : Date.now();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function resolveConditionField(path, ctx) {
  const p = String(path || '').trim().toLowerCase();
  const deal = ctx.deal || {};
  const contact = ctx.contact || {};
  const task = ctx.task || {};
  const map = {
    'deal.value': deal.value, value: deal.value,
    'deal.stage': deal.stage, stage: deal.stage,
    'deal.health': deal.health, health: deal.health,
    'deal.title': deal.title,
    'deal.probability': deal.probability, probability: deal.probability,
    'contact.status': contact.status, status: contact.status,
    'contact.tags': contact.tags, tags: contact.tags,
    'contact.name': contact.name,
    'contact.company': contact.company, company: contact.company,
    priority: task.priority,
  };
  return map[p];
}

/** Evaluate a single condition clause. Unrecognized non-empty clauses are false. */
function evalConditionClause(clause, ctx) {
  const raw = String(clause || '').trim();
  if (!raw) return true;
  const lower = raw.toLowerCase();
  // Keyword shortcuts (backward compatible).
  if (lower.includes('enterprise')) return !!ctx.contact?.tags?.includes?.('Enterprise');
  if (lower.includes('high value') || lower.includes('high-value')) return (Number(ctx.deal?.value) || 0) >= 10000;
  if (lower.includes('at-risk') || lower.includes('at risk')) return ctx.deal?.health === 'at-risk';
  if (lower.includes('customer')) return ctx.contact?.status === 'Customer';
  if (lower.startsWith('stage:')) {
    const stage = raw.split(':')[1]?.trim();
    return !!stage && ctx.deal?.stage === stage;
  }
  // Generic "field op value" expression, e.g. "deal.value >= 10000".
  const m = raw.match(/^(.+?)\s*(>=|<=|!=|==|=|>|<|contains|includes)\s*(.+)$/i);
  if (m) {
    const left = resolveConditionField(m[1], ctx);
    const op = m[2].toLowerCase();
    const right = m[3].trim().replace(/^['"]|['"]$/g, '');
    const ln = Number(left);
    const rn = Number(right);
    const numeric = Number.isFinite(ln) && Number.isFinite(rn);
    switch (op) {
      case '>=': return numeric && ln >= rn;
      case '<=': return numeric && ln <= rn;
      case '>': return numeric && ln > rn;
      case '<': return numeric && ln < rn;
      case '!=': return String(left ?? '').toLowerCase() !== right.toLowerCase();
      case '=':
      case '==': return numeric ? ln === rn : String(left ?? '').toLowerCase() === right.toLowerCase();
      case 'contains':
      case 'includes':
        return Array.isArray(left)
          ? left.map((v) => String(v).toLowerCase()).includes(right.toLowerCase())
          : String(left ?? '').toLowerCase().includes(right.toLowerCase());
      default: return false;
    }
  }
  return false; // non-empty but unrecognized — do not fire (was: silently always true)
}

function evaluateConditions(conditions, ctx) {
  const raw = String(conditions || '').trim();
  if (!raw) return true; // no condition = always fire
  // OR groups (any passes); within a group all AND clauses must pass.
  const orGroups = raw.split(/\s+or\s+|\s*\|\|\s*/i);
  return orGroups.some((group) =>
    group
      .split(/\s+and\s+|\s*&&\s*|\s*,\s*/i)
      .every((clause) => evalConditionClause(clause, ctx)));
}

function updateContactField(contacts, contactName, field, value) {
  const idx = contacts.findIndex((c) => c.name === contactName);
  if (idx < 0) return contacts;
  const next = [...contacts];
  next[idx] = { ...next[idx], [field]: value };
  return next;
}

function updateDealField(deals, dealId, field, value) {
  const idx = deals.findIndex((d) => String(d.id) === String(dealId));
  if (idx < 0) return deals;
  const next = [...deals];
  next[idx] = { ...next[idx], [field]: value };
  return next;
}

function markRan(automationsList, automationRuns, auto, detail, dedupeKey) {
  if (dedupeKey && automationRuns.some((r) => r.dedupeKey === dedupeKey)) {
    return { automationsList, automationRuns, fired: false };
  }
  const nextAutomations = automationsList.map((a) => (
    String(a.id) === String(auto.id)
      ? { ...a, runCount: (Number(a.runCount) || 0) + 1, lastRun: new Date().toISOString() }
      : a
  ));
  const run = {
    id: nextId(automationRuns),
    automationId: auto.id,
    name: auto.name || 'Automation',
    trigger: auto.trigger,
    action: auto.action,
    detail: detail || '',
    at: new Date().toISOString(),
  };
  if (dedupeKey) run.dedupeKey = dedupeKey;
  return {
    automationsList: nextAutomations,
    automationRuns: [run, ...automationRuns].slice(0, 200),
    fired: true,
  };
}

async function runAutomationAction(auto, ctx, working, deals, tasks, contacts, auditLog, pushAudit) {
  if (auto.action === 'create_task') {
    tasks.push({
      id: nextId(tasks),
      title: auto.actionDetail || ctx.defaultTaskTitle || 'Automation task',
      contact: ctx.deal?.contact || ctx.contact?.name || ctx.task?.contact || '',
      due: todayStr(),
      priority: ctx.priority || 'Medium',
      done: false,
      status: 'todo',
      createdAt: todayStr(),
    });
    return { changed: true, working };
  }
  if (auto.action === 'update_field' && auto.actionDetail && ctx.deal?.contact) {
    const [field, val] = String(auto.actionDetail).split('=').map((s) => s.trim());
    if (field) {
      contacts = updateContactField(contacts, ctx.deal.contact, field, val || 'Customer');
      return { changed: true, working, contacts, tasks, deals };
    }
  }
  if (auto.action === 'notify') {
    pushAudit(auto.actionDetail || ctx.notifyText || auto.name);
    return { changed: true, working };
  }
  if (auto.action === 'webhook') {
    const hooks = working.integrations?.outboundWebhooks || {};
    const url = String(auto.actionDetail || hooks.automation || hooks.deal_won || '').trim();
    if (url.startsWith('http')) {
      await postWebhook(url, {
        event: 'automation',
        trigger: auto.trigger,
        automation: auto.name,
        at: new Date().toISOString(),
        deal: ctx.deal || null,
        contact: ctx.contact || null,
        task: ctx.task || null,
      });
    }
    return { changed: true, working };
  }
  if (auto.action === 'draft_email' && ctx.contact?.email) {
    const detail = String(auto.actionDetail || '').trim();
    const sendResult = await sendCrmEmail(working, {
      contactId: ctx.contact.id,
      templateName: detail || undefined,
      subject: detail ? undefined : `Welcome, ${ctx.contact.name}`,
      body: detail ? undefined : `Hi {{name}},\n\nGreat to connect!\n\n— {{sender.name}}`,
      senderName: 'Automations',
    });
    if (sendResult.ok) return { changed: true, working: sendResult.state, contacts, tasks, deals };
  }
  return { changed: false, working, contacts, tasks, deals };
}

async function applyServerAutomations(state, prevState = {}) {
  const out = cloneState(state);
  const automations = Array.isArray(out.automations) ? out.automations.filter((a) => a?.active) : [];
  if (!automations.length) return { state: out, changed: false };

  let working = out;
  let deals = Array.isArray(working.deals) ? [...working.deals] : [];
  let tasks = Array.isArray(working.tasks) ? [...working.tasks] : [];
  let contacts = Array.isArray(working.contacts) ? [...working.contacts] : [];
  const auditLog = Array.isArray(working.auditLog) ? [...working.auditLog] : [];
  let automationsList = Array.isArray(working.automations) ? [...working.automations] : [];
  let automationRuns = Array.isArray(working.automationRuns) ? [...working.automationRuns] : [];
  const prevDeals = Array.isArray(prevState.deals) ? prevState.deals : [];
  const prevContacts = Array.isArray(prevState.contacts) ? prevState.contacts : [];
  const prevSubmissions = Array.isArray(prevState.submissions) ? prevState.submissions : [];
  const prevQuotes = Array.isArray(prevState.quotes) ? prevState.quotes : [];
  const prevTickets = Array.isArray(prevState.supportTickets) ? prevState.supportTickets : [];
  const prevCampaigns = Array.isArray(prevState.marketingCampaigns) ? prevState.marketingCampaigns : [];
  let changed = false;

  const pushAudit = (entityName, action = 'automation') => {
    auditLog.unshift({
      id: nextId(auditLog),
      user: 'System',
      action,
      entity: 'automation',
      entityName,
      at: new Date().toISOString(),
    });
  };

  for (const auto of automations) {
    const afterAction = async (ctx, detail, dedupeKey) => {
      const ran = markRan(automationsList, automationRuns, auto, detail, dedupeKey);
      if (!ran.fired) return false;
      automationsList = ran.automationsList;
      automationRuns = ran.automationRuns;
      const result = await runAutomationAction(auto, ctx, working, deals, tasks, contacts, auditLog, pushAudit);
      if (result.working) working = result.working;
      if (result.deals) deals = result.deals;
      if (result.tasks) tasks = result.tasks;
      if (result.contacts) contacts = result.contacts;
      if (result.changed) changed = true;
      return result.changed;
    };

    if (auto.trigger === 'deal_created') {
      for (const deal of deals) {
        const prev = prevDeals.find((d) => String(d?.id) === String(deal?.id));
        if (prev) continue;
        const contact = contacts.find((c) => c.name === deal.contact);
        if (!evaluateConditions(auto.conditions, { deal, contact })) continue;
        // eslint-disable-next-line no-await-in-loop
        await afterAction({ deal, contact, defaultTaskTitle: `Qualify new deal: ${deal.title}`, priority: 'High' }, `Deal created: ${deal.title}`);
      }
    }

    if (auto.trigger === 'deal_lost') {
      for (const deal of deals) {
        const prev = prevDeals.find((d) => String(d?.id) === String(deal?.id));
        const wasLost = /closed lost/i.test(String(prev?.stage || ''));
        const isLost = /closed lost/i.test(String(deal?.stage || ''));
        if (wasLost || !isLost) continue;
        const contact = contacts.find((c) => c.name === deal.contact);
        if (!evaluateConditions(auto.conditions, { deal, contact })) continue;
        // eslint-disable-next-line no-await-in-loop
        await afterAction({ deal, contact, defaultTaskTitle: `Loss review: ${deal.title}`, notifyText: `Deal lost: ${deal.title}` }, `Deal lost: ${deal.title}`);
      }
    }

    if (auto.trigger === 'task_overdue') {
      const today = todayStr();
      for (const task of tasks) {
        if (task.done || !task.due || String(task.due) >= today) continue;
        const dedupeKey = `task_overdue:${auto.id}:${task.id}:${task.due}`;
        if (!evaluateConditions(auto.conditions, { task })) continue;
        // eslint-disable-next-line no-await-in-loop
        await afterAction({ task, defaultTaskTitle: auto.actionDetail || `Overdue: ${task.title}`, priority: 'High' }, `Overdue: ${task.title}`, dedupeKey);
      }
    }

    if (auto.trigger === 'deal_won') {
      for (const deal of deals) {
        const prev = prevDeals.find((d) => String(d?.id) === String(deal?.id));
        const wasWon = /closed won/i.test(String(prev?.stage || ''));
        const isWon = /closed won/i.test(String(deal?.stage || ''));
        if (wasWon || !isWon) continue;
        const contact = contacts.find((c) => c.name === deal.contact);
        if (!evaluateConditions(auto.conditions, { deal, contact })) continue;
        // eslint-disable-next-line no-await-in-loop
        await afterAction({ deal, contact, defaultTaskTitle: `Celebrate win: ${deal.title}`, priority: 'High', notifyText: `Deal won: ${deal.title}` }, `Deal won: ${deal.title}`);
      }
    }

    if (auto.trigger === 'deal_moved') {
      for (const deal of deals) {
        const prev = prevDeals.find((d) => String(d?.id) === String(deal?.id));
        if (!prev || prev.stage === deal.stage) continue;
        const contact = contacts.find((c) => c.name === deal.contact);
        if (!evaluateConditions(auto.conditions, { deal, contact })) continue;
        // eslint-disable-next-line no-await-in-loop
        await afterAction({ deal, contact, defaultTaskTitle: `Follow up: ${deal.title} → ${deal.stage}`, notifyText: `Deal moved: ${deal.title} → ${deal.stage}` }, `Deal moved: ${deal.title}`);
      }
    }

    if (auto.trigger === 'deal_stale') {
      for (const deal of deals) {
        if (/closed won|closed lost/i.test(String(deal?.stage || ''))) continue;
        const days = Number(deal.daysInStage) || 0;
        if (days < 14) continue;
        const exists = tasks.some((t) => !t.done && String(t.title || '').includes(deal.title));
        if (exists) continue;
        if (!evaluateConditions(auto.conditions, { deal })) continue;
        const dedupeKey = `deal_stale:${auto.id}:${deal.id}:${deal.daysInStage}`;
        // eslint-disable-next-line no-await-in-loop
        await afterAction({ deal, defaultTaskTitle: auto.actionDetail || `Re-engage stale deal: ${deal.title}` }, `Stale: ${deal.title}`, dedupeKey);
      }
    }

    if (auto.trigger === 'contact_added' && auto.action === 'draft_email') {
      for (const contact of contacts) {
        const prev = prevContacts.find((p) => String(p?.id) === String(contact?.id));
        if (prev) continue;
        if (!String(contact?.email || '').trim()) continue;
        if (!evaluateConditions(auto.conditions, { contact })) continue;

        const detail = String(auto.actionDetail || '').trim();
        const sendResult = await sendCrmEmail(working, {
          contactId: contact.id,
          templateName: detail || undefined,
          subject: detail ? undefined : `Welcome, ${contact.name}`,
          body: detail ? undefined : `Hi {{name}},\n\nGreat to connect!\n\n— {{sender.name}}`,
          senderName: 'Automations',
        });
        if (sendResult.ok) {
          working = sendResult.state;
          changed = true;
        }
      }
    }

    if (auto.trigger === 'form_submitted') {
      const submissions = Array.isArray(working.submissions) ? working.submissions : [];
      for (const sub of submissions) {
        const prev = prevSubmissions.find((s) => String(s?.id) === String(sub?.id));
        if (prev) continue;
        if (!evaluateConditions(auto.conditions, { submission: sub })) continue;

        // eslint-disable-next-line no-await-in-loop
        await afterAction({ defaultTaskTitle: auto.actionDetail || `Review intake: ${sub.clientName}`, priority: 'High' }, `Intake: ${sub.clientName}`);
      }
    }

    if (auto.trigger === 'quote_sent') {
      const quotes = Array.isArray(working.quotes) ? working.quotes : [];
      for (const quote of quotes) {
        const prev = prevQuotes.find((q) => String(q?.id) === String(quote?.id));
        if (prev) continue;
        if (!evaluateConditions(auto.conditions, { quote })) continue;
        // eslint-disable-next-line no-await-in-loop
        await afterAction({ defaultTaskTitle: auto.actionDetail || `Follow up on quote: ${quote.recommendedPackage}`, priority: 'Medium' }, `Quote: ${quote.recommendedPackage}`);
      }
    }

    if (auto.trigger === 'ticket_created') {
      const tickets = Array.isArray(working.supportTickets) ? working.supportTickets : [];
      for (const ticket of tickets) {
        const prev = prevTickets.find((t) => String(t?.id) === String(ticket?.id));
        if (prev) continue;
        const contact = contacts.find((c) => c.name === ticket.contact || c.id === ticket.contactId);
        if (!evaluateConditions(auto.conditions, { ticket, contact })) continue;
        // eslint-disable-next-line no-await-in-loop
        await afterAction({ contact, defaultTaskTitle: auto.actionDetail || `Triage ticket: ${ticket.subject}`, priority: 'High', notifyText: `New ticket: ${ticket.subject}` }, `Ticket: ${ticket.subject}`);
      }
    }

    if (auto.trigger === 'ticket_overdue') {
      const today = todayStr();
      const tickets = Array.isArray(working.supportTickets) ? working.supportTickets : [];
      for (const ticket of tickets) {
        if (ticket.status === 'closed' || ticket.status === 'resolved') continue;
        if (!ticket.slaDue || String(ticket.slaDue) >= today) continue;
        const dedupeKey = `ticket_overdue:${auto.id}:${ticket.id}:${ticket.slaDue}`;
        const contact = contacts.find((c) => c.name === ticket.contact || c.id === ticket.contactId);
        if (!evaluateConditions(auto.conditions, { ticket, contact })) continue;
        // eslint-disable-next-line no-await-in-loop
        await afterAction({ ticket, contact, defaultTaskTitle: auto.actionDetail || `SLA breach: ${ticket.subject}`, priority: 'High', notifyText: `Ticket SLA breach: ${ticket.subject}` }, `Ticket SLA: ${ticket.subject}`, dedupeKey);
      }
    }

    if (auto.trigger === 'campaign_started') {
      const campaigns = Array.isArray(working.marketingCampaigns) ? working.marketingCampaigns : [];
      for (const campaign of campaigns) {
        const prev = prevCampaigns.find((c) => String(c?.id) === String(campaign?.id));
        if (!prev || prev.status === 'active' || campaign.status !== 'active') continue;
        if (!evaluateConditions(auto.conditions, { campaign })) continue;
        // eslint-disable-next-line no-await-in-loop
        await afterAction({ defaultTaskTitle: auto.actionDetail || `Monitor campaign: ${campaign.name}`, priority: 'Medium', notifyText: `Campaign started: ${campaign.name}` }, `Campaign: ${campaign.name}`);
      }
    }

    if (auto.trigger === 'campaign_completed') {
      const campaigns = Array.isArray(working.marketingCampaigns) ? working.marketingCampaigns : [];
      for (const campaign of campaigns) {
        const prev = prevCampaigns.find((c) => String(c?.id) === String(campaign?.id));
        if (!prev || prev.status === 'completed' || campaign.status !== 'completed') continue;
        if (!evaluateConditions(auto.conditions, { campaign })) continue;
        // eslint-disable-next-line no-await-in-loop
        await afterAction({ defaultTaskTitle: auto.actionDetail || `Review campaign results: ${campaign.name}`, priority: 'Low', notifyText: `Campaign completed: ${campaign.name}` }, `Campaign done: ${campaign.name}`);
      }
    }
  }

  if (changed) {
    working.deals = deals;
    working.tasks = tasks;
    working.contacts = contacts;
    working.auditLog = auditLog.slice(0, 500);
    working.automations = automationsList;
    working.automationRuns = automationRuns;
  }

  return { state: working, changed };
}

module.exports = { applyServerAutomations, evaluateConditions };
