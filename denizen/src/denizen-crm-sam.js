'use strict';
/**
 * denizen-crm-sam.js — bridge SAM.gov opportunities into the federal RFP pipeline.
 *
 * Inserts each opportunity as a row in the `rfps` business table. That single
 * insert is enough: DB triggers (20260606000006_outcome_triggers.sql) then
 * create the entity-registry row, emit the `rfp.ingested` fact, and generate a
 * bid-probability prediction. We deliberately do NOT hand-write those.
 *
 * `rfps` required (NOT NULL) columns: agency, title, proposal_due_date.
 * We match the existing seed row's conventions: status 'new', source_type
 * 'sam_gov', and use the sam_gov_id column for idempotent dedup.
 */

const denizenDb = require('./denizen-db');
const samGov = require('./denizen-sam-gov');
const crmStore = require('./denizen-crm-store');

/**
 * `rfps.set_aside_type` has a CHECK constraint. Confirmed-allowed tokens:
 *   8a, sdvosb, wosb, edwosb, hubzone, small_business, none (+ null).
 * SAM.gov's typeOfSetAside codes are richer than that, so map the code to the
 * nearest allowed token and keep the exact SAM label in `description`. Anything
 * that is a set-aside but doesn't map cleanly becomes small_business (it always
 * is one); no code at all becomes none.
 */
function mapSetAside(code) {
  const c = String(code || '').toUpperCase();
  if (!c) return 'none';
  if (c.startsWith('8A')) return '8a';
  if (c.startsWith('HZ')) return 'hubzone';
  if (c.startsWith('SDVOSB')) return 'sdvosb';
  if (c.startsWith('EDWOSB')) return 'edwosb';   // before WOSB — EDWOSB contains WOSB
  if (c.startsWith('WOSB')) return 'wosb';
  return 'small_business';
}

/** SAM gives responseDeadLine as an ISO datetime; the column is a DATE. */
function toDate(v) {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Map a normalized opportunity → an `rfps` row. Returns null if it can't
 * satisfy the NOT-NULL columns (no usable due date), so the caller can skip it
 * rather than fabricate a deadline that would poison the bid prediction.
 */
function mapOpportunityToRfp(opp, orgId) {
  const proposalDue = toDate(opp.responseDeadline) || toDate(opp.archiveDate);
  if (!proposalDue) return null;
  const naics = [];
  if (opp.naicsCode) naics.push(String(opp.naicsCode));
  if (Array.isArray(opp.raw && opp.raw.naicsCodes)) {
    for (const c of opp.raw.naicsCodes) if (c && !naics.includes(String(c))) naics.push(String(c));
  }
  const row = {
    title: (opp.title || opp.solicitationNumber || 'Untitled SAM.gov opportunity').slice(0, 500),
    agency: opp.agency || 'Unknown agency',
    solicitation_number: opp.solicitationNumber || null,
    sam_gov_id: opp.noticeId || null,
    description: opp.setAsideLabel
      ? `${opp.setAsideLabel}${opp.placeOfPerformance ? ` — ${opp.placeOfPerformance}` : ''}`
      : (opp.placeOfPerformance || null),
    naics_codes: naics.length ? naics : null,
    set_aside_type: mapSetAside(opp.setAside),     // constrained column; label kept in description
    posted_date: toDate(opp.postedDate),
    proposal_due_date: proposalDue,
    status: 'new',
    source_type: 'sam_gov',
    source_url: opp.samUrl || null,
  };
  if (orgId) row.org_id = orgId;
  return row;
}

/** Which of these notice ids already exist as rfps (dedup, batched). */
async function existingSamIds(noticeIds) {
  const ids = noticeIds.filter(Boolean);
  if (!ids.length || !denizenDb.enabled) return new Set();
  const quoted = ids.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',');
  const rows = await denizenDb
    ._get(`rfps?select=sam_gov_id&sam_gov_id=in.(${encodeURIComponent(quoted)})`)
    .catch(() => []);
  return new Set((rows || []).map((r) => r.sam_gov_id).filter(Boolean));
}

/**
 * Search SAM.gov and ingest new opportunities into the RFP pipeline.
 * Idempotent: an opportunity already present (by sam_gov_id) is skipped.
 * Each insert is independent so one bad row can't sink the batch.
 * @returns summary { ok, found, total, window, inserted, skippedExisting,
 *                    skippedNoDueDate, errors, items }
 */
