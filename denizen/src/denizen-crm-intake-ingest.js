'use strict';

/**
 * Server-token-protected intake ingest: turns one cleaned intake submission
 * (from the n8n client-intake workflow) into CRM records.
 *
 *   POST /api/crm/intake-ingest   Authorization: Bearer <INTAKE_INGEST_TOKEN>
 *
 * Design notes:
 *  - Fails closed: 503 when INTAKE_INGEST_TOKEN is unset, 401 on missing/wrong token.
 *  - NEW clients only (client_type must be exactly "new").
 *  - Idempotent on sha256(lowercased trimmed email + "|" + intake_id), stored as
 *    `intakeKey` on the deal, task and note. A retry returns the same ids with
 *    duplicate:true and writes nothing.
 *  - Everything happens inside ONE workspace state update with strictly
 *    sequential id allocation (no parallel creates), saved with ifUpdatedAt and
 *    up to 3 reload+retries on conflict.
 *  - No outbound messages: this module never calls email/SMS/webhook code, and
 *    the save passes skipAutomations + skipWebhooks so workspace automations
 *    (e.g. contact_added -> draft_email) and outbound webhooks do not fire.
 */

const crypto = require('node:crypto');
const denizenVisitor = require('./denizen-visitor');
const crmStore = require('./denizen-crm-store');
const {
  _clip, _sanitizeAnswers, _recordHit, MAX_FIELD_LEN, MAX_ANSWER_LEN,
} = require('./denizen-crm-intake-public');

const TOKEN_ENV = 'INTAKE_INGEST_TOKEN';
const MAX_SAVE_ATTEMPTS = 3;
// Authenticated server-to-server caller: more generous than the public form,
// but still bounded. Failed auth attempts get a separate, tighter budget.
const RATE_MAX_PER_CLIENT = 60;
const RATE_MAX_PER_ORG = 120;
const RATE_MAX_AUTH_FAILS = 20;
const MAX_NOTE_LEN = 2000;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const INTAKE_ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
const EARLY_CLIENT_MARKERS = ['early', 'portfolio'];

function nextId(list) {
  const ids = (list || []).map((r) => Number(r?.id) || 0);
  return ids.length ? Math.max(...ids) + 1 : Date.now();
}

// ---------------------------------------------------------------- auth

function tokenConfigured() {
  return Boolean(String(process.env[TOKEN_ENV] || '').trim());
}

