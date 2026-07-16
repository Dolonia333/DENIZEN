'use strict';

/**
 * Safe CRM agent write helpers (A-grade P3.1).
 * Controlled create note / log task / update deal stage with org policy checks.
 * Fail closed on missing org or denied business policy.
 */

const orgPolicy = require('./denizen-org-policy');
const crmMutations = require('./denizen-crm-mutations');
const crmStore = require('./denizen-crm-store');
const denizenDb = require('./denizen-db');

const AGENT_ACTION = {
  note: 'agent-note',
  task: 'agent-task',
  dealStage: 'agent-deal-stage',
};

function nextId(list) {
  const ids = (list || []).map((r) => Number(r?.id) || 0);
  return ids.length ? Math.max(...ids) + 1 : Date.now();
}

function fail(error, code) {
  const msg = String(error || 'unknown_error');
  return {
    ok: false,
    error: msg,
    summary: msg,
    ...(code ? { code } : {}),
  };
}

function okResult(id, extra = {}) {
  return { ok: true, id, ...extra };
}

/**
 * Resolve org slug → org UUID. Fail closed (null) when unavailable.
 */
async function resolveOrgId(orgSlug) {
  const slug = String(orgSlug || '').trim().toLowerCase();
  if (!slug) return null;

  try {
    const visitor = require('./denizen-visitor');
    const org = await visitor.resolveOrgBySlug(slug);
    if (org?.id) return org.id;
  } catch (_) {
    /* DB disabled or lookup failed — try soft path below */
  }

  if (!denizenDb.enabled) return null;
  try {
    const rows = await denizenDb._get(
      `denizen_organizations?select=id,slug&slug=eq.${encodeURIComponent(slug)}&limit=1`,
    );
    return rows?.[0]?.id || null;
  } catch (_) {
    return null;
  }
}

/**
 * Policy + org gate for agent writes. Throws with code on denial/missing org slug.
 */
async function assertAgentWriteAllowed(orgSlug, action) {
  const slug = String(orgSlug || '').trim();
  if (!slug) {
    const err = new Error('org_slug required');
    err.code = 'MISSING_ORG';
    throw err;
  }

  // Fail closed: demo / sandboxed orgs cannot write business CRM data.
  const policy = await orgPolicy.getOrgPolicy(slug);
  if (policy.allow_business_data === false) {
    const err = new Error(
      `Business data access disabled for org "${slug}" (tier=${policy.tier})`,
    );
    err.code = 'ORG_POLICY_DENIED';
    throw err;
  }

  // Honor registered BUSINESS_ACTIONS when present (no-op for unlisted actions).
  await orgPolicy.assertBusinessActionAllowed(slug, action);
}

function findContactName(state, contactId) {
  if (contactId == null || contactId === '') return null;
  const contacts = Array.isArray(state.contacts) ? state.contacts : [];
  const c = contacts.find((row) => String(row?.id) === String(contactId));
  return c?.name || null;
}

function findDealTitle(state, dealId) {
  if (dealId == null || dealId === '') return null;
  const deals = Array.isArray(state.deals) ? state.deals : [];
  const d = deals.find((row) => String(row?.id) === String(dealId));
  return d?.title || null;
}

/**
 * Create a CRM note from an agent.
 * @param {{ orgSlug: string, npcName: string, contactId?: *, dealId?: *, body: string, identityId?: string }} opts
 * @returns {Promise<{ ok: boolean, error?: string, id?: *, summary?: string }>}
 */
async function createNote(opts = {}) {
  try {
    const {
      orgSlug,
      npcName,
      contactId,
      dealId,
      body,
      identityId = null,
    } = opts;

    const text = String(body || '').trim();
    if (!text) return fail('body required', 'VALIDATION');
    const agent = String(npcName || '').trim();
    if (!agent) return fail('npcName required', 'VALIDATION');

    await assertAgentWriteAllowed(orgSlug, AGENT_ACTION.note);

    const orgId = await resolveOrgId(orgSlug);
    if (!orgId) return fail('organization not found', 'MISSING_ORG');

    const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
    const contactName = findContactName(state, contactId)
      || (dealId != null ? findDealTitle(state, dealId) : null)
      || 'General';
    const notes = Array.isArray(state.notes) ? [...state.notes] : [];
    const note = {
      id: nextId(notes),
      contact: contactName,
      text: text.slice(0, 2000),
      date: new Date().toISOString().slice(0, 10),
      type: 'agent-note',
      author: agent,
      ...(contactId != null && contactId !== '' ? { contactId } : {}),
      ...(dealId != null && dealId !== '' ? { dealId } : {}),
    };
    notes.unshift(note);
    const saved = await crmStore.upsertWorkspace(
      orgId,
      { ...state, notes },
      identityId,
      { ifUpdatedAt },
    );
    if (!saved) {
      return fail('CRM workspace unavailable', 'STORE_UNAVAILABLE');
    }
    if (saved.conflict) {
      return fail('CRM workspace conflict — retry', 'CONFLICT');
    }

    return okResult(note.id, {
      summary: `Logged note for ${contactName}: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`,
      note,
    });
  } catch (err) {
    return fail(err.message, err.code || 'ERROR');
  }
}

