'use strict';

const crmStore = require('./denizen-crm-store');
const crmAccess = require('./denizen-crm-access');

function nextId(list) {
  const ids = (list || []).map((r) => Number(r?.id) || 0);
  return ids.length ? Math.max(...ids) + 1 : Date.now();
}

/** Normalize optional actor bag from MCP / routes. */
function resolveActor(identityId, actor = null) {
  if (actor && typeof actor === 'object') {
    return {
      user: actor.user || actor.displayName || actor.display_name || null,
      displayName: actor.displayName || actor.display_name || actor.user || null,
      email: actor.email || null,
      identityId: actor.identityId || actor.identity_id || identityId || null,
    };
  }
  if (!identityId) return null;
  return { identityId, user: null, displayName: null, email: null };
}

async function loadOrgWorkspace(orgId) {
  const row = await crmStore.getWorkspace(orgId);
  return {
    state: row?.state || {},
    updated_at: row?.updated_at || null,
  };
}

async function saveOrgWorkspace(orgId, state, identityId, ifUpdatedAt) {
  return crmStore.upsertWorkspace(orgId, state, identityId, { ifUpdatedAt });
}

async function listPipeline(orgId, params = {}) {
  const workingSet = require('./denizen-crm-working-set');
  const { state } = await loadOrgWorkspace(orgId);
  const deals = Array.isArray(state.deals) ? state.deals : [];
  const limit = Math.min(200, Math.max(1, Number(params.limit) || 100));
  const stageFilter = String(params.stage || '').trim().toLowerCase();
  const includeWatchlist = params.includeWatchlist === true || params.include_watchlist === true;
  let open = includeWatchlist
    ? deals.filter((d) => d && !workingSet.isClosedDeal(d))
    : deals.filter((d) => workingSet.isOpenPipelineDeal(d));
  if (stageFilter) {
    open = open.filter((d) => String(d.stage || '').toLowerCase().includes(stageFilter));
  }
  const agentRecords = require('./denizen-crm-agent-records');
  const contactsByName = new Map();
  for (const c of Array.isArray(state.contacts) ? state.contacts : []) {
    const key = String(c?.name || '').trim().toLowerCase();
    if (key && !contactsByName.has(key)) contactsByName.set(key, c);
  }
  const companiesByName = new Map();
  for (const c of Array.isArray(state.companies) ? state.companies : []) {
    const key = String(c?.name || '').trim().toLowerCase();
    if (key && !companiesByName.has(key)) companiesByName.set(key, c);
  }
  const rows = open.slice(0, limit).map((d) => agentRecords.dealRecord(d, contactsByName, companiesByName));
  const totalValue = open.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const watchCount = deals.filter((d) => workingSet.isWatchlistDeal(d)).length;
  const empty = open.length === 0 && !(Array.isArray(state.contacts) && state.contacts.length);
  return {
    summary: empty
      ? 'Working set empty — no open pursuits. Add real companies/contacts/deals; do not invent seed data.'
      : `Working set: ${open.length} open deal(s), $${totalValue.toLocaleString()} pipeline${watchCount ? ` (${watchCount} watchlist parked)` : ''}.`,
    deals: rows,
    records: rows,
    openCount: open.length,
    totalValue,
    watchlistCount: watchCount,
    empty,
  };
}

/**
 * Park a deal to watchlist (research / scrape) — not open pipeline, $0.
 */
async function parkDeal(orgId, params = {}, identityId = null) {
  const dealId = params.dealId ?? params.deal_id ?? params.id;
  const title = String(params.title || '').trim();
  const reason = String(params.reason || params.parkReason || 'parked-to-watchlist').slice(0, 200);
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const deals = Array.isArray(state.deals) ? [...state.deals] : [];
  let idx = -1;
  if (dealId != null) idx = deals.findIndex((d) => String(d?.id) === String(dealId));
  if (idx < 0 && title) idx = deals.findIndex((d) => String(d?.title || '').toLowerCase() === title.toLowerCase());
  if (idx < 0) throw new Error('deal not found');

  const prev = deals[idx];
  const tags = [...new Set([...(prev.tags || []), 'watchlist', 'not-pipeline', 'parked'])];
  const updated = {
    ...prev,
    status: 'watchlist',
    stage: String(params.stage || 'Watch / Research'),
    value: 0,
    tags,
    parkedAt: new Date().toISOString(),
    parkReason: reason,
  };
  deals[idx] = updated;
  await saveOrgWorkspace(orgId, { ...state, deals }, identityId, ifUpdatedAt);

  try {
    const ledger = require('./denizen-outcome-ledger');
    ledger.appendOutcome({
      org_id: orgId,
      actor: params.actor || 'crm_park_deal',
      outcome_type: 'crm.park_deal',
      entity_type: 'deal',
      entity_key: String(updated.id),
      value_text: `Parked "${updated.title}" — ${reason}`,
      value_json: { deal_id: updated.id, title: updated.title, reason, previous_stage: prev.stage },
      source: 'crm_park_deal',
      pass: true,
    });
  } catch (_) {}

  return {
    summary: `Parked deal "${updated.title}" to watchlist ($0, not pipeline).`,
    deal: updated,
    previousStage: prev.stage,
  };
}

