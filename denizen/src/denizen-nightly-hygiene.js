'use strict';

/**
 * Nightly (and on-demand) hygiene runner — the unattended company loop.
 *
 * 1) Park scrape/SAM deals that lack a human + next-verb task
 * 2) Expire stale NPC directives
 * 3) Write one outcome receipt (so morning standup > 0)
 */

const crmStore = require('./denizen-crm-store');
const workingSet = require('./denizen-crm-working-set');
const outcomeLedger = require('./denizen-outcome-ledger');

const DEFAULT_DIRECTIVE_TTL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.DENIZEN_DIRECTIVE_TTL_MS) || 36 * 60 * 60 * 1000,
);

function hasHumanContact(deal, contacts) {
  const name = String(deal?.contact || '').trim().toLowerCase();
  if (!name) return false;
  // Agency-only scrape names (no email match) don't count as a human
  const hit = (contacts || []).find((c) => {
    const cn = String(c?.name || '').trim().toLowerCase();
    const email = String(c?.email || '').trim();
    return cn && cn === name && email.includes('@');
  });
  return Boolean(hit);
}

function hasNextVerbTask(deal, tasks) {
  const dealId = deal?.id;
  const title = String(deal?.title || '').toLowerCase();
  return (tasks || []).some((t) => {
    if (!workingSet.isOpenTask(t)) return false;
    if (dealId != null && String(t.dealId) === String(dealId)) return true;
    const tt = String(t.title || '').toLowerCase();
    return title && tt.includes(title.slice(0, 24));
  });
}

function isScrapeLikeDeal(d) {
  if (!d) return false;
  if (d.samGovId || d.sam_gov_id) return true;
  if (String(d.source || '').toLowerCase() === 'sam_gov') return true;
  const tags = (d.tags || []).map((t) => String(t).toLowerCase());
  if (tags.includes('federal-rfp') || tags.includes('sam-scrape')) return true;
  const stage = String(d.stage || '').toLowerCase();
  if (stage.includes('rfp') && !hasHumanHint(d)) return true;
  return false;
}

function hasHumanHint(d) {
  const c = String(d.contact || '').trim();
  if (!c) return false;
  // Pure agency strings often look like "Department of …"
  if (/department|agency|office of|administration|bureau/i.test(c) && !/@/.test(c)) return false;
  return true;
}

function parkFields() {
  return {
    status: 'watchlist',
    stage: 'Watch / Research',
    value: 0,
    tags: ['federal-rfp', 'watchlist', 'not-pipeline', 'parked-by-hygiene'],
  };
}

/**
 * @param {{ orgId: string, npcBrains?: object, log?: Console }} opts
 */
async function runNightlyHygiene(opts = {}) {
  const log = opts.log || console;
  const orgId = opts.orgId;
  if (!orgId) return { ok: false, error: 'orgId required' };

  const row = await crmStore.getWorkspace(orgId);
  const state = row?.state || {};
  const deals = Array.isArray(state.deals) ? [...state.deals] : [];
  const contacts = Array.isArray(state.contacts) ? state.contacts : [];
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];

  const parked = [];
  for (let i = 0; i < deals.length; i++) {
    const d = deals[i];
    if (workingSet.isClosedDeal(d) || workingSet.isExpiredDeal(d)) continue;
    // Already fully parked (status/hygiene tag) — not just federal-rfp research tags
    const status = String(d?.status || '').toLowerCase();
    const tags = (d?.tags || []).map((t) => String(t).toLowerCase());
    if (status === 'watchlist' || status === 'parked' || tags.includes('parked-by-hygiene')) continue;
    if (!isScrapeLikeDeal(d)) continue;
    const human = hasHumanContact(d, contacts);
    const next = hasNextVerbTask(d, tasks);
    if (human && next) continue; // keep — real pursuit
    const fields = parkFields();
    const nextTags = [...new Set([...(d.tags || []), ...fields.tags])];
    deals[i] = {
      ...d,
      status: fields.status,
      stage: fields.stage,
      value: 0,
      tags: nextTags,
      parkedAt: new Date().toISOString(),
      parkReason: !human ? 'no-human-contact' : 'no-next-verb-task',
    };
    parked.push({ id: d.id, title: d.title, reason: deals[i].parkReason });
  }

  let workspaceChanged = parked.length > 0;
  if (workspaceChanged) {
    await crmStore.upsertWorkspace(orgId, { ...state, deals }, null, { skipAutomations: true });
  }

  let expired = [];
  if (opts.npcBrains?.expireStaleDirectives) {
    expired = opts.npcBrains.expireStaleDirectives(opts.directiveTtlMs || DEFAULT_DIRECTIVE_TTL_MS) || [];
  }

  const receipt = outcomeLedger.appendOutcome({
    org_id: orgId,
    actor: 'nightly-hygiene',
    outcome_type: 'hygiene.nightly',
    entity_type: 'crm_workspace',
    entity_key: String(orgId),
    value_text: `Parked ${parked.length} scrape deal(s); expired ${expired.length} directive(s).`,
    value_json: {
      parked_deal_ids: parked.map((p) => p.id),
      parked,
      expired_directives: expired,
      receipt: true,
    },
    source: 'denizen-nightly-hygiene',
    pass: true,
  });

  const msg = `[hygiene] parked=${parked.length} expired_directives=${expired.length} outcome=${receipt.id}`;
  if (typeof log.info === 'function') log.info('Hygiene', msg);
  else log.log?.(msg);

  return {
    ok: true,
    parked_count: parked.length,
    parked,
    expired_count: expired.length,
    expired,
    outcome: receipt,
    workspace_changed: workspaceChanged,
  };
}

module.exports = {
  runNightlyHygiene,
  isScrapeLikeDeal,
  hasHumanContact,
  hasNextVerbTask,
  DEFAULT_DIRECTIVE_TTL_MS,
};