/**
 * Log a CRM task from an agent.
 * @param {{ orgSlug: string, npcName: string, title: string, dueAt?: string, identityId?: string }} opts
 * @returns {Promise<{ ok: boolean, error?: string, id?: *, summary?: string }>}
 */
async function logTask(opts = {}) {
  try {
    const {
      orgSlug,
      npcName,
      title,
      dueAt,
      identityId = null,
    } = opts;

    const taskTitle = String(title || '').trim();
    if (!taskTitle) return fail('title required', 'VALIDATION');
    const agent = String(npcName || '').trim();
    if (!agent) return fail('npcName required', 'VALIDATION');

    await assertAgentWriteAllowed(orgSlug, AGENT_ACTION.task);

    const orgId = await resolveOrgId(orgSlug);
    if (!orgId) return fail('organization not found', 'MISSING_ORG');

    let due;
    if (dueAt != null && String(dueAt).trim()) {
      const d = new Date(dueAt);
      if (Number.isNaN(d.getTime())) return fail('dueAt invalid', 'VALIDATION');
      due = d.toISOString().slice(0, 10);
    }

    const result = await crmMutations.addTask(
      orgId,
      {
        title: taskTitle,
        ...(due ? { due } : {}),
        notes: `Logged by agent ${agent}`,
        priority: 'Medium',
      },
      identityId,
    );
    if (!result?.task) return fail('task create failed', 'ERROR');

    // Fail closed when persistence is unavailable (DB off + unmocked store).
    if (!denizenDb.enabled) {
      const row = await crmStore.getWorkspace(orgId);
      if (!row) return fail('CRM workspace unavailable', 'STORE_UNAVAILABLE');
    }

    return okResult(result.task.id, {
      summary: result.summary || `Added task "${taskTitle}".`,
      task: result.task,
    });
  } catch (err) {
    return fail(err.message, err.code || 'ERROR');
  }
}

/**
 * Update deal stage via existing safe mutation (updateDeal / moveDeal path).
 * @param {{ orgSlug: string, dealId: *, stage: string, npcName: string, identityId?: string }} opts
 * @returns {Promise<{ ok: boolean, error?: string, id?: *, summary?: string }>}
 */
async function updateDealStage(opts = {}) {
  try {
    const {
      orgSlug,
      dealId,
      stage,
      npcName,
      identityId = null,
    } = opts;

    if (dealId == null || dealId === '') return fail('dealId required', 'VALIDATION');
    const nextStage = String(stage || '').trim();
    if (!nextStage) return fail('stage required', 'VALIDATION');
    const agent = String(npcName || '').trim();
    if (!agent) return fail('npcName required', 'VALIDATION');

    await assertAgentWriteAllowed(orgSlug, AGENT_ACTION.dealStage);

    const orgId = await resolveOrgId(orgSlug);
    if (!orgId) return fail('organization not found', 'MISSING_ORG');

    // Safe existing mutation: denizen-crm-mutations.updateDeal (also used by moveDeal).
    const result = await crmMutations.updateDeal(
      orgId,
      { dealId, stage: nextStage },
      identityId,
    );

    return okResult(result.deal?.id ?? dealId, {
      summary: result.summary
        || `Updated deal stage → ${nextStage} (by ${agent}).`,
      deal: result.deal,
      previousStage: result.previousStage,
    });
  } catch (err) {
    const msg = err.message || 'update_deal_stage_failed';
    // Surface not-found cleanly; do not invent a stub when mutation exists.
    if (/not found/i.test(msg)) {
      return fail(msg, 'NOT_FOUND');
    }
    return fail(msg, err.code || 'ERROR');
  }
}

module.exports = {
  AGENT_ACTION,
  createNote,
  logTask,
  updateDealStage,
  resolveOrgId,
  assertAgentWriteAllowed,
};
