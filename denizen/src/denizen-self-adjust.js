'use strict';

/**
 * Denizen self-adjust: spot UX failures (fetch aborted, empty chat, missing assistant)
 * and tune timeouts / recommend remediations automatically.
 *
 * Data sources:
 *  - Client UX events POST /api/ux/event
 *  - Inference usage log (p95 latency)
 *
 * Outputs:
 *  - Persisted timeout recommendations (data/self-adjust.json)
 *  - GET /api/ux/timeouts for CRM Assist / office chat clients
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'data', 'self-adjust.json');
const EVENT_FILE = path.join(ROOT, 'data', 'ux-events.jsonl');

const DEFAULTS = {
  assist_timeout_ms: 90_000,
  chat_timeout_ms: 60_000,
  session_timeout_ms: 20_000,
};

const MAX_ASSIST_MS = 180_000;
const MIN_ASSIST_MS = 30_000;
const MAX_EVENTS = 2_000;
const LOOP_MS = Math.max(30_000, Number(process.env.DENIZEN_SELF_ADJUST_MS || 60_000));

let _state = null;
let _timer = null;
let _lastTick = null;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function loadState() {
  if (_state) return _state;
  try {
    if (fs.existsSync(STATE_FILE)) {
      const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      _state = {
        timeouts: { ...DEFAULTS, ...(j.timeouts || {}) },
        adjustments: Array.isArray(j.adjustments) ? j.adjustments.slice(-50) : [],
        stats: j.stats || {},
        updated_at: j.updated_at || null,
      };
      return _state;
    }
  } catch (_) { /* ignore */ }
  _state = {
    timeouts: { ...DEFAULTS },
    adjustments: [],
    stats: {},
    updated_at: null,
  };
  return _state;
}

function saveState() {
  const st = loadState();
  st.updated_at = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2), 'utf8');
  } catch (_) { /* never break request path */ }
}

