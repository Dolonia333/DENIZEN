'use strict';

/**
 * Structured CRM records for MCP / Meridian.
 * Lists always include deal_id, contact_id, company_id, task_id.
 * Bulk writes return per-record success or failure and save once.
 */

const crmMutations = require('./denizen-crm-mutations');
const crmAccess = require('./denizen-crm-access');

const TASK_STATUSES = new Set(['open', 'todo', 'paused', 'cancelled', 'canceled', 'done', 'completed']);

function idOf(value) {
  if (value == null || value === '') return null;
  return value;
}

function findById(list, id) {
  if (id == null || id === '') return -1;
  return (list || []).findIndex((row) => String(row?.id) === String(id));
}

function indexByName(list, field) {
  const map = new Map();
  for (const row of list || []) {
    const key = String(row?.[field] || '').trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, row);
  }
  return map;
}

function dealRecord(deal, contactsByName, companiesByName) {
  const contact = deal.contactId != null
    ? null
    : contactsByName.get(String(deal.contact || '').trim().toLowerCase());
  const company = deal.companyId != null
    ? null
    : companiesByName.get(String(deal.company || '').trim().toLowerCase());
  return {
    deal_id: deal.id,
    id: deal.id,
    name: deal.title || '',
    title: deal.title || '',
    company_id: deal.companyId ?? company?.id ?? null,
    contact_id: deal.contactId ?? contact?.id ?? null,
    company: deal.company || company?.name || '',
    contact: deal.contact || contact?.name || '',
    stage: deal.stage || '',
    value: Number(deal.value) || 0,
    status: deal.status || null,
    deadline: deal.deadline || deal.closeDate || null,
    next_action: deal.nextAction || deal.next_action || null,
    health: deal.health || null,
    probability: deal.probability ?? null,
    owner: deal.ownerEmail || deal.owner || deal.ownerId || null,
    notes: deal.notes || '',
  };
}

function contactRecord(contact) {
  return {
    contact_id: contact.id,
    id: contact.id,
    name: contact.name || '',
    email: contact.email || '',
    phone: contact.phone || '',
    company: contact.company || '',
    company_id: contact.companyId ?? null,
    status: contact.status || null,
    owner: contact.ownerEmail || contact.owner || contact.ownerId || null,
  };
}

function companyRecord(company) {
  return {
    company_id: company.id,
    id: company.id,
    name: company.name || '',
    industry: company.industry || '',
    status: company.status || null,
    domain: company.domain || '',
    linked_contact_ids: Array.isArray(company.linkedContacts) ? company.linkedContacts : [],
    linked_deal_ids: Array.isArray(company.linkedDeals) ? company.linkedDeals : [],
  };
}

function taskRecord(task) {
  const status = task.status || (task.done ? 'done' : 'open');
  return {
    task_id: task.id,
    id: task.id,
    title: task.title || '',
    status,
    done: status === 'done' || status === 'completed' || task.done === true,
    due: task.due || null,
    priority: task.priority || null,
    contact: task.contact || '',
    contact_id: task.contactId ?? null,
    deal_id: task.dealId ?? task.deal_id ?? null,
    overdue: false,
  };
}

function recordsFromState(state = {}, params = {}) {
  const limit = Math.min(200, Math.max(1, Number(params.limit) || 100));
  const kind = String(params.kind || params.type || 'all').trim().toLowerCase();
  const contacts = Array.isArray(state.contacts) ? state.contacts : [];
  const companies = Array.isArray(state.companies) ? state.companies : [];
  const deals = Array.isArray(state.deals) ? state.deals : [];
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const contactsByName = indexByName(contacts, 'name');
  const companiesByName = indexByName(companies, 'name');
  const today = new Date().toISOString().slice(0, 10);
  const want = (name) => kind === 'all' || kind === name || kind === `${name}s`;

  const dealRows = want('deal')
    ? deals.slice(0, limit).map((d) => dealRecord(d, contactsByName, companiesByName))
    : [];
  const contactRows = want('contact')
    ? contacts.slice(0, limit).map(contactRecord)
    : [];
  const companyRows = want('company') ? companies.slice(0, limit).map(companyRecord) : [];
  const taskRows = want('task')
    ? tasks.slice(0, limit).map((t) => {
      const row = taskRecord(t);
      row.overdue = !!(t.due && String(t.due) < today && row.status !== 'done' && row.status !== 'cancelled' && row.status !== 'canceled');
      return row;
    })
    : [];

  return {
    summary: [
      dealRows.length || kind === 'all' ? `${deals.length} deals` : null,
      contactRows.length || kind === 'all' ? `${contacts.length} contacts` : null,
      companyRows.length || kind === 'all' ? `${companies.length} companies` : null,
      taskRows.length || kind === 'all' ? `${tasks.length} tasks` : null,
    ].filter(Boolean).join(', '),
    records: {
      deals: dealRows,
      contacts: contactRows,
      companies: companyRows,
      tasks: taskRows,
    },
    counts: {
      deals: deals.length,
      contacts: contacts.length,
      companies: companies.length,
      tasks: tasks.length,
    },
  };
}