/** Constant-time compare of the Bearer token against INTAKE_INGEST_TOKEN. */
function tokenMatches(authorizationHeader) {
  const expected = String(process.env[TOKEN_ENV] || '').trim();
  if (!expected) return false;
  const m = /^Bearer\s+(.+)$/i.exec(String(authorizationHeader || '').trim());
  if (!m) return false;
  // Hash both sides so lengths always match for timingSafeEqual.
  const a = crypto.createHash('sha256').update(m[1].trim()).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * @returns {{ok:true}|{ok:false,status:number,error:string}}
 */
function authorize(authorizationHeader, clientKey = '') {
  if (!tokenConfigured()) return { ok: false, status: 503, error: 'intake_ingest_not_configured' };
  if (!tokenMatches(authorizationHeader)) {
    if (clientKey && _recordHit(`ingest-auth-fail:${clientKey}`) > RATE_MAX_AUTH_FAILS) {
      return { ok: false, status: 429, error: 'rate_limited' };
    }
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  return { ok: true };
}

// ---------------------------------------------------------- validation

function toText(value, max) {
  if (Array.isArray(value)) return _clip(value.map((v) => String(v ?? '').trim()).filter(Boolean).join(', '), max);
  if (value && typeof value === 'object') return _clip(JSON.stringify(value), max);
  return _clip(value, max);
}

function validateBody(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const orgSlug = _clip(b.org_slug || b.orgSlug, 200).toLowerCase();
  if (!orgSlug) return { error: 'org_slug is required' };

  if (String(b.client_type ?? '').trim() !== 'new') {
    return { error: 'client_type must be "new"' };
  }
  const intakeId = _clip(b.intake_id, 200);
  if (!intakeId) return { error: 'intake_id is required' };
  if (!INTAKE_ID_RE.test(intakeId)) return { error: 'intake_id has invalid characters or length' };

  const email = _clip(b.contact_email, 254).toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return { error: 'a valid contact_email is required' };

  const businessName = _clip(b.business_name, 300);
  if (!businessName) return { error: 'business_name is required' };

  const contactName = _clip(b.contact_name, 200) || email.split('@')[0];

  return {
    value: {
      orgSlug,
      intakeId,
      email,
      businessName,
      contactName,
      phone: _clip(b.contact_phone, 50),
      businessType: toText(b.business_type, 200),
      goals: toText(b.goals, 1000),
      pagesWanted: toText(b.pages_wanted, 1000),
      brandNotes: toText(b.brand_notes, 1000),
      deadline: toText(b.deadline, 200),
      budgetRange: toText(b.budget_range, 200),
      source: _clip(b.source, 100) || 'intake',
      notes: _clip(b.notes, MAX_ANSWER_LEN),
      answers: _sanitizeAnswers(b.answers),
    },
  };
}

function ingestKey(email, intakeId) {
  return crypto.createHash('sha256').update(`${email}|${intakeId}`).digest('hex');
}

/** Add `n` business days (skipping Sat/Sun) to a date; returns YYYY-MM-DD (UTC). */
function addBusinessDays(from, n) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

function isEarlyClientContact(contact) {
  const tags = Array.isArray(contact?.tags) ? contact.tags.map((t) => String(t).toLowerCase()) : [];
  const ct = String(contact?.clientType || '').toLowerCase();
  return EARLY_CLIENT_MARKERS.some((m) => ct === m || tags.includes(`client_type=${m}`));
}

// -------------------------------------------------------- state change

function buildNoteText(v, ids) {
  const lines = [
    `Website intake ${v.intakeId} (source: ${v.source})`,
    `Business: ${v.businessName}${v.businessType ? ` (${v.businessType})` : ''}`,
    `Contact: ${v.contactName} <${v.email}>${v.phone ? `, ${v.phone}` : ''}`,
  ];
  if (v.goals) lines.push(`Goals: ${v.goals}`);
  if (v.pagesWanted) lines.push(`Pages wanted: ${v.pagesWanted}`);
  if (v.brandNotes) lines.push(`Brand: ${v.brandNotes}`);
  if (v.deadline) lines.push(`Deadline: ${v.deadline}`);
  if (v.budgetRange) lines.push(`Budget range: ${v.budgetRange}`);
  if (v.notes) lines.push(`Notes: ${v.notes}`);
  const answerKeys = Object.keys(v.answers);
  if (answerKeys.length) {
    lines.push('Answers:');
    for (const k of answerKeys) lines.push(`- ${k}: ${v.answers[k]}`);
  }
  if (ids) lines.push(`CRM ids: contact ${ids.contactId}, company ${ids.companyId}, deal ${ids.dealId}`);
  return lines.join('\n').slice(0, MAX_NOTE_LEN);
}

/**
 * Pure state transform. Strictly sequential: company -> contact -> deal ->
 * links -> task -> note -> audit, each id computed from the working copy.
 * @returns {{ok:true,duplicate:boolean,changed:boolean,state:object,ids:object}|{ok:false,status:number,error:string}}
 */
function applyIngest(prevState, v, now = new Date()) {
  const state = JSON.parse(JSON.stringify(prevState || {}));
  const key = ingestKey(v.email, v.intakeId);

  const companies = Array.isArray(state.companies) ? state.companies : [];
  const contacts = Array.isArray(state.contacts) ? state.contacts : [];
  const deals = Array.isArray(state.deals) ? state.deals : [];
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const notes = Array.isArray(state.notes) ? state.notes : [];

  // Idempotent retry: same key -> same ids, nothing written.
  const priorDeal = deals.find((d) => d && d.intakeKey === key);
  if (priorDeal) {
    const priorTask = tasks.find((t) => t && t.intakeKey === key);
    return {
      ok: true,
      duplicate: true,
      changed: false,
      state: prevState,
      ids: {
        contactId: priorDeal.contactId ?? null,
        companyId: priorDeal.companyId ?? null,
        dealId: priorDeal.id,
        taskId: priorTask?.id ?? null,
      },
    };
  }

  const today = now.toISOString().slice(0, 10);

  // 1. company
  let company = companies.find((c) => String(c?.name || '').trim().toLowerCase() === v.businessName.toLowerCase());
  if (!company) {
    company = {
      id: nextId(companies),
      name: v.businessName,
      domain: '',
      industry: v.businessType,
      size: '',
      mrr: 0,
      arr: 0,
      health: 'good',
      tags: ['intake'],
      website: '',
      notes: '',
      linkedContacts: [],
      linkedDeals: [],
    };
    companies.push(company);
  }

  // 2. contact (reuse by lowercased email)
  let contact = contacts.find((c) => String(c?.email || '').trim().toLowerCase() === v.email);
  if (contact && isEarlyClientContact(contact)) {
    return { ok: false, status: 409, error: 'existing_contact_is_not_a_new_client' };
  }
  if (!contact) {
    contact = {
      id: nextId(contacts),
      name: v.contactName,
      company: v.businessName,
      companyId: company.id,
      email: v.email,
      phone: v.phone,
      status: 'Prospect',
      tags: ['intake', 'client_type=new'],
      clientType: 'new',
      score: 60,
      lastContact: today,
      interactions: 1,
      leadSource: v.source,
      createdBy: 'Intake ingest',
    };
    contacts.push(contact);
  }

  // 3. deal
  const dealNotes = [
    v.budgetRange ? `Budget range: ${v.budgetRange}` : '',
    v.deadline ? `Deadline: ${v.deadline}` : '',
    `Intake: ${v.intakeId}`,
  ].filter(Boolean).join('\n').slice(0, 2000);
  const deal = {
    id: nextId(deals),
    title: `${v.businessName} website intake`.slice(0, 400),
    contact: contact.name,
    contactId: contact.id,
    company: company.name,
    companyId: company.id,
    value: 0,
    stage: 'New Intake',
    probability: 15,
    closeDate: new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10),
    daysInStage: 0,
    health: 'good',
    leadSource: v.source,
    notes: dealNotes,
    clientType: 'new',
    intakeKey: key,
    intakeId: v.intakeId,
    createdBy: 'Intake ingest',
    studioTaskIds: [],
  };
  deals.push(deal);

  // 4. link contact / deal / company
  const linkedContacts = Array.isArray(company.linkedContacts) ? company.linkedContacts : [];
  if (!linkedContacts.includes(contact.id)) linkedContacts.push(contact.id);
  company.linkedContacts = linkedContacts;
  const linkedDeals = Array.isArray(company.linkedDeals) ? company.linkedDeals : [];
  linkedDeals.push(deal.id);
  company.linkedDeals = linkedDeals;
  if (!contact.companyId) contact.companyId = company.id;

  // 5. task, due in 2 business days
  const task = {
    id: nextId(tasks),
    title: 'Review intake and send quote',
    contact: contact.name,
    contactId: contact.id,
    due: addBusinessDays(now, 2),
    priority: 'High',
    done: false,
    notes: `Website intake ${v.intakeId} for ${v.businessName}`.slice(0, 500),
    dealId: deal.id,
    assignee: null,
    createdBy: 'Intake ingest',
    intakeKey: key,
  };
  tasks.push(task);

  // 6. note with the full answers
  const ids = {
    contactId: contact.id, companyId: company.id, dealId: deal.id, taskId: task.id,
  };
  notes.unshift({
    id: nextId(notes),
    contact: contact.name,
    contactId: contact.id,
    text: buildNoteText(v, ids),
    date: today,
    type: 'intake',
    createdBy: 'Intake ingest',
    intakeKey: key,
  });

  // 7. audit log entry (same shape as the public intake)
  const auditLog = Array.isArray(state.auditLog) ? state.auditLog : [];
  auditLog.unshift({
    id: nextId(auditLog),
    user: 'Intake ingest',
    action: 'ingested',
    entity: 'intake',
    entityName: v.businessName,
    at: now.toISOString(),
  });

  state.companies = companies;
  state.contacts = contacts;
  state.deals = deals;
  state.tasks = tasks;
  state.notes = notes;
  state.auditLog = auditLog.slice(0, 500);
  return {
    ok: true, duplicate: false, changed: true, state, ids,
  };
}

// Serialize ingests per org inside this process so same-process retries never race.
const _orgQueues = new Map();
function withOrgLock(orgId, fn) {
  const prev = _orgQueues.get(orgId) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  _orgQueues.set(orgId, tail);
  tail.then(() => { if (_orgQueues.get(orgId) === tail) _orgQueues.delete(orgId); });
  return run;
}

/**
 * Token-authenticated ingest. Caller (route) must already have called authorize().
 * @param {object} body
 * @param {{clientKey?:string, now?:Date}} options
 */
async function ingestIntake(body, options = {}) {
  const parsed = validateBody(body);
  if (parsed.error) return { ok: false, status: 400, error: parsed.error };
  const v = parsed.value;

  const clientKey = String(options.clientKey || '').trim();
  if (clientKey && _recordHit(`ingest-ip:${clientKey}`) > RATE_MAX_PER_CLIENT) {
    return { ok: false, status: 429, error: 'rate_limited' };
  }

  const org = await denizenVisitor.resolveOrgBySlug(v.orgSlug);
  if (!org?.id) return { ok: false, status: 404, error: 'Organization not found' };
  if (_recordHit(`ingest-org:${org.id}`) > RATE_MAX_PER_ORG) {
    return { ok: false, status: 429, error: 'rate_limited' };
  }

  return withOrgLock(org.id, async () => {
    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
      const row = await crmStore.getWorkspace(org.id);
      const result = applyIngest(row?.state || {}, v, options.now || new Date());
      if (!result.ok) return result;
      const out = (ids) => ({
        ok: true,
        duplicate: result.duplicate,
        contact_id: ids.contactId,
        company_id: ids.companyId,
        deal_id: ids.dealId,
        task_id: ids.taskId,
      });
      if (!result.changed) return out(result.ids);

      const saved = await crmStore.upsertWorkspace(org.id, result.state, null, {
        ifUpdatedAt: row?.updated_at || null,
        actor: { user: 'Intake ingest', source: 'intake_ingest' },
        skipAutomations: true, // no automation-driven emails/tasks
        skipWebhooks: true,    // no outbound HTTP
      });
      if (!saved) return { ok: false, status: 503, error: 'storage_unavailable' };
      if (saved.conflict) continue; // reload and re-evaluate (idempotency key re-checked)
      return out(result.ids);
    }
    return { ok: false, status: 409, error: 'workspace_conflict_retry_later' };
  });
}

module.exports = {
  TOKEN_ENV,
  authorize,
  tokenMatches,
  validateBody,
  ingestKey,
  addBusinessDays,
  applyIngest,
  ingestIntake,
};
