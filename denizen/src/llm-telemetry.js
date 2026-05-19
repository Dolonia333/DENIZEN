'use strict';
/**
 * LLM Telemetry — per-call log + aggregate stats for everything that
 * touches an LLM in Denizen (LM Studio, Anthropic, xAI, Moonshot,
 * Google, OpenClaw downstream).
 *
 * Why this exists: the only LLM observability previously was two
 * counters (providerOk, providerFail) on globalThis._npcStats. That
 * tells you "something worked recently" but not WHAT, who asked,
 * how long it took, how many tokens it cost, or what specifically
 * went wrong when it failed.
 *
 * This module records every call as a structured event:
 *
 *   {
 *     id:           "tel_<ts>_<rand>",
 *     at:           ISO timestamp,
 *     npc:          "Lucy" | "system" | "cofounder" | ...,
 *     kind:         "think" | "chat" | "email" | "response" |
 *                   "goal" | "plan" | "reflection" | "city-plan" |
 *                   "openclaw" | "other",
 *     provider:     "lmstudio" | "anthropic" | "xai" | "google" | "moonshot" | "claude",
 *     model:        string,
 *     latencyMs:    number,
 *     tokensIn:     number | null,
 *     tokensOut:    number | null,
 *     promptPreview:  first 240 chars of the user/system prompt,
 *     responsePreview: first 240 chars of the response (or null on error),
 *     error:        null | { message, category, hint },
 *     correlationId: optional — used to link an NPC decision to a
 *                   downstream OpenClaw run.
 *   }
 *
 * Storage: in-memory ring buffer of the last 500 events (default) PLUS
 * appended to data/llm-telemetry.jsonl when persist=true. JSONL so a
 * partial write can't corrupt the file and `tail`/`grep` work.
 *
 * The classifier turns raw errors into { category, hint } so the diag
 * panel can show actionable fixes instead of cryptic stack traces.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_LOG_FILE = path.join(ROOT, 'data', 'llm-telemetry.jsonl');
const DEFAULT_RING_SIZE = 500;

/** Error classifier. Maps regex → { category, hint }. The first match
 *  wins; the hint is shown to the operator as "here's what to do." */
const ERROR_CLASSIFIERS = [
  // Order matters: more specific matches first.
  { re: /ECONNREFUSED|connect.*refused/i, category: 'provider_down',
    hint: 'LM Studio is not running. Start it and load a model on port 1234 (or whatever LM_STUDIO_URL points at).' },
  { re: /ETIMEDOUT|timeout/i, category: 'timeout',
    hint: 'LM Studio is slow or stuck. Check the Server tab — model may be loading, GPU may be saturated.' },
  { re: /HTML.*not loaded|HTML.*404|<!doctype html>/i, category: 'model_not_loaded',
    hint: 'LM Studio responded with HTML, which means no model is loaded. Load one in LM Studio → Models.' },
  { re: /context.*length|context.*size|prompt is too long|exceeds.*context/i, category: 'context_overflow',
    hint: 'Prompt exceeds the model context window. Trim MEMORY.md or lower the conversation history depth.' },
  { re: /HTTP 401|invalid.*api.*key|unauthor/i, category: 'auth',
    hint: 'API key missing or wrong. Check ~/.openclaw/openclaw.json for the relevant provider.' },
  { re: /HTTP 403/i, category: 'forbidden',
    hint: 'API key is valid but lacks permission for this model. Check provider dashboard.' },
  { re: /HTTP 429|rate.*limit/i, category: 'rate_limit',
    hint: 'Provider rate-limited the request. Back off or switch to a different provider (or LM Studio).' },
  { re: /HTTP 5\d\d/i, category: 'provider_error',
    hint: 'Provider had an internal error. Wait a few seconds and try again — Denizen will auto-retry.' },
  { re: /cooling down|cooldown/i, category: 'circuit_breaker',
    hint: 'Too many consecutive failures. Denizen is pausing inference for 30s while LM Studio recovers.' },
  { re: /no text|empty.*response|returned no text/i, category: 'empty_response',
    hint: 'Provider returned an empty completion. May indicate a stuck model — restart LM Studio.' },
  { re: /aborted|cancel/i, category: 'aborted',
    hint: 'Request was cancelled (timeout or shutdown). Usually not actionable.' },
];

function classifyError(message) {
  if (!message) return { category: 'unknown', hint: 'No error message captured.' };
  const m = String(message);
  for (const cls of ERROR_CLASSIFIERS) {
    if (cls.re.test(m)) return { category: cls.category, hint: cls.hint };
  }
  return { category: 'unknown', hint: 'No known fix for this error pattern. See the raw message.' };
}