function allowedIdSet(list) {
  return new Set((list || []).map((row) => String(row?.id)));
}

function visibleState(full, actor) {
  if (!actor?.forceOwn) return full;
  return crmAccess.filterWorkspaceForAccess(full, actor, { forceOwn: true }).state;
}

function applyDealPatch(prev, change) {
  const next = { ...prev };
  if (change.stage != null) next.stage = String(change.stage);
  if (change.status != null) next.status = String(change.status);
  if (change.value != null) next.value = Number(change.value) || 0;
  if (change.clearValue === true || change.clear_value === true) next.value = 0;
  if (change.probability != null) next.probability = Number(change.probability) || 0;
  if (change.health != null) next.health = String(change.health);
  if (change.contact != null) next.contact = String(change.contact);
  if (change.company != null) next.company = String(change.company);
  if (change.title != null && String(change.title).trim()) next.title = String(change.title).trim();
  if (change.name != null && String(change.name).trim()) next.title = String(change.name).trim();
  if (change.notes != null) next.notes = String(change.notes).slice(0, 2000);
  if (change.deadline != null) next.deadline = String(change.deadline);
  if (change.closeDate != null || change.close_date != null) {
    next.closeDate = String(change.closeDate ?? change.close_date);
  }
  if (change.contact_id != null || change.contactId != null) {
    next.contactId = change.contact_id ?? change.contactId;
  }
  if (change.company_id != null || change.companyId != null) {
    next.companyId = change.company_id ?? change.companyId;
  }
  if (change.next_action != null || change.nextAction != null) {
    next.nextAction = String(change.next_action ?? change.nextAction);
  }
  return next;
}

function applyTaskPatch(prev, change) {
  const next = { ...prev };
  const status = change.status != null ? String(change.status).trim().toLowerCase() : null;
  if (status) {
    if (!TASK_STATUSES.has(status)) {
      const err = new Error(`invalid task status "${change.status}"`);
      err.code = 'BAD_STATUS';
      throw err;
    }
    const normalized = status === 'canceled' ? 'cancelled' : (status === 'completed' ? 'done' : status);
    next.status = normalized;
    next.done = normalized === 'done';
    if (normalized === 'done') next.closedAt = new Date().toISOString();
  }
  if (change.done === true) {
    next.done = true;
    next.status = 'done';
    next.closedAt = new Date().toISOString();
  }
  if (change.done === false && status == null) {
    next.done = false;
    next.status = next.status === 'done' ? 'open' : (next.status || 'open');
  }
  if (change.title != null && String(change.title).trim()) next.title = String(change.title).trim();
  if (change.due != null) next.due = String(change.due);
  if (change.priority != null) next.priority = String(change.priority);
  if (change.contact != null) next.contact = String(change.contact);
  if (change.contact_id != null || change.contactId != null) {
    next.contactId = change.contact_id ?? change.contactId;
  }
  if (change.deal_id != null || change.dealId != null) {
    next.dealId = change.deal_id ?? change.dealId;
  }
  if (change.notes != null) next.notes = String(change.notes).slice(0, 500);
  return next;
}

function applyContactPatch(prev, change) {
  const next = { ...prev };
  if (change.name != null) next.name = String(change.name);
  if (change.email != null) next.email = String(change.email).trim().toLowerCase();
  if (change.company != null) next.company = String(change.company);
  if (change.phone != null) next.phone = String(change.phone);
  if (change.role != null) next.role = String(change.role);
  if (change.title != null) next.title = String(change.title);
  if (change.status != null) next.status = String(change.status);
  if (change.company_id != null || change.companyId != null) {
    next.companyId = change.company_id ?? change.companyId;
  }
  if (change.notes != null) next.notes = String(change.notes).slice(0, 2000);
  return next;
}

