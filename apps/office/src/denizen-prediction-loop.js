'use strict';

/**
 * Prediction loop maintenance — validate stale forecasts against observed outcomes.
 */

const POSITIVE_OUTCOMES = new Set([
  'intake.converted',
  'lead.converted',
  'lead.won',
  'client.created',
  'rfp.bid',
  'job.offer',
  'job.interview',
]);

function _accuracyScore(prediction, outcomeType) {
  const pred = prediction?.prediction || {};
  const actualPositive = POSITIVE_OUTCOMES.has(outcomeType);
  const predProb = pred.close_probability != null ? Number(pred.close_probability) : null;
  let predictedPositive = pred.will_convert != null ? Boolean(pred.will_convert) : null;
  if (predictedPositive == null && pred.will_bid != null) {
    predictedPositive = Boolean(pred.will_bid);
  }
  if (predictedPositive == null && predProb != null) {
    predictedPositive = predProb >= 0.5;
  }
  if (predictedPositive == null) predictedPositive = false;

  if (predProb != null && actualPositive != null) {
    return actualPositive ? predProb : 1 - predProb;
  }
  return predictedPositive === actualPositive ? 1.0 : 0.0;
}

function _predictionProbability(prediction) {
  const pred = prediction?.prediction || {};
  const type = String(prediction?.prediction_type || '').toLowerCase();
  let raw = null;
  if (pred.close_probability != null) raw = pred.close_probability;
  else if (pred.bid_probability != null) raw = pred.bid_probability;
  else if (pred.win_probability != null) raw = pred.win_probability;
  else if (type === 'lead.close_probability' && prediction?.confidence != null) raw = prediction.confidence;
  else if (type === 'intake.close_probability' && prediction?.confidence != null) raw = prediction.confidence;
  else if (type === 'rfp.bid_probability' && prediction?.confidence != null) raw = prediction.confidence;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}

async function _latestOutcome(db, orgId, pred) {
  const orgFilter = `org_id=eq.${encodeURIComponent(orgId)}`;
  const entityFilter = `entity_type=eq.${encodeURIComponent(pred.entity_type)}`;
  if (pred.entity_id) {
    return db._get(
      `denizen_outcomes?select=id,outcome_type&${orgFilter}&${entityFilter}&entity_id=eq.${encodeURIComponent(pred.entity_id)}&order=observed_at.desc&limit=1`,
    );
  }
  if (pred.entity_key) {
    return db._get(
      `denizen_outcomes?select=id,outcome_type&${orgFilter}&${entityFilter}&entity_key=eq.${encodeURIComponent(pred.entity_key)}&order=observed_at.desc&limit=1`,
    );
  }
  return [];
}

/**
 * Mark unvalidated predictions validated when a matching outcome exists.
 */
async function runPredictionMaintenance(db) {
  if (!db?.enabled || !db.orgId) return { updated: 0 };

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const orgFilter = `org_id=eq.${encodeURIComponent(db.orgId)}`;
  const predictions = await db._get(
    `denizen_predictions?select=id,entity_type,entity_id,entity_key,prediction_type,prediction,confidence&validated_at=is.null&created_at=gte.${encodeURIComponent(cutoff)}&${orgFilter}&order=created_at.asc&limit=500`,
  );

  let updated = 0;
  for (const pred of predictions || []) {
    const outcomes = await _latestOutcome(db, db.orgId, pred);
    const outcome = outcomes?.[0];
    if (!outcome) continue;

    await db._patch(
      `denizen_predictions?id=eq.${encodeURIComponent(pred.id)}`,
      {
        validated_at: new Date().toISOString(),
        actual_outcome_id: outcome.id,
        accuracy_score: _accuracyScore(pred, outcome.outcome_type),
      },
      { prefer: 'return=minimal' },
    );
    updated += 1;
  }

  return { updated };
}

/**
 * Aggregate prediction stats for an org.
 */
