'use strict';

/**
 * Local outcome ledger — receipts for unattended work.
 * Also mirrors into denizen_outcomes when DB is available.
 *
 * Schema (one JSON object per line):
 * {
 *   id, ts, org_id, actor, outcome_type, entity_type, entity_key,
 *   value_text, value_json, source, pass
 * }
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LEDGER_PATH = path.join(__dirname, '..', 'data', 'outcome-ledger.jsonl');
const MAX_LINES = 2000;

function ledgerPath() {
  return LEDGER_PATH;
}

function appendOutcome(row) {
  const entry = {
    id: row.id || `out_${crypto.randomBytes(8).toString('base64url')}`,
    ts: row.ts || new Date().toISOString(),
    org_id: row.org_id || null,
    actor: String(row.actor || 'system').slice(0, 80),
    outcome_type: String(row.outcome_type || 'unspecified').slice(0, 120),
    entity_type: String(row.entity_type || 'workspace').slice(0, 80),
    entity_key: row.entity_key != null ? String(row.entity_key).slice(0, 200) : null,
    value_text: String(row.value_text || '').slice(0, 2000),
    value_json: row.value_json && typeof row.value_json === 'object' ? row.value_json : {},
    source: String(row.source || 'outcome-ledger').slice(0, 80),
    pass: row.pass !== false,
  };
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.appendFileSync(LEDGER_PATH, `${JSON.stringify(entry)}\n`);

  try {
    const denizenDb = require('./denizen-db');
    if (denizenDb.enabled && denizenDb.orgId) {
      denizenDb.recordOutcome({
        outcomeType: entry.outcome_type,
        entityType: entry.entity_type,
        entityKey: entry.entity_key,
        valueJson: { ...entry.value_json, actor: entry.actor, source: entry.source, pass: entry.pass },
        valueText: entry.value_text,
      });
    }
  } catch (_) { /* best-effort DB mirror */ }

  return entry;
}

function readRecent({ hours = 168, limit = 40, outcome_type = null } = {}) {
  try {
    if (!fs.existsSync(LEDGER_PATH)) return [];
    const since = Date.now() - Math.max(1, hours) * 3600 * 1000;
    const lines = fs.readFileSync(LEDGER_PATH, 'utf8').split('\n').filter(Boolean).slice(-MAX_LINES);
    const rows = [];
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        const ts = Date.parse(row.ts || '');
        if (!Number.isFinite(ts) || ts < since) continue;
        if (outcome_type && row.outcome_type !== outcome_type) continue;
        rows.push(row);
      } catch (_) {}
    }
    return rows.slice(-Math.max(1, Math.min(200, limit)));
  } catch (_) {
    return [];
  }
}

function standup({ hours = 168, limit = 20 } = {}) {
  const outcomes = readRecent({ hours, limit: Math.max(limit, 50) });
  const byType = {};
  for (const o of outcomes) {
    byType[o.outcome_type] = (byType[o.outcome_type] || 0) + 1;
  }
  const recent = outcomes.slice(-limit).reverse();
  return {
    ok: true,
    hours,
    count: outcomes.length,
    breakdown: byType,
    outcomes: recent,
    summary: `Last ${hours}h: ${outcomes.length} outcome receipt(s). ${JSON.stringify(byType)}`,
  };
}

module.exports = {
  ledgerPath,
  appendOutcome,
  readRecent,
  standup,
};