async function addContact(orgId, params = {}, identityId = null, actor = null) {
  const name = String(params.name || '').trim();
  const email = String(params.email || '').trim().toLowerCase();
  if (!name && !email) {
    throw new Error('name or email required');
  }
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const contacts = Array.isArray(state.contacts) ? [...state.contacts] : [];
  if (email && contacts.some((c) => String(c?.email || '').toLowerCase() === email)) {
    return { summary: `Contact already exists: ${email}`, contact: contacts.find((c) => String(c?.email || '').toLowerCase() === email) };
  }
  const who = resolveActor(identityId, actor || params.actor);
  let contact = {
    id: nextId(contacts),
    name: name || email,
    company: String(params.company || '').trim(),
    email: email || '',
    phone: String(params.phone || '').trim(),
    status: String(params.status || 'Lead'),
    tags: Array.isArray(params.tags) ? params.tags : [],
    score: Number(params.score) || 50,
    lastContact: new Date().toISOString().slice(0, 10),
    interactions: 0,
    leadSource: String(params.leadSource || params.source || 'npc'),
    ownerId: params.ownerId || params.owner || who?.user || who?.displayName || null,
    ownerIdentityId: params.ownerIdentityId || who?.identityId || identityId || null,
    ownerEmail: params.ownerEmail || who?.email || null,
    createdBy: params.createdBy || who?.user || who?.displayName || null,
  };
  if (who) contact = crmAccess.stampOwnerFields(contact, who);
  contacts.push(contact);
  const next = { ...state, contacts };
  await saveOrgWorkspace(orgId, next, identityId || who?.identityId || null, ifUpdatedAt);
  return { summary: `Added contact ${contact.name}${email ? ` (${email})` : ''}.`, contact };
}

async function updateDeal(orgId, params = {}, identityId = null) {
  const dealId = params.dealId ?? params.deal_id ?? params.id;
  const title = String(params.title || '').trim();
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const deals = Array.isArray(state.deals) ? [...state.deals] : [];
  let idx = -1;
  if (dealId != null) idx = deals.findIndex((d) => String(d?.id) === String(dealId));
  if (idx < 0 && title) idx = deals.findIndex((d) => String(d?.title || '').toLowerCase() === title.toLowerCase());
  if (idx < 0) throw new Error('deal not found');

  const prev = deals[idx];
  const clearValue = params.clearValue === true || params.clear_value === true;
  const updated = {
    ...prev,
    ...(params.stage != null ? { stage: String(params.stage) } : {}),
    ...(clearValue ? { value: 0 } : (params.value != null ? { value: Number(params.value) || 0 } : {})),
    ...(params.probability != null ? { probability: Number(params.probability) || prev.probability } : {}),
    ...(params.health != null ? { health: String(params.health) } : {}),
    ...(params.contact != null ? { contact: String(params.contact) } : {}),
    ...(params.deadline != null ? { deadline: String(params.deadline) } : {}),
    ...(params.closeDate != null || params.close_date != null
      ? { closeDate: String(params.closeDate ?? params.close_date) }
      : {}),
    ...(params.notes != null ? { notes: String(params.notes).slice(0, 2000) } : {}),
    ...(params.status != null ? { status: String(params.status) } : {}),
    ...(params.company != null ? { company: String(params.company) } : {}),
    ...(params.title != null && String(params.title).trim() ? { title: String(params.title).trim() } : {}),
    ...(params.studio_task_ids != null || params.studioTaskIds != null
      ? {
        studioTaskIds: Array.isArray(params.studio_task_ids || params.studioTaskIds)
          ? [...(params.studio_task_ids || params.studioTaskIds)].map(String)
          : [],
      }
      : {}),
  };
  deals[idx] = updated;
  const next = { ...state, deals };
  await saveOrgWorkspace(orgId, next, identityId, ifUpdatedAt);

  const wasWon = /closed won/i.test(String(prev.stage || ''));
  const isWon = /closed won/i.test(String(updated.stage || ''));
  if (isWon && !wasWon) {
    const officeProgress = require('./office-hq/denizen-office-progress');
    officeProgress.awardXp('deal_won', officeProgress.XP_WEIGHTS.deal_won, {
      dealId: updated.id,
      title: updated.title,
    });
  }
  if (String(prev.stage || '') !== String(updated.stage || '')) {
    try {
      require('./denizen-outcome-ledger').appendOutcome({
        org_id: orgId,
        actor: identityId || 'crm',
        outcome_type: 'deal.progressed',
        entity_type: 'deal',
        entity_key: String(updated.id),
        value_text: `Deal "${updated.title}" moved from ${prev.stage || 'unset'} to ${updated.stage}.`,
        value_json: { from: prev.stage || null, to: updated.stage, deal_id: updated.id },
        source: 'crm-update-deal',
      });
    } catch (_) { /* receipt is best-effort */ }
  }

  return {
    summary: `Updated deal "${updated.title}" → stage ${updated.stage}, value ${updated.value}.`,
    deal: updated,
    previousStage: prev.stage,
  };
}

