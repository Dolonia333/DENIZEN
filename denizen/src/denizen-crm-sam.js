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

  return {
    ok: true,
    orgId,
    total: search.total,
    window: search.window,
    found: found.length,
    inserted,
    skippedExisting,
    skippedNoDueDate,
    errorCount: errors.length,
    errors: errors.slice(0, 10),
    items,
  };
}

module.exports = {
  mapOpportunityToRfp,
  ingestOpportunities,
};