function applyBulkDealUpdates(state, updates, actor) {
  const view = visibleState(state, actor);
  const allowed = actor?.forceOwn ? allowedIdSet(view.deals) : null;
  const deals = Array.isArray(state.deals) ? [...state.deals] : [];
  const results = [];
  for (const change of updates || []) {
    const dealId = idOf(change?.deal_id ?? change?.dealId ?? change?.id);
    const idx = findById(deals, dealId);
    if (idx < 0 || (allowed && !allowed.has(String(dealId)))) {
      results.push({ deal_id: dealId, ok: false, error: 'deal not found' });
      continue;
    }
    deals[idx] = applyDealPatch(deals[idx], change || {});
    results.push({ deal_id: deals[idx].id, ok: true, deal: dealRecord(deals[idx], new Map(), new Map()) });
  }
  return { state: { ...state, deals }, results };
}

function applyBulkTaskUpdates(state, updates, actor) {
  const view = visibleState(state, actor);
  const allowed = actor?.forceOwn ? allowedIdSet(view.tasks) : null;
  const tasks = Array.isArray(state.tasks) ? [...state.tasks] : [];
  const results = [];
  for (const change of updates || []) {
    const taskId = idOf(change?.task_id ?? change?.taskId ?? change?.id);
    const idx = findById(tasks, taskId);
    if (idx < 0 || (allowed && !allowed.has(String(taskId)))) {
      results.push({ task_id: taskId, ok: false, error: 'task not found' });
      continue;
    }
    try {
      tasks[idx] = applyTaskPatch(tasks[idx], change || {});
      results.push({ task_id: tasks[idx].id, ok: true, task: taskRecord(tasks[idx]) });
    } catch (err) {
      results.push({ task_id: taskId, ok: false, error: err.message || String(err) });
    }
  }
  return { state: { ...state, tasks }, results };
}

function applyBulkContactUpdates(state, updates, actor) {
  const view = visibleState(state, actor);
  const allowed = actor?.forceOwn ? allowedIdSet(view.contacts) : null;
  const contacts = Array.isArray(state.contacts) ? [...state.contacts] : [];
  const results = [];
  for (const change of updates || []) {
    const contactId = idOf(change?.contact_id ?? change?.contactId ?? change?.id);
    const idx = findById(contacts, contactId);
    if (idx < 0 || (allowed && !allowed.has(String(contactId)))) {
      results.push({ contact_id: contactId, ok: false, error: 'contact not found' });
      continue;
    }
    contacts[idx] = applyContactPatch(contacts[idx], change || {});
    results.push({ contact_id: contacts[idx].id, ok: true, contact: contactRecord(contacts[idx]) });
  }
  return { state: { ...state, contacts }, results };
}

function linkId(row, ...keys) {
  for (const key of keys) {
    if (row?.[key] != null && row[key] !== '') return row[key];
  }
  return null;
}

function pushUnique(list, id) {
  const next = Array.isArray(list) ? [...list] : [];
  if (!next.some((item) => String(item) === String(id))) next.push(id);
  return next;
}