async function addTask(orgId, params = {}, identityId = null, actor = null) {
  const title = String(params.title || params.task || '').trim();
  if (!title) throw new Error('title required');
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const tasks = Array.isArray(state.tasks) ? [...state.tasks] : [];
  const who = resolveActor(identityId, actor || params.actor);
  let task = {
    id: nextId(tasks),
    title,
    contact: String(params.contact || '').trim(),
    due: String(params.due || new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)),
    priority: String(params.priority || 'Medium'),
    done: false,
    notes: String(params.notes || params.task || '').slice(0, 500),
    assignee: params.assignee || who?.user || who?.displayName || null,
    createdBy: params.createdBy || who?.user || who?.displayName || null,
    ownerIdentityId: params.ownerIdentityId || who?.identityId || identityId || null,
    ...(params.dealId != null || params.deal_id != null
      ? { dealId: params.dealId ?? params.deal_id }
      : {}),
    ...(params.ownerEmail ? { ownerEmail: params.ownerEmail } : {}),
    ...(params.ownerIdentityId ? { ownerIdentityId: params.ownerIdentityId } : {}),
    ...(params.assignee ? { assignee: params.assignee } : {}),
  };
  if (who) task = crmAccess.stampOwnerFields(task, who);
  tasks.push(task);
  const next = { ...state, tasks };
  await saveOrgWorkspace(orgId, next, identityId || who?.identityId || null, ifUpdatedAt);
  return { summary: `Added task "${task.title}" due ${task.due}.`, task };
}

async function listTasks(orgId, params = {}) {
  const { state } = await loadOrgWorkspace(orgId);
  const today = new Date().toISOString().slice(0, 10);
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const open = tasks.filter((t) => t && !t.done);
  const overdue = open.filter((t) => t.due && String(t.due) < today);
  const limit = Math.min(200, Math.max(1, Number(params.limit) || 100));
  const agentRecords = require('./denizen-crm-agent-records');
  const rows = (params.overdue ? overdue : open).slice(0, limit).map((t) => {
    const row = agentRecords.taskRecord(t);
    row.overdue = !!(t.due && String(t.due) < today && row.status !== 'done' && row.status !== 'cancelled');
    return row;
  });
  return {
    summary: `${open.length} open task(s), ${overdue.length} overdue. ${rows.slice(0, 5).map((t) => `${t.title} [${t.task_id}]`).join('; ') || 'None'}.`,
    tasks: rows,
    records: rows,
    openCount: open.length,
    overdueCount: overdue.length,
  };
}

async function listAtRisk(orgId, params = {}) {
  const { state } = await loadOrgWorkspace(orgId);
  const deals = Array.isArray(state.deals) ? state.deals : [];
  const atRisk = deals.filter((d) => d && d.health === 'at-risk'
    && !/closed won|closed lost/i.test(String(d.stage || '')));
  const limit = Math.min(20, Math.max(1, Number(params.limit) || 10));
  const rows = atRisk.slice(0, limit).map((d) => ({
    id: d.id,
    title: d.title,
    contact: d.contact,
    value: d.value,
    stage: d.stage,
  }));
  return {
    summary: `${atRisk.length} at-risk deal(s). ${rows.slice(0, 4).map((d) => d.title).join('; ') || 'None'}.`,
    deals: rows,
    count: atRisk.length,
  };
}