function appendEvent(entry) {
  try {
    fs.mkdirSync(path.dirname(EVENT_FILE), { recursive: true });
    fs.appendFileSync(EVENT_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (_) { /* ignore */ }
}

function readRecentEvents(max = 400) {
  try {
    if (!fs.existsSync(EVENT_FILE)) return [];
    const raw = fs.readFileSync(EVENT_FILE, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const start = Math.max(0, lines.length - max);
    return lines.slice(start).map((line) => {
      try { return JSON.parse(line); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function trimEvents() {
  try {
    if (!fs.existsSync(EVENT_FILE)) return;
    const raw = fs.readFileSync(EVENT_FILE, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length <= MAX_EVENTS) return;
    fs.writeFileSync(EVENT_FILE, `${lines.slice(-MAX_EVENTS).join('\n')}\n`, 'utf8');
  } catch (_) { /* ignore */ }
}

/**
 * Record a client UX failure/success signal.
 */
function recordUxEvent(opts = {}) {
  const kind = String(opts.kind || opts.type || 'unknown').slice(0, 64);
  const surface = String(opts.surface || 'unknown').slice(0, 64);
  const entry = {
    ts: Date.now(),
    iso: new Date().toISOString(),
    kind,
    surface,
    message: opts.message ? String(opts.message).slice(0, 240) : null,
    latency_ms: Number(opts.latency_ms || opts.latencyMs) || null,
    timeout_ms: Number(opts.timeout_ms || opts.timeoutMs) || null,
    path: opts.path ? String(opts.path).slice(0, 120) : null,
    ok: opts.ok === true,
  };
  appendEvent(entry);
  setTimeout(trimEvents, 0).unref?.();

  // Fast-path: abort/timeout on assist → consider bump immediately
  if (!entry.ok && /abort|timeout|fetch aborted|timed out/i.test(`${kind} ${entry.message || ''}`)) {
    maybeBumpAssistTimeout({ reason: `ux:${kind}`, observed_ms: entry.latency_ms || entry.timeout_ms });
  }

  return { ok: true, recorded: true };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function inferenceLatencyStats(hours = 2) {
  try {
    const usage = require('./inference-usage-tracker');
    const built = usage.buildStats({ hours, maxRecent: 500 });
    const recent = (built.stats?.recent || []).filter((e) => e.ok && Number(e.latencyMs) > 0);
    const lat = recent.map((e) => Number(e.latencyMs)).sort((a, b) => a - b);
    return {
      count: lat.length,
      p50: percentile(lat, 50),
      p95: percentile(lat, 95),
      max: lat.length ? lat[lat.length - 1] : 0,
      fail: built.stats?.total?.fail || 0,
      ok: built.stats?.total?.ok || 0,
    };
  } catch (_) {
    return { count: 0, p50: 0, p95: 0, max: 0, fail: 0, ok: 0 };
  }
}

function recordAdjustment(kind, from, to, reason) {
  const st = loadState();
  st.adjustments.push({
    at: new Date().toISOString(),
    kind,
    from,
    to,
    reason: String(reason || '').slice(0, 200),
  });
  if (st.adjustments.length > 50) st.adjustments = st.adjustments.slice(-50);
  saveState();
  try {
    console.log(`[SelfAdjust] ${kind}: ${from} → ${to} (${reason})`);
  } catch (_) { /* ignore */ }
}

function maybeBumpAssistTimeout({ reason, observed_ms } = {}) {
  const st = loadState();
  const current = Number(st.timeouts.assist_timeout_ms) || DEFAULTS.assist_timeout_ms;
  const observed = Number(observed_ms) || 0;
  const stats = inferenceLatencyStats(2);
  const targetFromP95 = stats.p95 > 0 ? Math.ceil(stats.p95 * 1.6) : 0;
  const targetFromObs = observed > 0 ? Math.ceil(observed * 1.4) : 0;
  let next = Math.max(current, targetFromP95, targetFromObs, current + 15_000);

  // Only bump if we're actually tight: p95 within 75% of timeout, or abort observed
  const tight = stats.p95 > 0 && stats.p95 >= current * 0.7;
  const abortSignal = /abort|timeout|ux:/i.test(String(reason || ''));
  if (!tight && !abortSignal && !targetFromObs) {
    return { bumped: false, current, reason: 'not_tight' };
  }

  next = clamp(next, MIN_ASSIST_MS, MAX_ASSIST_MS);
  if (next <= current) return { bumped: false, current, reason: 'already_high' };

  st.timeouts.assist_timeout_ms = next;
  st.stats.last_assist_bump = {
    at: new Date().toISOString(),
    from: current,
    to: next,
    p95: stats.p95,
    reason,
  };
  recordAdjustment('assist_timeout_ms', current, next, reason || `p95=${stats.p95}`);
  return { bumped: true, from: current, to: next, p95: stats.p95 };
}

/**
 * Periodic tick: compare inference latency to client timeouts; bump if needed.
 */
function tick() {
  _lastTick = new Date().toISOString();
  const st = loadState();
  const stats = inferenceLatencyStats(2);
  st.stats.inference = stats;
  st.stats.last_tick = _lastTick;

  const events = readRecentEvents(200);
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  const recentAborts = events.filter((e) => {
    if (e.ts < cutoff) return false;
    if (e.ok) return false;
    return /abort|timeout/i.test(`${e.kind} ${e.message || ''}`);
  });
  st.stats.recent_aborts = recentAborts.length;

  if (recentAborts.length >= 2 || (stats.p95 > 0 && stats.p95 >= (st.timeouts.assist_timeout_ms || DEFAULTS.assist_timeout_ms) * 0.7)) {
    maybeBumpAssistTimeout({
      reason: recentAborts.length >= 2
        ? `client_aborts=${recentAborts.length}`
        : `p95_latency=${stats.p95}`,
      observed_ms: recentAborts[0]?.timeout_ms || stats.p95,
    });
  } else {
    saveState();
  }

  // Soft signal: missing assistant pattern
  const missingAsst = events.filter((e) => e.ts >= cutoff && /missing.?assistant|no.?assistant|claim/i.test(`${e.kind} ${e.message || ''}`));
  if (missingAsst.length >= 2) {
    st.stats.missing_assistant_hint = {
      count: missingAsst.length,
      advice: 'Re-login migrates claims automatically; call migrateAssistantsToSession if still stuck',
      at: _lastTick,
    };
    saveState();
  }

  return getStatus();
}

function getTimeouts() {
  const st = loadState();
  return {
    assist_timeout_ms: Number(st.timeouts.assist_timeout_ms) || DEFAULTS.assist_timeout_ms,
    chat_timeout_ms: Number(st.timeouts.chat_timeout_ms) || DEFAULTS.chat_timeout_ms,
    session_timeout_ms: Number(st.timeouts.session_timeout_ms) || DEFAULTS.session_timeout_ms,
    updated_at: st.updated_at,
    source: 'self-adjust',
  };
}

function getStatus() {
  const st = loadState();
  return {
    ok: true,
    timeouts: getTimeouts(),
    stats: st.stats || {},
    adjustments: (st.adjustments || []).slice(-10).reverse(),
    last_tick: _lastTick,
    loop_ms: LOOP_MS,
    enabled: !/^(0|false|no|off)$/i.test(String(process.env.DENIZEN_SELF_ADJUST ?? '1')),
  };
}

function startLoop() {
  if (_timer) return { ok: true, already: true };
  if (/^(0|false|no|off)$/i.test(String(process.env.DENIZEN_SELF_ADJUST ?? '1'))) {
    return { ok: true, skipped: true };
  }
  tick();
  _timer = setInterval(() => {
    try { tick(); } catch (err) {
      console.warn('[SelfAdjust] tick failed:', err?.message || err);
    }
  }, LOOP_MS);
  _timer.unref?.();
  return { ok: true, started: true, loop_ms: LOOP_MS };
}

function stopLoop() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

function handleApiRequest(req, res, url) {
  const pathName = url.pathname || '';
  if (pathName === '/api/ux/timeouts' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, ...getTimeouts() }));
    return true;
  }
  if (pathName === '/api/ux/adjustments' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(getStatus()));
    return true;
  }
  if (pathName === '/api/ux/event' && req.method === 'POST') {
    return false; // handled by server with body reader
  }
  if (pathName === '/api/ux/tick' && req.method === 'POST') {
    const status = tick();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return true;
  }
  return false;
}

module.exports = {
  DEFAULTS,
  recordUxEvent,
  getTimeouts,
  getStatus,
  tick,
  startLoop,
  stopLoop,
  maybeBumpAssistTimeout,
  inferenceLatencyStats,
  handleApiRequest,
  loadState,
};