class LlmTelemetry {
  /**
   * @param {object} opts
   *   { logFile?, ringSize?, persist? }
   */
  constructor(opts = {}) {
    this.logFile = opts.logFile || DEFAULT_LOG_FILE;
    this.ringSize = Number.isFinite(opts.ringSize) ? opts.ringSize : DEFAULT_RING_SIZE;
    this.persist = opts.persist !== false; // default on
    this.ring = [];
    this._counter = 0;
  }

  /**
   * Record one LLM call.
   * @param {object} entry — see header doc for shape
   * @returns {object} the normalized record (with id + at filled in)
   */
  record(entry) {
    const at = new Date().toISOString();
    this._counter += 1;
    const rec = {
      id: `tel_${Date.now()}_${this._counter.toString(36)}`,
      at,
      npc: entry.npc || null,
      kind: entry.kind || 'other',
      provider: entry.provider || null,
      model: entry.model || null,
      latencyMs: Number.isFinite(entry.latencyMs) ? entry.latencyMs : null,
      tokensIn: Number.isFinite(entry.tokensIn) ? entry.tokensIn : null,
      tokensOut: Number.isFinite(entry.tokensOut) ? entry.tokensOut : null,
      promptPreview: entry.promptPreview ? String(entry.promptPreview).slice(0, 240) : null,
      responsePreview: entry.responsePreview ? String(entry.responsePreview).slice(0, 240) : null,
      error: null,
      correlationId: entry.correlationId || null,
    };
    if (entry.error) {
      const msg = (entry.error.message || entry.error.toString?.() || String(entry.error)).slice(0, 600);
      const { category, hint } = classifyError(msg);
      rec.error = { message: msg, category, hint };
    }
    // Carry OpenClaw-specific status field through normalization so the
    // panel and stats can branch on it without inventing a 2nd ring.
    if (entry._ocStatus) rec._ocStatus = entry._ocStatus;
    this.ring.push(rec);
    if (this.ring.length > this.ringSize) this.ring.shift();
    if (this.persist) this._appendJsonl(rec);
    return rec;
  }

  _appendJsonl(rec) {
    try {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      fs.appendFileSync(this.logFile, JSON.stringify(rec) + '\n', 'utf8');
    } catch (err) {
      // Don't let logging IO break the actual NPC pipeline.
      if (!this._lastLogErrorAt || Date.now() - this._lastLogErrorAt > 60000) {
        console.warn('[llm-telemetry] log append failed:', err?.message || err);
        this._lastLogErrorAt = Date.now();
      }
    }
  }

  /**
   * Recent calls, optionally filtered.
   * @param {object} opts { limit, kind, npc, sinceMs, errorsOnly }
   */
  getRecent(opts = {}) {
    const { limit = 50, kind = null, npc = null, sinceMs = null, errorsOnly = false } = opts;
    const minTs = sinceMs ? Date.now() - sinceMs : 0;
    return this.ring.filter(r => {
      if (kind && r.kind !== kind) return false;
      if (npc && r.npc !== npc) return false;
      if (errorsOnly && !r.error) return false;
      if (minTs && Date.parse(r.at) < minTs) return false;
      return true;
    }).slice(-limit).reverse();
  }