async function applyIndustry(orgId, params = {}, identityId = null) {
  const industryBridge = require('./denizen-crm-industry-bridge');
  const templateId = industryBridge.resolveIndustryId(params.templateId || params.industry || params.id || params.task);
  if (!templateId) {
    const sample = industryBridge.formatIndustryList(8);
    throw new Error(`industry not recognized. Examples: ${sample}`);
  }
  const template = industryBridge.getIndustryTemplate(templateId);
  if (!template) throw new Error(`industry template ${templateId} not found`);

  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const onboarding = state.onboarding && typeof state.onboarding === 'object' ? { ...state.onboarding } : {};
  onboarding.industrySetAt = new Date().toISOString();
  onboarding.industrySetBy = params.npcName || 'npc';

  const next = {
    ...state,
    industryConfig: { ...template },
    onboarding,
  };
  await saveOrgWorkspace(orgId, next, identityId, ifUpdatedAt);
  return {
    summary: `Applied industry template ${template.icon} ${template.name} (${template.id}) — ${template.pipelineStages.length} pipeline stages.`,
    industry: { id: template.id, name: template.name, icon: template.icon },
    pipelineStages: template.pipelineStages,
  };
}

async function getSetupStatus(orgId, ctx = {}) {
  const crmSetup = require('./denizen-crm-setup');
  const { state } = await loadOrgWorkspace(orgId);
  let teamCount = Number(ctx.teamCount || 0);
  if (!teamCount) {
    try {
      const denizenDb = require('./denizen-db');
      if (denizenDb.enabled) {
        const rows = await denizenDb._get(
          `denizen_team_accounts?select=id&org_id=eq.${encodeURIComponent(orgId)}`,
        );
        teamCount = Array.isArray(rows) ? rows.length : 0;
      }
    } catch (_) { teamCount = Number(state.onboarding?.teamCount || 0); }
  }
  const setup = crmSetup.buildSetupSummary(state, { ...ctx, teamCount });
  return {
    summary: crmSetup.formatSetupSummaryText(setup),
    setup,
  };
}

async function addTicket(orgId, params = {}, identityId = null) {
  const subject = String(params.subject || params.title || '').trim();
  if (!subject) throw new Error('subject required');
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const tickets = Array.isArray(state.supportTickets) ? [...state.supportTickets] : [];
  const now = new Date().toISOString();
  const contactName = String(params.contact || '').trim();
  const contacts = Array.isArray(state.contacts) ? state.contacts : [];
  const contact = contactName
    ? contacts.find((c) => c.name === contactName || String(c.email || '').toLowerCase() === contactName.toLowerCase())
    : null;
  const ticket = {
    id: nextId(tickets),
    subject,
    contact: contact?.name || contactName || 'Unknown',
    contactId: contact?.id,
    status: 'open',
    priority: String(params.priority || 'medium'),
    assignee: String(params.assignee || params.npcName || 'Support'),
    createdBy: String(params.npcName || params.assignee || 'npc'),
    createdAt: now,
    updatedAt: now,
    description: String(params.description || params.task || '').slice(0, 2000),
    history: [{ id: 1, user: String(params.npcName || 'npc'), text: 'Ticket created via NPC', at: now, type: 'status' }],
    slaDue: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    category: String(params.category || 'general'),
  };
  tickets.unshift(ticket);
  const next = { ...state, supportTickets: tickets };
  await saveOrgWorkspace(orgId, next, identityId, ifUpdatedAt);
  return { summary: `Created support ticket "${ticket.subject}" for ${ticket.contact}.`, ticket };
}

