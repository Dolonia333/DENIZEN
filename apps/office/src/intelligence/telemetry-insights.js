'use strict';
/**
 * telemetry-insights.js — learn from data/llm-telemetry.jsonl accumulated during testing.
 * Surfaces actionable tuning recommendations (no LLM).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'data', 'llm-telemetry.jsonl');
const CACHE_MS = 120000;

let _cache = { at: 0, insights: null };

function readRecords(maxLines = 120000) {
  if (!fs.existsSync(LOG_FILE)) return [];
  const raw = fs.readFileSync(LOG_FILE, 'utf8');
  const lines = raw.trim().split('\n').filter(Boolean);
  const slice = lines.length > maxLines ? lines.slice(-maxLines) : lines;
  const out = [];
  for (const line of slice) {
    try { out.push(JSON.parse(line)); } catch (_) {}
  }
  return out;
}

function analyze(records) {
  const byKind = {};
  const byNpc = {};
  const byDay = new Set();
  const errors = {};
  let oldest = Infinity;
  let newest = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  for (const r of records) {
    const kind = r.kind || 'other';
    byKind[kind] = (byKind[kind] || 0) + 1;
    const npc = r.npc || '?';
    if (!byNpc[npc]) byNpc[npc] = { calls: 0, tokensIn: 0, errors: 0, latencySum: 0 };
    byNpc[npc].calls++;
    byNpc[npc].tokensIn += r.tokensIn || 0;
    byNpc[npc].latencySum += r.latencyMs || 0;
    if (r.error) {
      byNpc[npc].errors++;
      const cat = r.error.category || 'unknown';
      errors[cat] = (errors[cat] || 0) + 1;
    }
    tokensIn += r.tokensIn || 0;
    tokensOut += r.tokensOut || 0;
    const t = Date.parse(r.at || '');
    if (t) {
      byDay.add(new Date(t).toISOString().slice(0, 10));
      oldest = Math.min(oldest, t);
      newest = Math.max(newest, t);
    }
  }

  const thinkCalls = byKind.think || 0;
  const totalCalls = records.length || 1;
  const thinkShare = thinkCalls / totalCalls;

  const overflowNpc = Object.entries(byNpc)
    .filter(([, v]) => v.errors > 0)
    .sort((a, b) => b[1].errors - a[1].errors)
    .slice(0, 5)
    .map(([name, v]) => ({ npc: name, errors: v.errors, errorRate: v.errors / Math.max(1, v.calls) }));

  const recommendations = [];

  if (thinkShare > 0.7) {
    recommendations.push({
      id: 'hybrid_director',
      priority: 'high',
      title: 'Enable hybrid director',
      detail: `${Math.round(thinkShare * 100)}% of ${totalCalls.toLocaleString()} logged calls are autonomous think(). DENIZEN_HYBRID_DIRECTOR=true routes routine office motion algorithmically.`,
      env: { DENIZEN_HYBRID_DIRECTOR: 'true' },
    });
  }

  if ((errors.context_overflow || 0) > 100) {
    recommendations.push({
      id: 'context_length',
      priority: 'high',
      title: 'Fix context overflow (Abby/Lucy)',
      detail: `${errors.context_overflow} context_overflow errors logged. Bump LM Studio n_ctx to 16384+ or set DENIZEN_MEMORY_CHARS=180.`,
      env: { DENIZEN_MEMORY_CHARS: '180', DENIZEN_COMPACT_THINK_PROMPT: 'true' },
    });
  }

  if ((errors.model_not_loaded || 0) + (errors.unknown || 0) > 50) {
    recommendations.push({
      id: 'model_pin',
      priority: 'medium',
      title: 'Pin loaded models in LM Studio',
      detail: 'Frequent model unload/reload errors — keep Ministral + Gemma loaded and match LM_STUDIO_MODEL / LM_STUDIO_FAST_MODEL.',
    });
  }

  if (thinkCalls > 10000) {
    recommendations.push({
      id: 'think_cadence',
      priority: 'medium',
      title: 'Stretch think cadence',
      detail: `${thinkCalls.toLocaleString()} think calls across ${byDay.size} test days. DENIZEN_THINK_MIN_MS=600000 cuts load ~40% with same visuals when hybrid director is on.`,
      env: { DENIZEN_THINK_MIN_MS: '600000', DENIZEN_THINK_MAX_MS: '900000' },
    });
  }

  recommendations.push({
    id: 'real_work_off',
    priority: 'low',
    title: 'Keep real-work nudges off during immersion testing',
    detail: 'DENIZEN_REAL_WORK_MODE=false avoids run_skill loops unless you are actively testing tools.',
    env: { DENIZEN_REAL_WORK_MODE: 'false' },
  });

  const topTokenNpcs = Object.entries(byNpc)
    .filter(([n]) => n !== '?')
    .sort((a, b) => b[1].tokensIn - a[1].tokensIn)
    .slice(0, 6)
    .map(([npc, v]) => ({
      npc,
      calls: v.calls,
      tokensIn: v.tokensIn,
      avgTokensIn: Math.round(v.tokensIn / Math.max(1, v.calls)),
      avgLatencyMs: Math.round(v.latencySum / Math.max(1, v.calls)),
      errors: v.errors,
    }));

  return {
    generatedAt: new Date().toISOString(),
    logFile: 'data/llm-telemetry.jsonl',
    summary: {
      totalCalls: records.length,
      testingDays: byDay.size,
      daySpan: [...byDay].sort(),
      spanMs: newest > oldest ? newest - oldest : 0,
      tokensInTotal: tokensIn,
      tokensOutTotal: tokensOut,
      promptToCompletionRatio: tokensOut > 0 ? Math.round((tokensIn / tokensOut) * 10) / 10 : null,
      thinkShare: Math.round(thinkShare * 1000) / 10,
      byKind,
      topErrors: Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([category, count]) => ({ category, count })),
    },
    topTokenNpcs,
    overflowNpc,
    recommendations,
  };
}

function getInsights(opts = {}) {
  const force = opts.force === true;
  const now = Date.now();
  if (!force && _cache.insights && (now - _cache.at) < CACHE_MS) {
    return _cache.insights;
  }
  const records = readRecords(opts.maxLines);
  const insights = analyze(records);
  _cache = { at: now, insights };
  return insights;
}

module.exports = { getInsights, analyze, readRecords };