  /**
   * Aggregate stats over a rolling window. Default window: 5 minutes.
   */
  getStats({ windowMs = 5 * 60 * 1000 } = {}) {
    const minTs = Date.now() - windowMs;
    // Exclude OpenClaw runs from LLM stats — they're a separate concern
    // with their own getOpenClawStats and panel tab.
    const inWindow = this.ring.filter(r => Date.parse(r.at) >= minTs && r.kind !== 'openclaw');
    if (inWindow.length === 0) {
      return {
        windowMs, calls: 0, errors: 0, errorRate: 0,
        p50LatencyMs: null, p95LatencyMs: null, p99LatencyMs: null,
        avgLatencyMs: null,
        tokensInTotal: 0, tokensOutTotal: 0, tokensPerMin: 0,
        byNpc: {}, byProvider: {}, byKind: {}, topErrors: [],
      };
    }
    const latencies = inWindow.map(r => r.latencyMs).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
    const pct = (p) => latencies.length
      ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))]
      : null;
    const tokensIn = inWindow.reduce((s, r) => s + (r.tokensIn || 0), 0);
    const tokensOut = inWindow.reduce((s, r) => s + (r.tokensOut || 0), 0);
    const errors = inWindow.filter(r => r.error);

    const groupBy = (key) => {
      const out = {};
      for (const r of inWindow) {
        const k = r[key] || 'unknown';
        if (!out[k]) out[k] = { calls: 0, errors: 0, latSum: 0, latN: 0, tokensIn: 0, tokensOut: 0 };
        out[k].calls += 1;
        if (r.error) out[k].errors += 1;
        if (Number.isFinite(r.latencyMs)) { out[k].latSum += r.latencyMs; out[k].latN += 1; }
        out[k].tokensIn += r.tokensIn || 0;
        out[k].tokensOut += r.tokensOut || 0;
      }
      // Replace latSum/latN with avg.
      for (const k of Object.keys(out)) {
        out[k].avgLatencyMs = out[k].latN ? Math.round(out[k].latSum / out[k].latN) : null;
        delete out[k].latSum;
        delete out[k].latN;
      }
      return out;
    };

    // Top error categories
    const errCounts = {};
    for (const r of errors) {
      const cat = r.error.category || 'unknown';
      if (!errCounts[cat]) errCounts[cat] = { count: 0, hint: r.error.hint, lastMessage: r.error.message };
      errCounts[cat].count += 1;
      errCounts[cat].lastMessage = r.error.message;
    }
    const topErrors = Object.entries(errCounts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([category, v]) => ({ category, ...v }));

    return {
      windowMs,
      calls: inWindow.length,
      errors: errors.length,
      errorRate: inWindow.length ? errors.length / inWindow.length : 0,
      p50LatencyMs: pct(0.50),
      p95LatencyMs: pct(0.95),
      p99LatencyMs: pct(0.99),
      avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
      tokensInTotal: tokensIn,
      tokensOutTotal: tokensOut,
      tokensPerMin: Math.round((tokensIn + tokensOut) / (windowMs / 60000)),
      byNpc: groupBy('npc'),
      byProvider: groupBy('provider'),
      byKind: groupBy('kind'),
      topErrors,
    };
  }

  /** Recent errors with classification hints. */
  getRecentErrors({ limit = 20 } = {}) {
    return this.ring.filter(r => r.error).slice(-limit).reverse();
  }

  /** OpenClaw-specific aggregates: tool runs in the window, by status,
   *  by tool, p50/p95 of completed runs. */
  getOpenClawStats({ windowMs = 5 * 60 * 1000 } = {}) {
    const minTs = Date.now() - windowMs;
    const inWindow = this.ring.filter(r => Date.parse(r.at) >= minTs && r.kind === 'openclaw');
    const completed = inWindow.filter(r => r._ocStatus === 'succeeded' || r._ocStatus === 'failed');
    const failed = inWindow.filter(r => r._ocStatus === 'failed' || !!r.error);
    const latencies = completed.map(r => r.latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
    const pct = (p) => latencies.length
      ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))]
      : null;
    const byTool = {};
    for (const r of inWindow) {
      const tool = r.model || 'unknown';
      if (!byTool[tool]) byTool[tool] = { started: 0, succeeded: 0, failed: 0 };
      byTool[tool][r._ocStatus] = (byTool[tool][r._ocStatus] || 0) + 1;
    }
    return {
      windowMs,
      runs: inWindow.length,
      started: inWindow.filter(r => r._ocStatus === 'started').length,
      succeeded: inWindow.filter(r => r._ocStatus === 'succeeded').length,
      failed: failed.length,
      p50LatencyMs: pct(0.50),
      p95LatencyMs: pct(0.95),
      byTool,
    };
  }

  /** Recent OpenClaw events in time order. */
  getRecentOpenClaw({ limit = 50 } = {}) {
    return this.ring.filter(r => r.kind === 'openclaw').slice(-limit).reverse();
  }

  /**
   * Record an OpenClaw tool run. Different shape from LLM calls but
   * lives in the same stream (tagged with kind: 'openclaw') so the
   * operator can correlate by timestamp + correlationId.
   *
   * @param {object} entry
   *   { tool, args, status: 'started'|'succeeded'|'failed',
   *     latencyMs?, response?, error?, source?, correlationId? }
   */
  recordOpenClaw(entry) {
    return this.record({
      kind: 'openclaw',
      provider: entry.source || 'openclaw',
      model: entry.tool || null,
      latencyMs: entry.latencyMs,
      // Pack args + response into the preview fields so they show in the panel
      // without inventing a new render path. JSON-stringify args defensively.
      promptPreview: entry.args ? (typeof entry.args === 'string' ? entry.args : JSON.stringify(entry.args)) : null,
      responsePreview: entry.response
        ? (typeof entry.response === 'string' ? entry.response : JSON.stringify(entry.response))
        : null,
      error: entry.error,
      correlationId: entry.correlationId || null,
      // Stash the status as part of the entry so getRecent can surface it.
      _ocStatus: entry.status || 'unknown',
    });
  }

  /** Reset (test convenience). */
  reset() {
    this.ring = [];
    this._counter = 0;
  }
}

// Singleton — every subsystem records into the same instance.
const telemetry = new LlmTelemetry();

module.exports = telemetry;
module.exports.LlmTelemetry = LlmTelemetry;
module.exports.classifyError = classifyError;
module.exports._DEFAULT_LOG_FILE = DEFAULT_LOG_FILE;