async function getPredictionSummary(orgId, db, opts = {}) {
  if (!db?.enabled || !orgId) {
    return { total: 0, validated: 0, avgAccuracy: null, byType: {}, topForecasts: [] };
  }

  const orgFilter = `org_id=eq.${encodeURIComponent(orgId)}`;
  const rows = await db._get(
    `denizen_predictions?select=prediction_type,accuracy_score,validated_at&${orgFilter}&order=created_at.desc&limit=1000`,
  );
  const preds = rows || [];
  const validatedRows = preds.filter((p) => p.validated_at != null);

  const byType = {};
  for (const p of preds) {
    const k = p.prediction_type || 'unknown';
    if (!byType[k]) byType[k] = { total: 0, validated: 0, avgAccuracy: null };
    byType[k].total += 1;
  }
  let accuracySum = 0;
  for (const p of validatedRows) {
    const k = p.prediction_type || 'unknown';
    if (!byType[k]) byType[k] = { total: 0, validated: 0, avgAccuracy: null };
    byType[k].validated += 1;
    accuracySum += Number(p.accuracy_score) || 0;
  }
  for (const k of Object.keys(byType)) {
    const typeValidated = preds.filter(
      (p) => (p.prediction_type || 'unknown') === k && p.validated_at != null,
    );
    if (typeValidated.length) {
      const sum = typeValidated.reduce((acc, p) => acc + (Number(p.accuracy_score) || 0), 0);
      byType[k].avgAccuracy = +(sum / typeValidated.length).toFixed(3);
    }
  }

  const summary = {
    total: preds.length,
    validated: validatedRows.length,
    avgAccuracy: validatedRows.length
      ? +(accuracySum / validatedRows.length).toFixed(3)
      : null,
    byType,
    topForecasts: [],
  };

  if (opts.includeTopForecasts) {
    const topLimit = Math.max(1, Math.min(20, Number(opts.topLimit) || 3));
    const topRows = await db._get(
      `denizen_predictions?select=entity_type,entity_id,entity_key,prediction_type,prediction,confidence,validated_at,created_at&${orgFilter}&order=confidence.desc.nullslast,created_at.desc&limit=${topLimit}`,
    );
    summary.topForecasts = (topRows || []).map((p) => ({
      entityType: p.entity_type || 'entity',
      entityId: p.entity_id || null,
      entityKey: p.entity_key || null,
      predictionType: p.prediction_type || 'unknown',
      probability: _predictionProbability(p),
      confidence: p.confidence != null ? Number(p.confidence) : null,
      status: p.validated_at ? 'validated' : 'pending',
      validatedAt: p.validated_at || null,
      createdAt: p.created_at || null,
    }));
  }

  return summary;
}

async function recordPrediction(db, input = {}) {
  if (!db?.enabled || !db?.orgId) return null;
  if (typeof db.insertPrediction === 'function') {
    return db.insertPrediction(input);
  }
  const probability = _predictionProbability({
    prediction_type: input.predictionType,
    prediction: input.prediction,
    confidence: input.confidence,
  });
  const rows = await db._post(
    'denizen_predictions',
    {
      org_id: db.orgId,
      model_key: input.modelKey || 'app_layer_v1',
      model_version: input.modelVersion || '1.0.0',
      prediction_type: input.predictionType,
      entity_type: input.entityType,
      entity_id: input.entityId || null,
      entity_key: input.entityKey || null,
      prediction: input.prediction || {},
      confidence: input.confidence != null ? Number(input.confidence) : probability,
      horizon: input.horizon || null,
      input_fact_ids: Array.isArray(input.inputFactIds) ? input.inputFactIds : null,
      metadata: input.metadata || {},
    },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

async function runMiroFishMaintenance(db) {
  if (!db?.enabled || !db?.orgId) return { ok: false, reason: 'db_unavailable', synced: 0 };
  try {
    // Lazy require avoids a circular dependency at module init time.
    const mirofish = require('./mirofish-prediction');
    if (typeof mirofish?.syncForecastsForOrg !== 'function') {
      return { ok: false, reason: 'mirofish_module_unavailable', synced: 0 };
    }
    return mirofish.syncForecastsForOrg(db);
  } catch (err) {
    return { ok: false, reason: err?.message || String(err), synced: 0 };
  }
}

module.exports = {
  runPredictionMaintenance,
  runMiroFishMaintenance,
  getPredictionSummary,
  recordPrediction,
  _accuracyScore,
};
