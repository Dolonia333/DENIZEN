'use strict';

/**
 * Prediction loop maintenance — validate stale forecasts against observed outcomes.
 */

const POSITIVE_OUTCOMES = new Set([
  'intake.converted',
  'lead.converted',
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
async function getPredictionSummary(orgId, db) {
  if (!db?.enabled || !orgId) {
    return { total: 0, validated: 0, avgAccuracy: null, byType: {} };
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

  return {
    total: preds.length,
    validated: validatedRows.length,
    avgAccuracy: validatedRows.length
      ? +(accuracySum / validatedRows.length).toFixed(3)
      : null,
    byType,
  };
}

module.exports = {
  runPredictionMaintenance,
  getPredictionSummary,
  _accuracyScore,
};
