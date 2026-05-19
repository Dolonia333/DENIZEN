'use strict';
/**
 * Tests for the LLM telemetry module — pure data, no LLM provider
 * touched. Each case creates a fresh instance (not the singleton) so
 * cases stay isolated.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { LlmTelemetry, classifyError } = require('../src/llm-telemetry');

function mk(opts = {}) {
  const tmp = path.join(os.tmpdir(), `denizen-tel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`);
  const t = new LlmTelemetry({ logFile: tmp, persist: opts.persist !== false, ringSize: opts.ringSize || 200 });
  return { t, tmp };
}

describe('classifyError', () => {
  it('maps ECONNREFUSED → provider_down', () => {
    const c = classifyError('connect ECONNREFUSED 127.0.0.1:1234');
    assert.equal(c.category, 'provider_down');
    assert.match(c.hint, /not running/i);
  });
  it('maps timeout → timeout', () => {
    assert.equal(classifyError('LM Studio timeout').category, 'timeout');
    assert.equal(classifyError('ETIMEDOUT').category, 'timeout');
  });
  it('maps HTML response → model_not_loaded', () => {
    assert.equal(classifyError('LM Studio returned HTML (HTTP 404) — model probably not loaded').category, 'model_not_loaded');
  });
  it('maps context overflow', () => {
    assert.equal(classifyError('Context length exceeded').category, 'context_overflow');
    assert.equal(classifyError('prompt is too long').category, 'context_overflow');
  });
  it('maps 401 → auth', () => {
    assert.equal(classifyError('HTTP 401 Unauthorized').category, 'auth');
  });
  it('maps 429 → rate_limit', () => {
    assert.equal(classifyError('HTTP 429 Too Many Requests').category, 'rate_limit');
  });
  it('maps 500 → provider_error', () => {
    assert.equal(classifyError('HTTP 503 Service Unavailable').category, 'provider_error');
  });
  it('cooldown is its own category', () => {
    assert.equal(classifyError('Provider cooling down (12s left)').category, 'circuit_breaker');
  });
  it('unknown is unknown', () => {
    assert.equal(classifyError('something weird happened').category, 'unknown');
  });
});

describe('LlmTelemetry.record', () => {
  it('stores a normalized record with id and at', () => {
    const { t } = mk({ persist: false });
    const r = t.record({ npc: 'Lucy', kind: 'think', provider: 'lmstudio', model: 'x', latencyMs: 250, tokensIn: 80, tokensOut: 40, promptPreview: 'hi', responsePreview: 'hello' });
    assert.match(r.id, /^tel_/);
    assert.match(r.at, /^\d{4}-/);
    assert.equal(r.npc, 'Lucy');
    assert.equal(r.kind, 'think');
    assert.equal(r.latencyMs, 250);
    assert.equal(r.tokensIn, 80);
    assert.equal(r.error, null);
  });

  it('attaches category + hint when error is provided', () => {
    const { t } = mk({ persist: false });
    const r = t.record({ npc: 'Bob', kind: 'think', error: new Error('connect ECONNREFUSED 127.0.0.1:1234') });
    assert.ok(r.error);
    assert.equal(r.error.category, 'provider_down');
    assert.match(r.error.hint, /not running/i);
  });

  it('respects the ring size cap', () => {
    const { t } = mk({ persist: false, ringSize: 5 });
    for (let i = 0; i < 12; i++) t.record({ npc: 'A' + i, kind: 'think' });
    assert.equal(t.ring.length, 5);
    assert.equal(t.ring[0].npc, 'A7');
    assert.equal(t.ring[4].npc, 'A11');
  });

  it('persists to JSONL when persist: true', () => {
    const { t, tmp } = mk();
    t.record({ npc: 'Lucy', kind: 'think', latencyMs: 100 });
    t.record({ npc: 'Lucy', kind: 'chat', latencyMs: 200 });
    const raw = fs.readFileSync(tmp, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).kind, 'think');
    fs.unlinkSync(tmp);
  });
});

describe('getRecent', () => {
  it('returns most-recent-first, filtered by kind and npc', () => {
    const { t } = mk({ persist: false });
    t.record({ npc: 'Lucy', kind: 'think' });
    t.record({ npc: 'Bob',  kind: 'think' });
    t.record({ npc: 'Lucy', kind: 'chat' });
    const all = t.getRecent();
    assert.equal(all.length, 3);
    assert.equal(all[0].kind, 'chat');
    const lucyOnly = t.getRecent({ npc: 'Lucy' });
    assert.equal(lucyOnly.length, 2);
    const thinkOnly = t.getRecent({ kind: 'think' });
    assert.equal(thinkOnly.length, 2);
  });

  it('errorsOnly filters out successful calls', () => {
    const { t } = mk({ persist: false });
    t.record({ npc: 'Lucy', kind: 'think' });
    t.record({ npc: 'Lucy', kind: 'think', error: new Error('timeout') });
    const errs = t.getRecent({ errorsOnly: true });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].error.category, 'timeout');
  });

  it('limit is respected', () => {
    const { t } = mk({ persist: false });
    for (let i = 0; i < 30; i++) t.record({ npc: 'X', kind: 'think' });
    assert.equal(t.getRecent({ limit: 10 }).length, 10);
  });
});

describe('getStats', () => {
  it('returns zeros for an empty window', () => {
    const { t } = mk({ persist: false });
    const s = t.getStats();
    assert.equal(s.calls, 0);
    assert.equal(s.errors, 0);
    assert.equal(s.p50LatencyMs, null);
  });

  it('computes p50/p95 over latencies in the window', () => {
    const { t } = mk({ persist: false });
    for (const ms of [100, 200, 300, 400, 500, 600, 700, 800, 900, 10000]) {
      t.record({ npc: 'X', kind: 'think', latencyMs: ms });
    }
    const s = t.getStats();
    assert.equal(s.calls, 10);
    // p50 is at index 5 (0-indexed: 0.5 * 10 = 5) → 600
    assert.equal(s.p50LatencyMs, 600);
    // p95 is at index min(9, 9.5) = 9 → 10000
    assert.equal(s.p95LatencyMs, 10000);
    assert.equal(s.avgLatencyMs, Math.round((100 + 200 + 300 + 400 + 500 + 600 + 700 + 800 + 900 + 10000) / 10));
  });

  it('tokens-per-min and totals', () => {
    const { t } = mk({ persist: false });
    t.record({ npc: 'A', kind: 'think', latencyMs: 100, tokensIn: 50, tokensOut: 25 });
    t.record({ npc: 'B', kind: 'think', latencyMs: 100, tokensIn: 70, tokensOut: 35 });
    const s = t.getStats({ windowMs: 60_000 });
    assert.equal(s.tokensInTotal, 120);
    assert.equal(s.tokensOutTotal, 60);
    assert.equal(s.tokensPerMin, 180);
  });

  it('byNpc groups + counts errors per group', () => {
    const { t } = mk({ persist: false });
    t.record({ npc: 'Lucy', kind: 'think', latencyMs: 100 });
    t.record({ npc: 'Lucy', kind: 'think', latencyMs: 300, error: new Error('timeout') });
    t.record({ npc: 'Bob',  kind: 'chat',  latencyMs: 50 });
    const s = t.getStats();
    assert.equal(s.byNpc.Lucy.calls, 2);
    assert.equal(s.byNpc.Lucy.errors, 1);
    assert.equal(s.byNpc.Bob.calls, 1);
    assert.equal(s.byNpc.Lucy.avgLatencyMs, 200);
  });

  it('topErrors sorted by count with hints', () => {
    const { t } = mk({ persist: false });
    for (let i = 0; i < 3; i++) t.record({ npc: 'X', error: new Error('timeout ' + i) });
    t.record({ npc: 'X', error: new Error('connect ECONNREFUSED') });
    const s = t.getStats();
    assert.equal(s.topErrors[0].category, 'timeout');
    assert.equal(s.topErrors[0].count, 3);
    assert.equal(s.topErrors[1].category, 'provider_down');
    assert.match(s.topErrors[0].hint, /slow or stuck/);
  });
});