async function updateTicket(orgId, params = {}, identityId = null) {
  const ticketId = params.ticketId ?? params.ticket_id ?? params.id;
  const subject = String(params.subject || '').trim();
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const tickets = Array.isArray(state.supportTickets) ? [...state.supportTickets] : [];
  let idx = -1;
  if (ticketId != null) idx = tickets.findIndex((t) => String(t?.id) === String(ticketId));
  if (idx < 0 && subject) idx = tickets.findIndex((t) => String(t?.subject || '').toLowerCase() === subject.toLowerCase());
  if (idx < 0) throw new Error('ticket not found');

  const prev = tickets[idx];
  const updated = {
    ...prev,
    ...(params.status != null ? { status: String(params.status) } : {}),
    updatedAt: new Date().toISOString(),
  };
  tickets[idx] = updated;
  const next = { ...state, supportTickets: tickets };
  await saveOrgWorkspace(orgId, next, identityId, ifUpdatedAt);

  const wasClosed = String(prev.status || '').toLowerCase() === 'closed';
  const isClosed = String(updated.status || '').toLowerCase() === 'closed';
  if (isClosed && !wasClosed) {
    const officeProgress = require('./office-hq/denizen-office-progress');
    officeProgress.awardXp('ticket_closed', officeProgress.XP_WEIGHTS.ticket_closed, {
      ticketId: updated.id,
      subject: updated.subject,
    });
  }

  return {
    summary: `Updated ticket "${updated.subject}" → status ${updated.status}.`,
    ticket: updated,
    previousStatus: prev.status,
  };
}

const STARTER_PACKAGES = [
  {
    id: 1,
    name: 'Starter',
    tier: 'starter',
    tagline: 'Perfect for small teams',
    color: '#6366f1',
    icon: '🚀',
    lineItems: [
      { id: 1, name: 'Platform Access (5 users)', price: 299, unit: '/mo', included: true },
      { id: 2, name: 'Basic Analytics', price: 0, unit: '', included: true },
      { id: 3, name: 'Email Support', price: 0, unit: '', included: true },
    ],
    features: ['5 users', '10GB storage', 'Email support', 'Standard reports'],
    addOns: [{ id: 1, name: 'Extra User Seat', price: 25, unit: '/mo' }],
    bestFor: ['1-10 employees', 'Early stage'],
  },
  {
    id: 2,
    name: 'Professional',
    tier: 'pro',
    tagline: 'For growing teams that need more power',
    color: '#f0b429',
    icon: '⚡',
    lineItems: [
      { id: 1, name: 'Platform Access (25 users)', price: 799, unit: '/mo', included: true },
      { id: 2, name: 'Advanced Analytics', price: 0, unit: '', included: true },
      { id: 3, name: 'Priority Support', price: 0, unit: '', included: true },
    ],
    features: ['25 users', '100GB storage', 'Priority support', 'API access'],
    addOns: [{ id: 1, name: 'Dedicated CSM', price: 199, unit: '/mo' }],
    bestFor: ['10-50 employees', 'Growing revenue'],
  },
  {
    id: 3,
    name: 'Enterprise',
    tier: 'enterprise',
    tagline: 'Unlimited scale with white-glove service',
    color: '#10b981',
    icon: '🏢',
    lineItems: [
      { id: 1, name: 'Platform Access (unlimited)', price: 2499, unit: '/mo', included: true },
      { id: 2, name: 'Full Analytics Suite', price: 0, unit: '', included: true },
      { id: 3, name: '24/7 Dedicated Support', price: 0, unit: '', included: true },
    ],
    features: ['Unlimited users', '24/7 support', 'SSO', 'Dedicated CSM'],
    addOns: [],
    bestFor: ['50+ employees', 'Enterprise deals'],
  },
];

async function addDeal(orgId, params = {}, identityId = null, actor = null) {
  const title = String(params.title || '').trim();
  if (!title) throw new Error('title required');
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const deals = Array.isArray(state.deals) ? [...state.deals] : [];
  if (deals.some((d) => String(d?.title || '').toLowerCase() === title.toLowerCase())) {
    const existing = deals.find((d) => String(d?.title || '').toLowerCase() === title.toLowerCase());
    return { summary: `Deal already exists: "${existing.title}"`, deal: existing };
  }
  const who = resolveActor(identityId, actor || params.actor);
  let deal = {
    id: nextId(deals),
    title,
    contact: String(params.contact || '').trim(),
    company: String(params.company || '').trim(),
    value: Number(params.value) || 0,
    stage: String(params.stage || 'Qualified'),
    probability: Number(params.probability) || 30,
    closeDate: String(params.closeDate || params.close_date || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)),
    daysInStage: 0,
    health: String(params.health || 'good'),
    ownerId: params.ownerId || params.owner || who?.user || who?.displayName || null,
    ownerIdentityId: params.ownerIdentityId || who?.identityId || identityId || null,
    ownerEmail: params.ownerEmail || who?.email || null,
    createdBy: params.createdBy || who?.user || who?.displayName || null,
    studioTaskIds: Array.isArray(params.studio_task_ids || params.studioTaskIds)
      ? [...(params.studio_task_ids || params.studioTaskIds)].map(String)
      : [],
  };
  if (who) deal = crmAccess.stampOwnerFields(deal, who);
  deals.push(deal);
  const next = { ...state, deals };
  await saveOrgWorkspace(orgId, next, identityId || who?.identityId || null, ifUpdatedAt);
  return { summary: `Created deal "${deal.title}" (${deal.stage}, $${deal.value}).`, deal };
}

