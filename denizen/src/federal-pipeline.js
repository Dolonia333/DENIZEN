'use strict';

/**
 * Federal RFP pipeline reads.
 *
 * Every `rfps` read here MUST be org-scoped. The Supabase instance is shared by
 * every organization (zion, acme, and each Discord guild org), and these
 * queries run under the service-role key, so an unfiltered read returns every
 * tenant's pipeline. `getRfpPipelineSummary` previously passed `filters: {}`
 * and `getRfpDetail` filtered on `id` alone — dossier defect G#5.
 *
 * Callers therefore pass `orgId` explicitly. It is deliberately NOT defaulted
 * to `denizenDb.orgId`: the briefing path serves per-session orgs, and a silent
 * global default is exactly how the leak would come back.
 */

class FederalPipelineError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FederalPipelineError';
    this.code = code;
  }
}

function _requireOrgId(orgId, fnName) {
  const id = orgId == null ? '' : String(orgId).trim();
  if (!id) {
    throw new FederalPipelineError(
      `${fnName} requires options.orgId — refusing to read rfps unscoped`,
      'ORG_ID_REQUIRED',
    );
  }
  return id;
}

const COMPLETED_REQUIREMENT_STATUSES = new Set([
  'complete',
  'completed',
  'done',
  'met',
  'compliant',
  'addressed',
]);

function _toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function _isCompleteStatus(status) {
  return COMPLETED_REQUIREMENT_STATUSES.has(String(status || '').toLowerCase());
}

function _isMandatoryRequirement(req) {
  const type = String(req?.requirement_type || '').toLowerCase();
  const priority = String(req?.priority || '').toLowerCase();
  return type.includes('mandatory') || type === 'must' || priority === 'must';
}

function _daysToDue(dateLike, nowMs = Date.now()) {
  if (!dateLike) return null;
  const dueMs = new Date(dateLike).getTime();
  if (!Number.isFinite(dueMs)) return null;
  return Math.ceil((dueMs - nowMs) / 86400000);
}

function _groupByStatus(rows) {
  const grouped = {};
  for (const row of rows || []) {
    const key = String(row?.status || 'unknown').toLowerCase();
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  }
  return grouped;
}

function _latestPredictionsByEntity(rows) {
  const out = {};
  for (const row of rows || []) {
    const id = row?.entity_id;
    if (!id) continue;
    const prev = out[id];
    if (!prev) {
      out[id] = row;
      continue;
    }
    const prevTs = new Date(prev.created_at || 0).getTime();
    const nextTs = new Date(row.created_at || 0).getTime();
    if (nextTs >= prevTs) out[id] = row;
  }
  return out;
}

