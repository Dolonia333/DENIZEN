'use strict';

const { recordPrediction } = require('./denizen-prediction-loop');

const DEFAULT_BASE_URL = 'http://localhost:5001';
const DEFAULT_MODEL_KEY = 'mirofish_v1';
const DEFAULT_MODEL_VERSION = '1.0.0';
const DEFAULT_SYNC_LIMIT = 8;
const RECENT_PREDICTION_WINDOW_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;

function _isEnabled(env = process.env) {
  const raw = env.MIROFISH_ENABLED;
  if (raw == null) return false;
  return !/^(0|false|no|off)$/i.test(String(raw).trim());
}

function getConfig(env = process.env) {
  return {
    baseUrl: String(env.MIROFISH_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    enabled: _isEnabled(env),
  };
}

function _predictionTypeForEntity(entityType) {
  const normalized = String(entityType || '').toLowerCase();
  if (normalized === 'rfp') return 'rfp.bid_probability';
  if (normalized === 'lead') return 'lead.close_probability';
  return 'intake.close_probability';
}

function _entityTypeForTable(entityType) {
  if (entityType === 'intake') return 'intake_form';
  return entityType;
}

function _clampProbability(value, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

async function _fetchWithTimeout(url, opts = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (typeof fetch !== 'function') throw new Error('fetch unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function isAvailable(opts = {}) {
  const cfg = getConfig(opts.env);
  if (!cfg.enabled) return false;
  const baseUrl = opts.baseUrl || cfg.baseUrl;
  const paths = ['/api/health', '/health'];
  for (const path of paths) {
    try {
      const res = await _fetchWithTimeout(`${baseUrl}${path}`, { method: 'GET' });
      if (res.ok) return true;
    } catch (_) {
      // continue to next path
    }
  }
  return false;
}

function _extractProbabilityFromVerdict(verdict = {}, predictionType = '') {
  if (verdict.close_probability != null) return _clampProbability(verdict.close_probability);
  if (verdict.bid_probability != null) return _clampProbability(verdict.bid_probability);
  if (verdict.win_probability != null) return _clampProbability(verdict.win_probability);
  if (verdict.probability != null) return _clampProbability(verdict.probability);
  if (predictionType === 'rfp.bid_probability' && verdict.will_bid != null) {
    return verdict.will_bid ? 0.7 : 0.3;
  }
  if (verdict.will_convert != null) return verdict.will_convert ? 0.7 : 0.3;
  return null;
}

function _heuristicFallback({
  entityType,
  entityId = null,
  entityKey = null,
  context = {},
  predictionType,
}) {
  const normalizedType = String(entityType || '').toLowerCase();
  const signals = context?.signals && typeof context.signals === 'object'
    ? context.signals
    : context;
  let confidence = 0.25;

  if (normalizedType === 'intake') {
    const priorityScore = Number(signals?.priority_score || 0);
    if (priorityScore >= 80) confidence += 0.35;
    else if (priorityScore >= 60) confidence += 0.2;
    if (['10k_plus', 'custom'].includes(String(signals?.budget_range || ''))) confidence += 0.15;
    if (signals?.service_category) confidence += 0.05;
    const tier = String(signals?.recommended_tier || '').toLowerCase();
    if (tier.includes('premium') || tier.includes('enterprise')) confidence += 0.1;
    confidence = Math.min(confidence, 0.95);
  } else if (normalizedType === 'lead') {
    const status = String(signals?.status || '').toLowerCase();
    if (status.includes('qualified') || status.includes('hot')) confidence += 0.25;
    if (status.includes('proposal') || status.includes('negoti')) confidence += 0.2;
    if (signals?.source) confidence += 0.05;
    if (signals?.company) confidence += 0.05;
    confidence = Math.min(confidence, 0.9);
  } else {
    confidence = 0.3;
    const valueMax = Number(signals?.estimated_value_max);
    const requirementCount = Number(signals?.requirement_count || 0);
    const setAsideType = String(signals?.set_aside_type || '');
    if (Number.isFinite(valueMax) && valueMax >= 500000) confidence += 0.15;
    if (requirementCount > 20) confidence += 0.1;
    else if (requirementCount > 5) confidence += 0.05;
    if (setAsideType) confidence += 0.1;
    const dueDate = signals?.proposal_due_date ? new Date(signals.proposal_due_date) : null;
    if (dueDate instanceof Date && !Number.isNaN(dueDate.getTime())) {
      const daysOut = (dueDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      if (daysOut > 21) confidence += 0.05;
    }
    confidence = Math.min(confidence, 0.9);
  }

  const prediction = predictionType === 'rfp.bid_probability'
    ? {
      will_bid: confidence >= 0.5,
      bid_probability: confidence,
      signals,
    }
    : {
      will_convert: confidence >= 0.5,
      close_probability: confidence,
      signals,
    };

  return {
    modelKey: 'heuristic_v0',
    modelVersion: '0.2.0',
    predictionType,
    entityType: _entityTypeForTable(normalizedType),
    entityId,
    entityKey,
    prediction,
    confidence,
    metadata: {
      source: 'mirofish_fallback',
      fallback_reason: 'mirofish_unavailable',
    },
  };
}

function _parseMirofishForecast(payload, requestInput) {
  const predictionType = requestInput.predictionType || _predictionTypeForEntity(requestInput.entityType);
  const verdict = payload?.verdict && typeof payload.verdict === 'object'
    ? payload.verdict
    : payload?.prediction && typeof payload.prediction === 'object'
      ? payload.prediction
      : payload || {};
  const report = payload?.report || payload?.analysis || payload?.summary || null;
  const probability = _extractProbabilityFromVerdict(verdict, predictionType);
  const normalizedProbability = _clampProbability(probability, 0.5);
  const prediction = predictionType === 'rfp.bid_probability'
    ? {
      will_bid: verdict.will_bid != null ? Boolean(verdict.will_bid) : normalizedProbability >= 0.5,
      bid_probability: normalizedProbability,
      signals: requestInput?.context?.signals || requestInput?.context || {},
      report,
      verdict,
    }
    : {
      will_convert:
        verdict.will_convert != null ? Boolean(verdict.will_convert) : normalizedProbability >= 0.5,
      close_probability: normalizedProbability,
      signals: requestInput?.context?.signals || requestInput?.context || {},
      report,
      verdict,
    };

  return {
    modelKey: DEFAULT_MODEL_KEY,
    modelVersion: String(payload?.model_version || DEFAULT_MODEL_VERSION),
    predictionType,
    entityType: _entityTypeForTable(requestInput.entityType),
    entityId: requestInput.entityId || null,
    entityKey: requestInput.entityKey || null,
    prediction,
    confidence: _clampProbability(payload?.confidence != null ? payload.confidence : normalizedProbability),
    metadata: {
      source: 'mirofish',
      report,
      verdict,
      raw_response: payload,
    },
  };
}

async function _requestMirofishForecast(baseUrl, requestPayload) {
  const endpoints = ['/api/predictions/forecast', '/api/forecast'];
  let lastErr = null;

  for (const endpoint of endpoints) {
    try {
      const res = await _fetchWithTimeout(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });
      if (!res.ok) {
        if (res.status === 404) continue;
        const body = await res.text().catch(() => '');
        throw new Error(`MiroFish HTTP ${res.status} ${body}`.trim());
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('MiroFish forecast request failed');
}

async function runEntityForecast({
  entityType,
  entityId = null,
  entityKey = null,
  context = {},
  predictionType = null,
  env = process.env,
} = {}) {
  const requestedPredictionType = predictionType || _predictionTypeForEntity(entityType);
  const requestInput = {
    entityType,
    entityId,
    entityKey,
    context,
    predictionType: requestedPredictionType,
  };
  const cfg = getConfig(env);

  if (!cfg.enabled) {
    return _heuristicFallback(requestInput);
  }

  const available = await isAvailable({ env, baseUrl: cfg.baseUrl });
  if (!available) {
    return _heuristicFallback(requestInput);
  }

  try {
    const mirofishPayload = await _requestMirofishForecast(cfg.baseUrl, {
      entity_type: requestInput.entityType,
      entity_id: requestInput.entityId,
      entity_key: requestInput.entityKey,
      prediction_type: requestInput.predictionType,
      context: requestInput.context || {},
    });
    return _parseMirofishForecast(mirofishPayload, requestInput);
  } catch (_) {
    return _heuristicFallback(requestInput);
  }
}

async function _listTopRows(db, entityType, limit = DEFAULT_SYNC_LIMIT) {
  const orgFilter = `org_id=eq.${encodeURIComponent(db.orgId)}`;
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || DEFAULT_SYNC_LIMIT));

  if (entityType === 'intake') {
    return db._get(
      `intake_forms?select=id,priority_score,budget_range,service_category,recommended_tier,status,created_at&${orgFilter}&order=priority_score.desc.nullslast,created_at.desc&limit=${safeLimit}`,
    ).catch(() => []);
  }
  if (entityType === 'lead') {
    return db._get(
      `leads?select=id,status,source,company,email,created_at&${orgFilter}&order=created_at.desc&limit=${safeLimit}`,
    ).catch(() => []);
  }
  return db._get(
    `rfps?select=id,title,status,estimated_value_max,set_aside_type,proposal_due_date,created_at&${orgFilter}&order=estimated_value_max.desc.nullslast,proposal_due_date.asc.nullslast,created_at.desc&limit=${safeLimit}`,
  ).catch(() => []);
}

async function _hasRecentMirofishPrediction(db, entityType, entityId) {
  const cutoff = new Date(Date.now() - RECENT_PREDICTION_WINDOW_MS).toISOString();
  const rows = await db._get(
    `denizen_predictions?select=id&org_id=eq.${encodeURIComponent(db.orgId)}&entity_type=eq.${encodeURIComponent(entityType)}&entity_id=eq.${encodeURIComponent(entityId)}&model_key=eq.${encodeURIComponent(DEFAULT_MODEL_KEY)}&created_at=gte.${encodeURIComponent(cutoff)}&order=created_at.desc&limit=1`,
  ).catch(() => []);
  return (rows || []).length > 0;
}

async function syncForecastsForOrg(db) {
  if (!db?.enabled || !db?.orgId) return { ok: false, reason: 'db_unavailable', synced: 0 };

  const entities = [
    { kind: 'intake', predictionType: 'intake.close_probability', entityType: 'intake_form' },
    { kind: 'lead', predictionType: 'lead.close_probability', entityType: 'lead' },
    { kind: 'rfp', predictionType: 'rfp.bid_probability', entityType: 'rfp' },
  ];

  let attempted = 0;
  let synced = 0;
  const errors = [];

  for (const spec of entities) {
    const rows = await _listTopRows(db, spec.kind, DEFAULT_SYNC_LIMIT);
    for (const row of rows || []) {
      if (!row?.id) continue;
      const hasRecent = await _hasRecentMirofishPrediction(db, spec.entityType, row.id);
      if (hasRecent) continue;

      attempted += 1;
      try {
        const forecast = await runEntityForecast({
          entityType: spec.kind,
          entityId: row.id,
          context: { signals: row },
          predictionType: spec.predictionType,
        });
        const inserted = await recordPrediction(db, forecast);
        if (inserted) synced += 1;
      } catch (err) {
        errors.push({
          entityType: spec.entityType,
          entityId: row.id,
          error: err?.message || String(err),
        });
      }
    }
  }

  return {
    ok: true,
    attempted,
    synced,
    skipped: Math.max(0, attempted - synced),
    errors,
  };
}

module.exports = {
  getConfig,
  isAvailable,
  runEntityForecast,
  syncForecastsForOrg,
  _heuristicFallback,
  _parseMirofishForecast,
};