async function updateUserProfile(orgId, params = {}, identityId = null, actor = null) {
  const name = String(params.name || params.displayName || '').trim();
  const email = String(params.email || '').trim();
  const title = String(params.title || params.position || '').trim();
  if (!name && !email && !title) {
    return { summary: 'No profile fields to update.', profile: null };
  }
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const who = resolveActor(identityId, actor || params.actor);
  const idKey = who?.identityId || identityId || null;
  const patch = { profile: {} };
  const prev = crmAccess.prefsForIdentity(state.userPrefs, idKey);
  patch.profile = { ...(prev.profile || {}) };
  if (name) patch.profile.name = name;
  if (email) patch.profile.email = email;
  if (title) patch.profile.title = title;
  const userPrefs = idKey
    ? crmAccess.mergePrefsForIdentity(state.userPrefs, patch, idKey)
    : {
      ...(state.userPrefs || {}),
      profile: patch.profile,
    };
  const next = { ...state, userPrefs };
  await saveOrgWorkspace(orgId, next, idKey, ifUpdatedAt);
  return {
    summary: `Updated CRM profile${name ? ` for ${name}` : ''}${title ? ` (${title})` : ''}.`,
    profile: patch.profile,
    identity_id: idKey,
  };
}

async function seedStarterPackages(orgId, params = {}, identityId = null) {
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const packages = Array.isArray(state.packages) ? state.packages : [];
  if (packages.length > 0) {
    return { summary: `${packages.length} package(s) already configured — skipped seeding.`, packages };
  }
  const seeded = STARTER_PACKAGES.map((pkg, idx) => ({ ...pkg, id: idx + 1 }));
  const next = { ...state, packages: seeded };
  await saveOrgWorkspace(orgId, next, identityId, ifUpdatedAt);
  return { summary: `Seeded ${seeded.length} starter packages (Starter, Professional, Enterprise).`, packages: seeded };
}

async function markOnboardingFlag(orgId, flag, identityId = null) {
  const key = String(flag || '').trim();
  if (!key) throw new Error('flag required');
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const onboarding = state.onboarding && typeof state.onboarding === 'object'
    ? { ...state.onboarding }
    : {};
  onboarding[key] = true;
  if (key === 'triedAi') onboarding.triedAiAt = new Date().toISOString();
  const next = { ...state, onboarding };
  await saveOrgWorkspace(orgId, next, identityId, ifUpdatedAt);
  return { summary: `Marked onboarding flag "${key}".`, onboarding };
}

async function listTickets(orgId, params = {}) {
  const { state } = await loadOrgWorkspace(orgId);
  const today = new Date().toISOString().slice(0, 10);
  const tickets = Array.isArray(state.supportTickets) ? state.supportTickets : [];
  let rows = tickets.filter((t) => t && t.status !== 'closed');
  if (params.overdue) {
    rows = rows.filter((t) => (t.status === 'open' || t.status === 'pending') && t.slaDue && String(t.slaDue) < today);
  }
  if (params.assignee) {
    const who = String(params.assignee).toLowerCase();
    rows = rows.filter((t) => String(t.assignee || '').toLowerCase().includes(who));
  }
  const limit = Math.min(30, Math.max(1, Number(params.limit) || 15));
  const slice = rows.slice(0, limit).map((t) => ({
    id: t.id,
    subject: t.subject,
    contact: t.contact,
    status: t.status,
    priority: t.priority,
    assignee: t.assignee,
    slaDue: t.slaDue,
    overdue: !!(t.slaDue && String(t.slaDue) < today && t.status !== 'closed'),
  }));
  const openCount = tickets.filter((t) => t.status === 'open' || t.status === 'pending').length;
  return {
    summary: `${openCount} open ticket(s). ${slice.slice(0, 4).map((t) => t.subject).join('; ') || 'None'}.`,
    tickets: slice,
    openCount,
  };
}