async function ingestOpportunities(opts = {}) {
  if (!samGov.hasKey()) {
    return { ok: false, error: 'SAM_GOV_API_KEY is not set', code: 'NO_SAM_KEY' };
  }
  if (!denizenDb.enabled) {
    return { ok: false, error: 'Database is not configured', code: 'NO_DB' };
  }
  const orgId = opts.orgId || denizenDb.orgId || null;

  const search = await samGov.searchOpportunities(opts);
  const found = search.opportunities;
  const seen = await existingSamIds(found.map((o) => o.noticeId));

  const items = [];
  let inserted = 0;
  let skippedExisting = 0;
  let skippedNoDueDate = 0;
  const errors = [];

  for (const opp of found) {
    if (opp.noticeId && seen.has(opp.noticeId)) {
      skippedExisting += 1;
      items.push({ noticeId: opp.noticeId, title: opp.title, outcome: 'exists' });
      continue;
    }
    const row = mapOpportunityToRfp(opp, orgId);
    if (!row) {
      skippedNoDueDate += 1;
      items.push({ noticeId: opp.noticeId, title: opp.title, outcome: 'no_due_date' });
      continue;
    }
    try {
      const out = await denizenDb._post('rfps', row, {
        prefer: 'return=representation',
      });
      const rfpId = Array.isArray(out) ? out[0]?.id : out?.id;
      inserted += 1;
      items.push({ noticeId: opp.noticeId, title: opp.title, outcome: 'inserted', rfpId: rfpId || null });
    } catch (err) {
      errors.push({ noticeId: opp.noticeId, error: err?.message || String(err) });
      items.push({ noticeId: opp.noticeId, title: opp.title, outcome: 'error' });
    }
  }

  // Mirror into the phone CRM deal board. Operates on every found opportunity
  // that made it into `rfps` (inserted now OR already present), so a first run
  // that predates mirroring gets backfilled. Dedup is by samGovId on the deals.
  let mirroredDeals = null;
  let skippedExistingDeals = null;
  if (opts.mirrorToDeals && orgId) {
    try {
      const m = await mirrorOpportunitiesToDeals(orgId, found);
      mirroredDeals = m.mirrored;
      skippedExistingDeals = m.skippedExistingDeals;
      if (m.conflict) errors.push({ stage: 'mirror', error: 'workspace write conflict (retried)' });
    } catch (err) {
      errors.push({ stage: 'mirror', error: err && err.message ? err.message : String(err) });
    }
  }

  return {
    ok: true,
    orgId,
    total: search.total,
    window: search.window,
    found: found.length,
    inserted,
    skippedExisting,
    skippedNoDueDate,
    mirroredDeals,
    skippedExistingDeals,
    errorCount: errors.length,
    errors: errors.slice(0, 10),
    items,
  };
}

/** Max(id)+1, recomputed after each push (empty array → Date.now(), which would
 *  collide if precomputed for a batch). */
function nextDealId(deals) {
  const ids = (deals || []).map((d) => Number(d && d.id) || 0);
  return ids.length ? Math.max(...ids) + 1 : Date.now();
}

/** noticeId → rfp uuid, for the opportunities that exist in `rfps`. */
async function rfpIdsBySamId(noticeIds) {
  const ids = noticeIds.filter(Boolean);
  const out = new Map();
  if (!ids.length || !denizenDb.enabled) return out;
  const quoted = ids.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',');
  const rows = await denizenDb
    ._get(`rfps?select=id,sam_gov_id&sam_gov_id=in.(${encodeURIComponent(quoted)})`)
    .catch(() => []);
  for (const r of rows || []) if (r.sam_gov_id) out.set(r.sam_gov_id, r.id);
  return out;
}

/** rfp uuid → bid probability (0..1). Trigger writes prediction.bid_probability. */
async function bidProbByRfpId(rfpIds) {
  const ids = rfpIds.filter(Boolean);
  const out = new Map();
  if (!ids.length || !denizenDb.enabled) return out;
  const quoted = ids.map((id) => `"${id}"`).join(',');
  const rows = await denizenDb
    ._get(`denizen_predictions?select=entity_id,prediction,confidence,created_at`
      + `&entity_type=eq.rfp&prediction_type=eq.rfp.bid_probability`
      + `&entity_id=in.(${encodeURIComponent(quoted)})&order=created_at.desc`)
    .catch(() => []);
  for (const r of rows || []) {
    if (out.has(r.entity_id)) continue;          // first seen = newest
    const p = r.prediction && (r.prediction.bid_probability ?? r.prediction.close_probability);
    const val = p != null ? p : r.confidence;
    if (val != null && Number.isFinite(Number(val))) out.set(r.entity_id, Number(val));
  }
  return out;
}

function opportunityToDeal(opp, deals, rfpId, prob) {
  const due = toDate(opp.responseDeadline) || toDate(opp.archiveDate);
  return {
    id: nextDealId(deals),
    title: (opp.title || opp.solicitationNumber || 'SAM.gov opportunity').slice(0, 300),
    contact: String(opp.contactName || opp.agency || '').slice(0, 200),
    value: 0,                                    // dollar value unknown from search
    stage: 'RFP Released',                       // real GovCon pipeline stage
    probability: (prob != null && Number.isFinite(prob)) ? Math.round(prob * 100) : 30,
    closeDate: due || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    daysInStage: 0,
    health: 'good',
    // custom fields (survive sanitizeState) — traceability + dedup
    source: 'sam_gov',
    samGovId: opp.noticeId || null,
    solicitationNumber: opp.solicitationNumber || null,
    naics: opp.naicsCode || null,
    setAside: opp.setAside || null,
    rfpId: rfpId || null,
    samUrl: opp.samUrl || null,
  };
}