function _extractBidProbability(predictionRow) {
  if (!predictionRow) return null;
  const p = predictionRow.prediction || {};
  const value = p.bid_probability ?? p.close_probability ?? predictionRow.confidence;
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function _buildRestPath({ table, select, filters, order, limit }) {
  const parts = [];
  const cols = Array.isArray(select) && select.length ? select.join(',') : '*';
  parts.push(`select=${encodeURIComponent(cols)}`);
  if (filters && typeof filters === 'object') {
    for (const [field, ops] of Object.entries(filters)) {
      if (!ops || typeof ops !== 'object') continue;
      if (Object.prototype.hasOwnProperty.call(ops, 'eq')) {
        parts.push(`${field}=eq.${encodeURIComponent(String(ops.eq))}`);
      } else if (Object.prototype.hasOwnProperty.call(ops, 'in')) {
        const values = Array.isArray(ops.in) ? ops.in : [ops.in];
        const encoded = values.map((v) => encodeURIComponent(String(v))).join(',');
        parts.push(`${field}=in.(${encoded})`);
      } else if (Object.prototype.hasOwnProperty.call(ops, 'gte')) {
        parts.push(`${field}=gte.${encodeURIComponent(String(ops.gte))}`);
      } else if (Object.prototype.hasOwnProperty.call(ops, 'lte')) {
        parts.push(`${field}=lte.${encodeURIComponent(String(ops.lte))}`);
      }
    }
  }
  if (order && typeof order === 'object') {
    const [field, dirRaw] = Object.entries(order)[0] || [];
    if (field) {
      const dir = String(dirRaw || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
      parts.push(`order=${encodeURIComponent(`${field}.${dir}`)}`);
    }
  }
  if (limit != null) parts.push(`limit=${encodeURIComponent(String(limit))}`);
  return `${table}?${parts.join('&')}`;
}

async function _query(db, query) {
  if (db && typeof db.query === 'function') {
    return db.query(query);
  }
  if (db && typeof db.bridgeQuery === 'function') {
    return db.bridgeQuery(query);
  }
  if (db && typeof db._get === 'function') {
    return db._get(_buildRestPath(query));
  }
  throw new Error('federal-pipeline db adapter requires query(), bridgeQuery(), or _get()');
}

/**
 * Run a query whose org filter is load-bearing, and fail CLOSED if the backend
 * rejects it.
 *
 * `rfps.org_id` is added by migration `20260606000005_platform_org_bridge.sql`,
 * which `infra/apply-migrations-nas.py` currently hard-skips (dossier G#7). On
 * a database where that migration has not run, PostgREST answers the scoped
 * query with a 400. The only safe response is to surface that as an error —
 * retrying without the filter would hand back every tenant's rows, which is
 * the exact bug this scoping exists to prevent.
 */
async function _queryOrgScoped(db, query) {
  try {
    return await _query(db, query);
  } catch (err) {
    const message = String(err?.message || err);
    if (/HTTP\s+4\d\d/.test(message)) {
      throw new FederalPipelineError(
        `org-scoped read of "${query.table}" was rejected by the database (${message}). `
        + 'This usually means migration 20260606000005 (which adds org_id to the platform '
        + 'tables) has not been applied. Not falling back to an unscoped read.',
        'ORG_SCOPE_UNAVAILABLE',
      );
    }
    throw err;
  }
}

async function _loadLatestPredictions(db, rfpIds, orgId) {
  if (!rfpIds.length) return {};
  const rows = await _query(db, {
    table: 'denizen_predictions',
    select: ['entity_id', 'prediction', 'confidence', 'created_at'],
    filters: {
      // Redundant with the rfp ids (which are already org-scoped) but cheap:
      // denizen_predictions carries org_id from migration ...0004, and a
      // defence-in-depth filter here means one bad id list cannot cross orgs.
      org_id: { eq: orgId },
      entity_type: { eq: 'rfp' },
      // Stored type is 'rfp.bid_probability' (trigger denizen_predict_rfp_bid);
      // the old 'rfp.bid' matched nothing, so bid-probability enrichment here
      // silently returned null for every RFP.
      prediction_type: { eq: 'rfp.bid_probability' },
      entity_id: { in: rfpIds },
    },
    order: { created_at: 'desc' },
    limit: Math.max(25, rfpIds.length * 4),
  });
  return _latestPredictionsByEntity(rows || []);
}

// `rfp_requirements` has no org_id column (migration ...0005 scopes the parent
// tables only), so it is scoped transitively: every id in `rfpIds` has already
// been proven to belong to the caller's org by the rfps query above.
async function _loadRequirementsByRfp(db, rfpIds, limit = 1000) {
  if (!rfpIds.length) return {};
  const rows = await _query(db, {
    table: 'rfp_requirements',
    select: [
      'id',
      'rfp_id',
      'section_reference',
      'requirement_type',
      'priority',
      'risk_level',
      'status',
      'requirement_text',
    ],
    filters: { rfp_id: { in: rfpIds } },
    order: { priority: 'desc' },
    limit,
  });
  const grouped = {};
  for (const row of rows || []) {
    const key = row?.rfp_id;
    if (!key) continue;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  }
  return grouped;
}

function _buildRfpMetrics(rfp, requirements, predictionByEntity, nowMs = Date.now()) {
  const reqs = requirements || [];
  const totalRequirements = reqs.length;
  const completedRequirements = reqs.filter((r) => _isCompleteStatus(r.status)).length;
  const requirementCompletionPct = totalRequirements > 0
    ? Math.round((completedRequirements / totalRequirements) * 100)
    : 0;
  const groupedRequirements = _groupByStatus(reqs);
  const unmetMandatoryRequirements = reqs.filter(
    (r) => _isMandatoryRequirement(r) && !_isCompleteStatus(r.status),
  );
  const bidProbability = _extractBidProbability(predictionByEntity?.[rfp.id]);
  const daysToDue = _daysToDue(rfp?.proposal_due_date, nowMs);

  return {
    ...rfp,
    bid_probability: bidProbability,
    days_to_due: daysToDue,
    requirement_completion_pct: requirementCompletionPct,
    requirement_counts: {
      total: totalRequirements,
      completed: completedRequirements,
      remaining: Math.max(0, totalRequirements - completedRequirements),
    },
    requirements_by_status: groupedRequirements,
    unmet_mandatory_requirements: unmetMandatoryRequirements,
  };
}

async function getRfpPipelineSummary(db, options = {}) {
  const orgId = _requireOrgId(options.orgId, 'getRfpPipelineSummary');
  const rfps = await _queryOrgScoped(db, {
    table: 'rfps',
    select: ['id', 'title', 'agency', 'status', 'proposal_due_date', 'estimated_value_max'],
    filters: { org_id: { eq: orgId } },
    order: { proposal_due_date: 'asc' },
    limit: 300,
  });
  const rows = rfps || [];
  const countsByStatus = {};
  let totalPipelineValue = 0;
  for (const r of rows) {
    const status = String(r?.status || 'unknown').toLowerCase();
    countsByStatus[status] = (countsByStatus[status] || 0) + 1;
    totalPipelineValue += _toNum(r?.estimated_value_max);
  }
  const nowMs = Date.now();
  const nextDueDates = rows
    .filter((r) => r?.proposal_due_date)
    .map((r) => ({
      id: r.id,
      title: r.title || null,
      agency: r.agency || null,
      status: r.status || null,
      proposal_due_date: r.proposal_due_date,
      days_to_due: _daysToDue(r.proposal_due_date, nowMs),
    }))
    .filter((r) => r.days_to_due == null || r.days_to_due >= 0)
    .sort((a, b) => (a.days_to_due ?? Number.MAX_SAFE_INTEGER) - (b.days_to_due ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 3);

  return {
    total_rfps: rows.length,
    counts_by_status: countsByStatus,
    total_pipeline_value: totalPipelineValue,
    next_due_dates: nextDueDates,
  };
}

async function getRfpDetail(db, rfpId, options = {}) {
  const orgId = _requireOrgId(options.orgId, 'getRfpDetail');
  if (!rfpId) {
    throw new FederalPipelineError('getRfpDetail requires rfpId', 'BAD_INPUT');
  }
  // The org filter is what makes this not an IDOR: without it any caller
  // holding an rfp uuid could read another tenant's solicitation.
  const rfps = await _queryOrgScoped(db, {
    table: 'rfps',
    select: [
      'id',
      'title',
      'agency',
      'solicitation_number',
      'status',
      'bid_decision',
      'proposal_due_date',
      'estimated_value_max',
    ],
    filters: { id: { eq: rfpId }, org_id: { eq: orgId } },
    limit: 1,
  });
  const rfp = rfps?.[0];
  if (!rfp) return null;
  const requirementsByRfp = await _loadRequirementsByRfp(db, [rfp.id], 600);
  const predictionByEntity = await _loadLatestPredictions(db, [rfp.id], orgId);
  return _buildRfpMetrics(rfp, requirementsByRfp[rfp.id] || [], predictionByEntity);
}

module.exports = {
  getRfpPipelineSummary,
  getRfpDetail,
  FederalPipelineError,
};