async function detachNote(orgId, params = {}, identityId = null) {
  const noteId = params.noteId ?? params.note_id ?? params.id;
  const matchText = String(params.matchText || params.match || params.contains || '').trim().toLowerCase();
  const dealId = params.dealId ?? params.deal_id;
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const notes = Array.isArray(state.notes) ? [...state.notes] : [];
  const before = notes.length;
  const removed = [];
  const nextNotes = notes.filter((n) => {
    if (!n) return false;
    let hit = false;
    if (noteId != null && String(n.id) === String(noteId)) hit = true;
    if (!hit && matchText && String(n.text || '').toLowerCase().includes(matchText)) hit = true;
    if (hit && dealId != null && n.dealId != null && String(n.dealId) !== String(dealId)) {
      hit = false;
    }
    if (hit) {
      removed.push({ id: n.id, dealId: n.dealId || null, contact: n.contact || null });
      return false;
    }
    return true;
  });
  if (removed.length === 0) {
    return { summary: 'No matching notes to detach.', removed: [], notesRemoved: 0 };
  }
  await saveOrgWorkspace(orgId, { ...state, notes: nextNotes }, identityId, ifUpdatedAt);
  return {
    summary: `Detached ${removed.length} note(s) (was ${before}).`,
    removed,
    notesRemoved: removed.length,
  };
}

async function closeTask(orgId, params = {}, identityId = null) {
  const taskId = params.taskId ?? params.task_id ?? params.id;
  const titleMatch = String(params.titleMatch || params.match || params.title || '').trim().toLowerCase();
  const deleteTask = params.delete === true || params.remove === true;
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const tasks = Array.isArray(state.tasks) ? [...state.tasks] : [];
  const closed = [];
  let nextTasks;
  if (deleteTask) {
    nextTasks = tasks.filter((t) => {
      if (!t) return false;
      let hit = false;
      if (taskId != null && String(t.id) === String(taskId)) hit = true;
      if (!hit && titleMatch && String(t.title || '').toLowerCase().includes(titleMatch)) hit = true;
      if (hit) {
        closed.push({ id: t.id, title: t.title, deleted: true });
        return false;
      }
      return true;
    });
  } else {
    nextTasks = tasks.map((t) => {
      if (!t) return t;
      let hit = false;
      if (taskId != null && String(t.id) === String(taskId)) hit = true;
      if (!hit && titleMatch && String(t.title || '').toLowerCase().includes(titleMatch)) hit = true;
      if (!hit || t.done) return t;
      closed.push({ id: t.id, title: t.title, deleted: false });
      return { ...t, done: true, status: 'done', closedAt: new Date().toISOString() };
    });
  }
  if (closed.length === 0) {
    return { summary: 'No matching open tasks to close.', closed: [], tasksClosed: 0 };
  }
  await saveOrgWorkspace(orgId, { ...state, tasks: nextTasks }, identityId, ifUpdatedAt);
  if (!deleteTask) {
    try {
      const ledger = require('./denizen-outcome-ledger');
      for (const task of closed) {
        ledger.appendOutcome({
          org_id: orgId,
          actor: identityId || 'crm',
          outcome_type: 'task.completed',
          entity_type: 'task',
          entity_key: String(task.id),
          value_text: `Completed task "${task.title}".`,
          value_json: { task_id: task.id },
          source: 'crm-close-task',
        });
      }
    } catch (_) { /* receipt is best-effort */ }
  }
  return {
    summary: `${deleteTask ? 'Deleted' : 'Closed'} ${closed.length} task(s).`,
    closed,
    tasksClosed: closed.length,
  };
}

async function updateCompany(orgId, params = {}, identityId = null) {
  const companyId = params.companyId ?? params.company_id ?? params.id;
  const name = String(params.name || params.company || '').trim();
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const companies = Array.isArray(state.companies) ? [...state.companies] : [];
  let idx = -1;
  if (companyId != null) idx = companies.findIndex((c) => String(c?.id) === String(companyId));
  if (idx < 0 && name) {
    idx = companies.findIndex((c) => String(c?.name || '').toLowerCase() === name.toLowerCase());
  }
  if (idx < 0 && name) {
    idx = companies.findIndex((c) => String(c?.name || '').toLowerCase().includes(name.toLowerCase()));
  }
  if (idx < 0) throw new Error('company not found');
  const prev = companies[idx];
  const updated = {
    ...prev,
    ...(params.name != null ? { name: String(params.name) } : {}),
    ...(params.address != null ? { address: String(params.address) } : {}),
    ...(params.physicalAddress != null || params.physical_address != null
      ? { physicalAddress: String(params.physicalAddress ?? params.physical_address) }
      : {}),
    ...(params.mailingAddress != null || params.mailing_address != null
      ? { mailingAddress: String(params.mailingAddress ?? params.mailing_address) }
      : {}),
    ...(params.domain != null ? { domain: String(params.domain) } : {}),
    ...(params.industry != null ? { industry: String(params.industry) } : {}),
    ...(params.website != null ? { website: String(params.website) } : {}),
    ...(params.notes != null ? { notes: String(params.notes).slice(0, 2000) } : {}),
    ...(params.type != null ? { type: String(params.type) } : {}),
    ...(params.status != null ? { status: String(params.status) } : {}),
    ...(Array.isArray(params.tags) ? { tags: params.tags } : {}),
  };
  companies[idx] = updated;
  await saveOrgWorkspace(orgId, { ...state, companies }, identityId, ifUpdatedAt);
  return { summary: `Updated company "${updated.name}".`, company: updated };
}

