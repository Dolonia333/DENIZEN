'use strict';

const fs = require('fs');
const path = require('path');
const { appendFile } = require('fs').promises;

const LOG_FILE = process.env.INFERENCE_USAGE_LOG_PATH
  || path.join(__dirname, '..', 'data', 'inference-usage.jsonl');

const RETENTION_DAYS = Math.max(1, Number(process.env.INFERENCE_USAGE_RETENTION_DAYS) || 7);
const MAX_LINES = Math.max(1000, Number(process.env.INFERENCE_USAGE_MAX_LINES) || 50000);

const KINDS_TO_TRACK = new Set([
  'chat', 'npc-think', 'reasoning', 'json', 'classify', 'embedding', 'tts', 'stt', 'tool', 'rpc', 'harness', 'skill', 'plan', 'decision',
]);

function safeStr(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.slice(0, 500);
  return String(v).slice(0, 500);
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function ensureDir(filePath) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    /* silently ignore so logging never breaks inference */
  }
}

function parseLine(line) {
  try {
    const obj = JSON.parse(line);
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.ts !== 'number') return null;
    return obj;
  } catch (_) {
    return null;
  }
}

function normalizeUsage(usage, result) {
  const raw = usage || (result && result.usage) || null;
  if (!raw || typeof raw !== 'object') {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
  return {
    promptTokens: safeNumber(raw.prompt_tokens ?? raw.promptTokens),
    completionTokens: safeNumber(raw.completion_tokens ?? raw.completionTokens),
    totalTokens: safeNumber(raw.total_tokens ?? raw.totalTokens),
  };
}

function buildRecord(opts) {
  const usage = normalizeUsage(opts.usage, opts.result);
  const now = Date.now();
  return {
    ts: now,
    iso: new Date(now).toISOString(),
    tier: safeStr(opts.tier) || 'main',
    model: safeStr(opts.model) || 'unknown',
    backend: safeStr(opts.backend) || 'unknown',
    url: safeStr(opts.url) || null,
    ok: opts.ok === true,
    latencyMs: safeNumber(opts.latencyMs),
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    error: opts.ok === true ? null : safeStr(opts.error),
    kind: safeStr(opts.kind) || 'chat',
  };
}

let trimInFlight = null;

async function trimOldEntries(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stats = fs.statSync(filePath);
    const maxAgeMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAgeMs;

    // Read existing lines, filter by retention and max line count.
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    let kept = lines
      .map(parseLine)
      .filter((obj) => obj && obj.ts >= cutoff);
    if (kept.length > MAX_LINES) {
      kept = kept.slice(kept.length - MAX_LINES);
    }

    if (kept.length !== lines.length) {
      const tmp = `${filePath}.tmp`;
      await fs.promises.writeFile(tmp, kept.map((obj) => JSON.stringify(obj)).join('\n') + '\n', 'utf8');
      await fs.promises.rename(tmp, filePath);
    }

    // If the file is still huge, consider rotating. For now retention is enough.
  } catch (_) {
    /* never break inference for logging cleanup */
  }
}

async function recordUsage(opts) {
  try {
    ensureDir(LOG_FILE);
    const record = buildRecord(opts);
    const line = JSON.stringify(record) + '\n';
    await appendFile(LOG_FILE, line, 'utf8');

    // Run trim occasionally and asynchronously, never blocking the caller.
    if (!trimInFlight) {
      trimInFlight = trimOldEntries(LOG_FILE).finally(() => { trimInFlight = null; });
    }
  } catch (_) {
    // Silently ignore logging failures so they never break inference.
  }
}

function wrapChatCompletion(chatCompletionFn) {
  return async function wrapped(opts = {}) {
    const start = Date.now();
    let result = null;
    let error = null;
    try {
      result = await chatCompletionFn(opts);
      return result;
    } catch (err) {
      error = err;
      throw err;
    } finally {
      const latencyMs = Date.now() - start;
      const usage = normalizeUsage(result?.usage, null);
      recordUsage({
        tier: opts.tier,
        model: result?.model || opts.model || opts.pinnedModel || null,
        backend: result?.backend || opts.backend || null,
        url: result?.url || opts.lmStudioUrl || opts.ollamaUrl || opts.llamaCppUrl || opts.baseUrl || null,
        ok: !error,
        latencyMs,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        error: error ? (error?.message || String(error)) : null,
        kind: opts.kind || 'chat',
      });
    }
  };
}

function readAllLines() {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const raw = fs.readFileSync(LOG_FILE, 'utf8');
    return raw
      .split(/\r?\n/)
      .map(parseLine)
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function bucketKey(raw) {
  return String(raw || 'unknown').toLowerCase().trim() || 'unknown';
}

function makeBucket() {
  return { count: 0, ok: 0, fail: 0, tokens: 0, latencyMs: 0 };
}

function addToBucket(bucket, rec) {
  bucket.count += 1;
  if (rec.ok) bucket.ok += 1;
  else bucket.fail += 1;
  bucket.tokens += rec.totalTokens || 0;
  bucket.latencyMs += rec.latencyMs || 0;
}

function finalizeBucket(bucket) {
  return {
    count: bucket.count,
    ok: bucket.ok,
    fail: bucket.fail,
    tokens: bucket.tokens,
    avgLatencyMs: bucket.count > 0 ? Math.round(bucket.latencyMs / bucket.count) : 0,
  };
}

function buildStats({ hours, maxRecent } = {}) {
  const hoursNum = Number(hours) || 24;
  const maxRecentNum = Math.max(0, Number(maxRecent) ?? 50);
  const cutoff = Date.now() - hoursNum * 60 * 60 * 1000;

  const all = readAllLines();
  const windowed = all.filter((rec) => rec.ts >= cutoff);

  const total = makeBucket();
  const byModel = {};
  const byTier = {};
  const byBackend = {};

  for (const rec of windowed) {
    addToBucket(total, rec);
    addToBucket(byModel[bucketKey(rec.model)] ||= makeBucket(), rec);
    addToBucket(byTier[bucketKey(rec.tier)] ||= makeBucket(), rec);
    addToBucket(byBackend[bucketKey(rec.backend)] ||= makeBucket(), rec);
  }

  const recent = windowed
    .slice(-maxRecentNum)
    .map((rec) => ({
      iso: rec.iso,
      tier: rec.tier,
      model: rec.model,
      backend: rec.backend,
      ok: rec.ok,
      latencyMs: rec.latencyMs,
      totalTokens: rec.totalTokens,
      error: rec.error,
      kind: rec.kind,
    }));

  return {
    ok: true,
    window: { hours: hoursNum, sinceIso: new Date(cutoff).toISOString() },
    stats: {
      total: finalizeBucket(total),
      byModel: Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, finalizeBucket(v)])),
      byTier: Object.fromEntries(Object.entries(byTier).map(([k, v]) => [k, finalizeBucket(v)])),
      byBackend: Object.fromEntries(Object.entries(byBackend).map(([k, v]) => [k, finalizeBucket(v)])),
      recent,
    },
  };
}

function handleApiRequest(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const hours = Number(url.searchParams.get('hours')) || 24;
    const recent = Number(url.searchParams.get('recent')) || 50;
    const result = buildStats({ hours, maxRecent: recent });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  }
}

module.exports = {
  recordUsage,
  wrapChatCompletion,
  buildStats,
  handleApiRequest,
};