function applyBulkLinks(state, links, actor) {
  const view = visibleState(state, actor);
  const dealAllowed = actor?.forceOwn ? allowedIdSet(view.deals) : null;
  const contactAllowed = actor?.forceOwn ? allowedIdSet(view.contacts) : null;
  const taskAllowed = actor?.forceOwn ? allowedIdSet(view.tasks) : null;
  let deals = Array.isArray(state.deals) ? [...state.deals] : [];
  let contacts = Array.isArray(state.contacts) ? [...state.contacts] : [];
  let companies = Array.isArray(state.companies) ? [...state.companies] : [];
  let tasks = Array.isArray(state.tasks) ? [...state.tasks] : [];
  const results = [];

  const deny = (idSet, id) => idSet && id != null && !idSet.has(String(id));

  for (const link of links || []) {
    const type = String(link?.type || link?.rel || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/→/g, '_');
    const contactId = linkId(link, 'contact_id', 'contactId');
    const companyId = linkId(link, 'company_id', 'companyId', 'customer_id', 'customerId');
    const dealId = linkId(link, 'deal_id', 'dealId', 'opportunity_id', 'opportunityId');
    const taskId = linkId(link, 'task_id', 'taskId');
    const partnerId = linkId(link, 'partner_id', 'partnerId') ?? contactId;
    try {
      if (type === 'contact_company' || type === 'contact_to_company') {
        if (deny(contactAllowed, contactId)) throw new Error('contact not found');
        const cIdx = findById(contacts, contactId);
        const coIdx = findById(companies, companyId);
        if (cIdx < 0) throw new Error('contact not found');
        if (coIdx < 0) throw new Error('company not found');
        contacts[cIdx] = { ...contacts[cIdx], company: companies[coIdx].name, companyId: companies[coIdx].id };
        companies[coIdx] = {
          ...companies[coIdx],
          linkedContacts: pushUnique(companies[coIdx].linkedContacts, contacts[cIdx].id),
        };
      } else if (type === 'contact_deal' || type === 'contact_to_deal') {
        if (deny(contactAllowed, contactId) || deny(dealAllowed, dealId)) throw new Error('record not found');
        const cIdx = findById(contacts, contactId);
        const dIdx = findById(deals, dealId);
        if (cIdx < 0) throw new Error('contact not found');
        if (dIdx < 0) throw new Error('deal not found');
        deals[dIdx] = { ...deals[dIdx], contact: contacts[cIdx].name, contactId: contacts[cIdx].id };
      } else if (type === 'deal_company' || type === 'deal_to_company') {
        if (deny(dealAllowed, dealId)) throw new Error('deal not found');
        const dIdx = findById(deals, dealId);
        const coIdx = findById(companies, companyId);
        if (dIdx < 0) throw new Error('deal not found');
        if (coIdx < 0) throw new Error('company not found');
        deals[dIdx] = { ...deals[dIdx], company: companies[coIdx].name, companyId: companies[coIdx].id };
        companies[coIdx] = {
          ...companies[coIdx],
          linkedDeals: pushUnique(companies[coIdx].linkedDeals, deals[dIdx].id),
        };
      } else if (type === 'task_deal' || type === 'task_to_deal') {
        if (deny(taskAllowed, taskId) || deny(dealAllowed, dealId)) throw new Error('record not found');
        const tIdx = findById(tasks, taskId);
        const dIdx = findById(deals, dealId);
        if (tIdx < 0) throw new Error('task not found');
        if (dIdx < 0) throw new Error('deal not found');
        tasks[tIdx] = { ...tasks[tIdx], dealId: deals[dIdx].id };
      } else if (type === 'task_contact' || type === 'task_to_contact') {
        if (deny(taskAllowed, taskId) || deny(contactAllowed, contactId)) throw new Error('record not found');
        const tIdx = findById(tasks, taskId);
        const cIdx = findById(contacts, contactId);
        if (tIdx < 0) throw new Error('task not found');
        if (cIdx < 0) throw new Error('contact not found');
        tasks[tIdx] = { ...tasks[tIdx], contact: contacts[cIdx].name, contactId: contacts[cIdx].id };
      } else if (type === 'partner_opportunity' || type === 'partner_to_opportunity') {
        if (deny(dealAllowed, dealId)) throw new Error('deal not found');
        const dIdx = findById(deals, dealId);
        if (dIdx < 0) throw new Error('deal not found');
        const cIdx = findById(contacts, partnerId);
        const coIdx = findById(companies, partnerId);
        if (cIdx >= 0 && deny(contactAllowed, partnerId)) throw new Error('partner not found');
        if (cIdx < 0 && coIdx < 0) throw new Error('partner not found');
        deals[dIdx] = {
          ...deals[dIdx],
          partnerId: cIdx >= 0 ? contacts[cIdx].id : companies[coIdx].id,
          partnerName: cIdx >= 0 ? contacts[cIdx].name : companies[coIdx].name,
          partnerKind: cIdx >= 0 ? 'contact' : 'company',
        };
      } else if (type === 'past_performance_customer' || type === 'past_performance_to_customer') {
        if (deny(dealAllowed, dealId)) throw new Error('deal not found');
        const dIdx = findById(deals, dealId);
        const coIdx = findById(companies, companyId);
        if (dIdx < 0) throw new Error('deal not found');
        if (coIdx < 0) throw new Error('customer not found');
        deals[dIdx] = {
          ...deals[dIdx],
          pastPerformance: {
            id: link.past_performance_id || link.pastPerformanceId || deals[dIdx].pastPerformance?.id || `pp_${deals[dIdx].id}`,
            customer_id: companies[coIdx].id,
            customer: companies[coIdx].name,
          },
        };
      } else {
        throw new Error(`unknown link type "${type}"`);
      }
      results.push({ ok: true, type, deal_id: dealId, contact_id: contactId, company_id: companyId, task_id: taskId });
    } catch (err) {
      results.push({
        ok: false,
        type,
        error: err.message || String(err),
        deal_id: dealId,
        contact_id: contactId,
        company_id: companyId,
        task_id: taskId,
      });
    }
  }
  return { state: { ...state, deals, contacts, companies, tasks }, results };
}

