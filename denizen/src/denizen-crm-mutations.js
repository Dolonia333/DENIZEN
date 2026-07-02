'use strict';

const crmStore = require('./denizen-crm-store');

function nextId(list) {
  const ids = (list || []).map((r) => Number(r?.id) || 0);
  return ids.length ? Math.max(...ids) + 1 : Date.now();
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
  const { state } = await loadOrgWorkspace(orgId);
  const deals = Array.isArray(state.deals) ? state.deals : [];
  const limit = Math.min(50, Math.max(1, Number(params.limit) || 20));
  const stageFilter = String(params.stage || '').trim().toLowerCase();
  let open = deals.filter((d) => d && !/closed won|closed lost/i.test(String(d.stage || '')));
  if (stageFilter) {
    open = open.filter((d) => String(d.stage || '').toLowerCase().includes(stageFilter));
  }
  const rows = open.slice(0, limit).map((d) => ({
    id: d.id,
    title: d.title,
    contact: d.contact,
    value: d.value,
    stage: d.stage,
    probability: d.probability,
    health: d.health,
  }));
  const totalValue = open.reduce((s, d) => s + (Number(d.value) || 0), 0);
  return {
    summary: `Pipeline: ${open.length} open deal(s), ${totalValue.toLocaleString()} total value.`,
    deals: rows,
    openCount: open.length,
    totalValue,
  };
}

async function addContact(orgId, params = {}, identityId = null) {
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
  const contact = {
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
  };
  contacts.push(contact);
  const next = { ...state, contacts };
  await saveOrgWorkspace(orgId, next, identityId, ifUpdatedAt);
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
  const updated = {
    ...prev,
    ...(params.stage != null ? { stage: String(params.stage) } : {}),
    ...(params.value != null ? { value: Number(params.value) || 0 } : {}),
    ...(params.probability != null ? { probability: Number(params.probability) || prev.probability } : {}),
    ...(params.health != null ? { health: String(params.health) } : {}),
    ...(params.contact != null ? { contact: String(params.contact) } : {}),
  };
  deals[idx] = updated;
  const next = { ...state, deals };
  await saveOrgWorkspace(orgId, next, identityId, ifUpdatedAt);
  return {
    summary: `Updated deal "${updated.title}" → stage ${updated.stage}, value ${updated.value}.`,
    deal: updated,
    previousStage: prev.stage,
  };
}

async function addTask(orgId, params = {}, identityId = null) {
  const title = String(params.title || params.task || '').trim();
  if (!title) throw new Error('title required');
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const tasks = Array.isArray(state.tasks) ? [...state.tasks] : [];
  const task = {
    id: nextId(tasks),
    title,
    contact: String(params.contact || '').trim(),
    due: String(params.due || new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)),
    priority: String(params.priority || 'Medium'),
    done: false,
    notes: String(params.notes || params.task || '').slice(0, 500),
  };
  tasks.push(task);
  const next = { ...state, tasks };
  await saveOrgWorkspace(orgId, next, identityId, ifUpdatedAt);
  return { summary: `Added task "${task.title}" due ${task.due}.`, task };
}

async function listTasks(orgId, params = {}) {
  const { state } = await loadOrgWorkspace(orgId);
  const today = new Date().toISOString().slice(0, 10);
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const open = tasks.filter((t) => t && !t.done);
  const overdue = open.filter((t) => t.due && String(t.due) < today);
  const limit = Math.min(30, Math.max(1, Number(params.limit) || 15));
  const rows = (params.overdue ? overdue : open).slice(0, limit).map((t) => ({
    id: t.id,
    title: t.title,
    due: t.due,
    priority: t.priority,
    contact: t.contact,
    overdue: !!(t.due && String(t.due) < today),
  }));
  return {
    summary: `${open.length} open task(s), ${overdue.length} overdue. ${rows.slice(0, 5).map((t) => t.title).join('; ') || 'None'}.`,
    tasks: rows,
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
  const setup = crmSetup.buildSetupSummary(state, ctx);
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

async function addDeal(orgId, params = {}, identityId = null) {
  const title = String(params.title || '').trim();
  if (!title) throw new Error('title required');
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const deals = Array.isArray(state.deals) ? [...state.deals] : [];
  if (deals.some((d) => String(d?.title || '').toLowerCase() === title.toLowerCase())) {
    const existing = deals.find((d) => String(d?.title || '').toLowerCase() === title.toLowerCase());
    return { summary: `Deal already exists: "${existing.title}"`, deal: existing };
  }
  const deal = {
    id: nextId(deals),
    title,
    contact: String(params.contact || '').trim(),
    value: Number(params.value) || 0,
    stage: String(params.stage || 'Qualified'),
    probability: Number(params.probability) || 30,
    closeDate: String(params.closeDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)),
    daysInStage: 0,
    health: String(params.health || 'good'),
  };
  deals.push(deal);
  const next = { ...state, deals };
  await saveOrgWorkspace(orgId, next, identityId, ifUpdatedAt);
  return { summary: `Created deal "${deal.title}" (${deal.stage}, $${deal.value}).`, deal };
}

async function updateUserProfile(orgId, params = {}, identityId = null) {
  const name = String(params.name || params.displayName || '').trim();
  const email = String(params.email || '').trim();
  const title = String(params.title || params.position || '').trim();
  if (!name && !email && !title) {
    return { summary: 'No profile fields to update.', profile: null };
  }
  const { state, updated_at: ifUpdatedAt } = await loadOrgWorkspace(orgId);
  const userPrefs = { ...(state.userPrefs || {}) };
  const profile = { ...(userPrefs.profile || {}) };
  if (name) profile.name = name;
  if (email) profile.email = email;
  if (title) profile.title = title;
  userPrefs.profile = profile;
  const next = { ...state, userPrefs };
  await saveOrgWorkspace(orgId, next, identityId, ifUpdatedAt);
  return {
    summary: `Updated CRM profile${name ? ` for ${name}` : ''}${title ? ` (${title})` : ''}.`,
    profile,
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

module.exports = {
  listPipeline,
  addContact,
  addDeal,
  updateDeal,
  addTask,
  listTasks,
  listAtRisk,
  applyIndustry,
  getSetupStatus,
  addTicket,
  listTickets,
  updateUserProfile,
  seedStarterPackages,
  markOnboardingFlag,
  STARTER_PACKAGES,
  loadOrgWorkspace,
};