/**
 * Batch-append deals for the given opportunities (one workspace read + one
 * write, per the store's optimistic-concurrency contract). Retries once on a
 * concurrent-write conflict.
 */
async function mirrorOpportunitiesToDeals(orgId, opps) {
  if (!orgId || !denizenDb.enabled) return { mirrored: 0, skippedExistingDeals: 0, conflict: false };
  const noticeIds = opps.map((o) => o.noticeId).filter(Boolean);
  const samToRfp = await rfpIdsBySamId(noticeIds);
  const probByRfp = await bidProbByRfpId([...new Set(samToRfp.values())]);

  const attempt = async () => {
    const ws = await crmStore.getWorkspace(orgId);
    const state = (ws && ws.state) || {};
    const updatedAt = ws && ws.updated_at;
    const deals = Array.isArray(state.deals) ? [...state.deals] : [];
    const haveSam = new Set(deals.map((d) => d && d.samGovId).filter(Boolean));
    let mirrored = 0;
    let skipped = 0;
    for (const opp of opps) {
      const rfpId = opp.noticeId ? samToRfp.get(opp.noticeId) : null;
      if (!rfpId) continue;                        // only mirror opps that reached rfps
      if (opp.noticeId && haveSam.has(opp.noticeId)) { skipped += 1; continue; }
      deals.push(opportunityToDeal(opp, deals, rfpId, probByRfp.get(rfpId)));
      if (opp.noticeId) haveSam.add(opp.noticeId);
      mirrored += 1;
    }
    if (!mirrored) return { mirrored: 0, skippedExistingDeals: skipped, conflict: false };
    const res = await crmStore.upsertWorkspace(orgId, { ...state, deals }, null, { ifUpdatedAt: updatedAt });
    if (res && res.conflict) return { conflict: true };
    return { mirrored, skippedExistingDeals: skipped, conflict: false };
  };

  let r = await attempt();
  if (r.conflict) r = await attempt();             // one retry
  if (r.conflict) return { mirrored: 0, skippedExistingDeals: 0, conflict: true };
  return r;
}

/**
 * Nightly auto-ingest. Default ON when a key + DB are present; disable with
 * SAM_GOV_AUTO_INGEST=0. Runs every SAM_GOV_AUTO_INGEST_MS (default 24h, min
 * 1h), pulling the last SAM_GOV_AUTO_INGEST_DAYS (default 2 — daily run plus
 * overlap so a missed night is caught; dedup handles the repeats). Uses the
 * env NAICS/set-aside defaults, active opportunities only, and mirrors into the
 * CRM deal board.
 */
function startAutoIngest({ log } = {}) {
  const info = (m) => { try { (log && log.info ? log.info : console.log)('SAM', m); } catch (_) {} };
  const warn = (m) => { try { (log && log.warn ? log.warn : console.warn)('SAM', m); } catch (_) {} };

  if (process.env.SAM_GOV_AUTO_INGEST === '0') {
    info('auto-ingest disabled (SAM_GOV_AUTO_INGEST=0)');
    return { stop() {} };
  }
  const intervalMs = Math.max(60 * 60 * 1000, Number(process.env.SAM_GOV_AUTO_INGEST_MS) || 24 * 60 * 60 * 1000);
  const days = Math.max(1, Number(process.env.SAM_GOV_AUTO_INGEST_DAYS) || 2);
  const limit = Math.max(1, Number(process.env.SAM_GOV_AUTO_INGEST_LIMIT) || 20);

  let running = false;
  const run = async () => {
    if (running) return;               // never overlap two runs
    if (!samGov.hasKey() || !denizenDb.enabled) return;   // wait until configured
    running = true;
    try {
      const r = await ingestOpportunities({ days, limit, activeOnly: true, mirrorToDeals: true });
      if (r && r.ok) {
        info(`auto-ingest: found ${r.found}, inserted ${r.inserted}, existing ${r.skippedExisting}`
          + (r.mirroredDeals != null ? `, deals +${r.mirroredDeals}` : '')
          + (r.errorCount ? `, errors ${r.errorCount}` : ''));
      } else if (r) {
        warn(`auto-ingest skipped: ${r.error || 'unknown'}`);
      }
    } catch (err) {
      warn(`auto-ingest failed: ${err && err.message ? err.message : err}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(run, intervalMs);
  if (timer.unref) timer.unref();
  const bootMs = Math.max(10_000, Number(process.env.SAM_GOV_AUTO_INGEST_BOOT_MS) || 3 * 60 * 1000);
  const boot = setTimeout(run, bootMs);
  if (boot.unref) boot.unref();
  info(`auto-ingest scheduled every ${Math.round(intervalMs / 3_600_000)}h (lookback ${days}d, first run in ${Math.round(bootMs / 1000)}s)`);
  return { stop() { clearInterval(timer); clearTimeout(boot); } };
}

module.exports = {
  mapOpportunityToRfp,
  ingestOpportunities,
  startAutoIngest,
};