function upsertPackageRecord(state, pkg) {
  const packages = Array.isArray(state.packages) ? [...state.packages] : [];
  const name = String(pkg?.name || '').trim();
  const id = pkg?.id ?? pkg?.package_id ?? pkg?.packageId;
  if (!name && id == null) {
    return { state, result: { ok: false, error: 'package name or id required' } };
  }
  let idx = id != null ? findById(packages, id) : -1;
  if (idx < 0 && name) {
    idx = packages.findIndex((p) => String(p?.name || '').toLowerCase() === name.toLowerCase());
  }
  const base = idx >= 0 ? packages[idx] : {
    id: id != null ? id : (packages.reduce((max, p) => Math.max(max, Number(p?.id) || 0), 0) + 1),
    name,
    tier: 'custom',
    lineItems: [],
    features: [],
  };
  const next = {
    ...base,
    ...(name ? { name } : {}),
    ...(pkg.tier != null ? { tier: String(pkg.tier) } : {}),
    ...(pkg.tagline != null ? { tagline: String(pkg.tagline) } : {}),
    ...(pkg.color != null ? { color: String(pkg.color) } : {}),
    ...(pkg.icon != null ? { icon: String(pkg.icon) } : {}),
    ...(Array.isArray(pkg.features) ? { features: pkg.features } : {}),
    ...(Array.isArray(pkg.lineItems) || Array.isArray(pkg.line_items)
      ? { lineItems: pkg.lineItems || pkg.line_items }
      : {}),
    ...(Array.isArray(pkg.bestFor) || Array.isArray(pkg.best_for)
      ? { bestFor: pkg.bestFor || pkg.best_for }
      : {}),
  };
  if (idx >= 0) packages[idx] = next;
  else packages.push(next);
  return {
    state: { ...state, packages },
    result: {
      ok: true,
      package_id: next.id,
      package: next,
      created: idx < 0,
    },
  };
}

function applyProfilePatch(state, fields, memberKey) {
  const userPrefs = { ...(state.userPrefs || {}) };
  const incoming = {};
  const map = {
    name: fields.name || fields.displayName || fields.display_name,
    email: fields.email,
    title: fields.title || fields.position || fields.workPosition,
    phone: fields.phone,
    company: fields.company,
    website: fields.website,
    bio: fields.bio,
  };
  for (const [key, value] of Object.entries(map)) {
    if (value != null && String(value).trim()) incoming[key] = String(value).trim();
  }
  if (!Object.keys(incoming).length) {
    return { state, profile: userPrefs.profile || null, changed: false };
  }
  if (memberKey) {
    const memberProfiles = { ...(userPrefs.memberProfiles || {}) };
    memberProfiles[memberKey] = { ...(memberProfiles[memberKey] || {}), ...incoming };
    userPrefs.memberProfiles = memberProfiles;
  }
  const current = { ...(userPrefs.profile || {}) };
  const founderEmpty = !current.name || current.name === 'Guest';
  if (!memberKey || founderEmpty) {
    userPrefs.profile = { ...current, ...incoming };
  }
  return {
    state: { ...state, userPrefs },
    profile: memberKey ? userPrefs.memberProfiles[memberKey] : userPrefs.profile,
    changed: true,
  };
}

function resultSummary(kind, results) {
  const ok = results.filter((row) => row.ok).length;
  return `${ok}/${results.length} ${kind} updated`;
}