async function deleteDeal(orgId, params = {}, identityId = null) {
  if (params.confirm !== true) throw new Error('confirm: true required');
  const dealId = params.dealId ?? params.deal_id ?? params.id;
  if (dealId == null || dealId === '') throw new Error('deal_id required');
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const deals = Array.isArray(state.deals) ? [...state.deals] : [];
  const idx = deals.findIndex((d) => String(d?.id) === String(dealId));
  if (idx < 0) throw new Error('deal not found');
  const [removed] = deals.splice(idx, 1);
  await saveOrgWorkspace(orgId, { ...state, deals }, identityId, ifUpdatedAt);
  return { summary: `Deleted deal "${removed.title}".`, deal: { id: removed.id, title: removed.title } };
}

async function linkDealContact(orgId, params = {}, identityId = null) {
  const dealId = params.dealId ?? params.deal_id;
  const contactId = params.contactId ?? params.contact_id;
  if (dealId == null || contactId == null) throw new Error('deal_id and contact_id required');
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const contacts = Array.isArray(state.contacts) ? state.contacts : [];
  const contact = contacts.find((c) => String(c?.id) === String(contactId));
  if (!contact) throw new Error('contact not found');
  const deals = Array.isArray(state.deals) ? [...state.deals] : [];
  const idx = deals.findIndex((d) => String(d?.id) === String(dealId));
  if (idx < 0) throw new Error('deal not found');
  deals[idx] = {
    ...deals[idx],
    contactId: contact.id,
    contact: contact.name || deals[idx].contact || '',
  };
  await saveOrgWorkspace(orgId, { ...state, deals }, identityId, ifUpdatedAt);
  return { summary: `Linked deal "${deals[idx].title}" to ${contact.name || contact.id}.`, deal: deals[idx] };
}

async function mergeContacts(orgId, params = {}, identityId = null) {
  if (params.confirm !== true) throw new Error('confirm: true required');
  const keepId = params.keep_id ?? params.keepId;
  const dropId = params.drop_id ?? params.dropId;
  if (keepId == null || dropId == null || String(keepId) === String(dropId)) {
    throw new Error('keep_id and drop_id required');
  }
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const contacts = Array.isArray(state.contacts) ? [...state.contacts] : [];
  const keep = contacts.find((c) => String(c?.id) === String(keepId));
  const dropIdx = contacts.findIndex((c) => String(c?.id) === String(dropId));
  if (!keep || dropIdx < 0) throw new Error('contact not found');
  const drop = contacts[dropIdx];
  if (!keep.email && drop.email) keep.email = drop.email;
  const deals = (state.deals || []).map((deal) => {
    if (String(deal?.contactId) === String(drop.id)) {
      return { ...deal, contactId: keep.id, contact: keep.name || deal.contact };
    }
    return deal;
  });
  contacts.splice(dropIdx, 1);
  await saveOrgWorkspace(orgId, { ...state, contacts, deals }, identityId, ifUpdatedAt);
  return { summary: `Merged contact ${drop.id} into ${keep.id}.`, contact: keep, removed_id: drop.id };
}

module.exports = {
  listPipeline,
  addContact,
  addDeal,
  updateDeal,
  parkDeal,
  addTask,
  listTasks,
  listAtRisk,
  applyIndustry,
  getSetupStatus,
  addTicket,
  updateTicket,
  listTickets,
  updateUserProfile,
  seedStarterPackages,
  markOnboardingFlag,
  STARTER_PACKAGES,
  loadOrgWorkspace,
  detachNote,
  closeTask,
  updateCompany,
  deleteDeal,
  linkDealContact,
  mergeContacts,
};