async function withWorkspace(orgId, identityId, mutate) {
  const loaded = await crmMutations.loadOrgWorkspace(orgId);
  const { state, results, extra } = mutate(loaded.state || {});
  const changed = (results || []).some((row) => row.ok);
  if (changed) {
    const crmStore = require('./denizen-crm-store');
    await crmStore.upsertWorkspace(orgId, state, identityId, { ifUpdatedAt: loaded.updated_at });
  }
  return { results, ...extra, saved: changed };
}

async function listRecords(orgId, params = {}, actor = null) {
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  return recordsFromState(visibleState(state, actor), params);
}

async function bulkUpdateDeals(orgId, params = {}, identityId = null, actor = null) {
  const updates = Array.isArray(params.updates) ? params.updates : [];
  const out = await withWorkspace(orgId, identityId, (state) => {
    const applied = applyBulkDealUpdates(state, updates, actor);
    return { state: applied.state, results: applied.results };
  });
  return {
    summary: resultSummary('deals', out.results),
    results: out.results,
    records: out.results.filter((row) => row.ok).map((row) => row.deal),
    saved: out.saved,
  };
}

async function bulkUpdateTasks(orgId, params = {}, identityId = null, actor = null) {
  const updates = Array.isArray(params.updates) ? params.updates : [];
  const out = await withWorkspace(orgId, identityId, (state) => {
    const applied = applyBulkTaskUpdates(state, updates, actor);
    return { state: applied.state, results: applied.results };
  });
  return {
    summary: resultSummary('tasks', out.results),
    results: out.results,
    records: out.results.filter((row) => row.ok).map((row) => row.task),
    saved: out.saved,
  };
}

async function bulkUpdateContacts(orgId, params = {}, identityId = null, actor = null) {
  const updates = Array.isArray(params.updates) ? params.updates : [];
  const out = await withWorkspace(orgId, identityId, (state) => {
    const applied = applyBulkContactUpdates(state, updates, actor);
    return { state: applied.state, results: applied.results };
  });
  return {
    summary: resultSummary('contacts', out.results),
    results: out.results,
    records: out.results.filter((row) => row.ok).map((row) => row.contact),
    saved: out.saved,
  };
}

async function bulkLinkRecords(orgId, params = {}, identityId = null, actor = null) {
  const links = Array.isArray(params.links) ? params.links : (Array.isArray(params.updates) ? params.updates : []);
  const out = await withWorkspace(orgId, identityId, (state) => {
    const applied = applyBulkLinks(state, links, actor);
    return { state: applied.state, results: applied.results };
  });
  const ok = out.results.filter((row) => row.ok).length;
  return {
    summary: `${ok}/${out.results.length} links saved`,
    results: out.results,
    saved: out.saved,
  };
}

async function upsertPackage(orgId, params = {}, identityId = null) {
  const loaded = await crmMutations.loadOrgWorkspace(orgId);
  const applied = upsertPackageRecord(loaded.state || {}, params.package || params);
  if (!applied.result.ok) return { summary: applied.result.error, ...applied.result };
  const crmStore = require('./denizen-crm-store');
  await crmStore.upsertWorkspace(orgId, applied.state, identityId, { ifUpdatedAt: loaded.updated_at });
  return {
    summary: `${applied.result.created ? 'Created' : 'Updated'} package "${applied.result.package.name}".`,
    ...applied.result,
  };
}

async function updateProfile(orgId, params = {}, identityId = null, memberKey = null) {
  const loaded = await crmMutations.loadOrgWorkspace(orgId);
  const applied = applyProfilePatch(loaded.state || {}, params.profile || params, memberKey);
  if (!applied.changed) return { summary: 'No profile fields to update.', profile: applied.profile };
  const crmStore = require('./denizen-crm-store');
  await crmStore.upsertWorkspace(orgId, applied.state, identityId, { ifUpdatedAt: loaded.updated_at });
  return { summary: 'Updated CRM profile.', profile: applied.profile };
}

module.exports = {
  dealRecord,
  contactRecord,
  companyRecord,
  taskRecord,
  recordsFromState,
  applyBulkDealUpdates,
  applyBulkTaskUpdates,
  applyBulkContactUpdates,
  applyBulkLinks,
  upsertPackageRecord,
  applyProfilePatch,
  listRecords,
  bulkUpdateDeals,
  bulkUpdateTasks,
  bulkUpdateContacts,
  bulkLinkRecords,
  upsertPackage,
  updateProfile,
};
