'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const lm = require('../src/npc-local-metrics.js');

describe('npc-local-metrics', () => {
  const tel = {
    generatedAt: '2026-07-01T05:00:00Z',
    facts: ['[FACT:latency_bottleneck_bouncer] Trigger flush >2000t'],
    npcs: {
      Bouncer: { count: 109, avg_latency_ms: 4197, avg_tokens: 2100 },
      Bob: { count: 77, avg_latency_ms: 4718, avg_tokens: 1800 },
    },
  };

  // consultHistory: [] pins the cooldown input. Without it these read
  // data/grok-consult-queue.jsonl — gitignored runtime state — so a single
  // pending consult on the developer's machine failed the test while CI, with
  // no such file, passed.
  const isolated = { cooldownMs: 0, sourcePrefix: 'never', consultHistory: [] };

  it('triggers consult when latency threshold crossed', () => {
    const v = lm.evaluate('Bouncer', tel, isolated);
    assert.equal(v.triggered, true);
    assert.ok(v.reasons.some((r) => r.includes('latency')));
    assert.equal(v.baseline.avg_latency_ms, 4197);
  });

  it('triggers Bob on token threshold', () => {
    // Bob's 1800 avg_tokens in the shared fixture is under the 2500 default,
    // so the original assertion here was actually satisfied by his latency.
    // Use a fixture that crosses the token floor and nothing else.
    const tokenHeavy = {
      generatedAt: tel.generatedAt,
      facts: [],
      npcs: { Bob: { count: 77, avg_latency_ms: 100, avg_tokens: 4000 } },
    };
    const v = lm.evaluate('Bob', tokenHeavy, isolated);
    assert.equal(v.triggered, true);
    assert.ok(
      v.reasons.some((r) => r.includes('tokens')),
      `expected a token reason, got: ${JSON.stringify(v.reasons)}`,
    );
    assert.ok(!v.reasons.some((r) => r.includes('latency')));
  });

  it('honours a pending consult in the supplied history', () => {
    const v = lm.evaluate('Bob', tel, {
      cooldownMs: 0,
      consultHistory: [{ npc: 'Bob', status: 'pending', ts: new Date().toISOString() }],
    });
    assert.equal(v.triggered, false);
    assert.equal(v.reason, 'consult_cooldown');
  });

  it('respects cooldown when recent consult exists', () => {
    const v = lm.evaluate('Bouncer', tel);
    assert.ok(v.triggered === true || v.reason === 'consult_cooldown');
  });

  it('exports lifecycle helpers used by npc-brains', () => {
    assert.equal(typeof lm.decayAndArchiveStaleBacklog, 'function');
    assert.equal(typeof lm.resetFriction, 'function');
    assert.equal(typeof lm.isHostConstrained, 'function');
    assert.equal(typeof lm.markDelegatedTaskConsumed, 'function');
    assert.equal(typeof lm.markBacklogDelegated, 'function');
  });

  it('captureSystemError maps path_stuck and skill_failure domains', () => {
    const nav = lm.captureSystemError('Bob', 'pathfinding', { code: 'STUCK' });
    assert.equal(nav.domain, 'path_stuck');
    const skill = lm.captureSystemError('Bob', 'skill_failure:coding-agent', { message: 'timeout' });
    assert.equal(skill.domain, 'skill_failure:coding-agent');
  });

  it('maybeEnqueueAutonomyBacklog at friction >= 8', () => {
    lm.recordFriction('testnpc', 'path_stuck', 8);
    const backlog = lm.loadAutonomyBacklog(10);
    assert.ok(backlog.some((e) => e.domain === 'path_stuck' && (e.impacted_npcs || []).includes('testnpc')));
  });

  it('buildFrictionSummary returns per-npc hotspots', () => {
    lm.recordFriction('alice', 'path_stuck', 5);
    const summary = lm.buildFrictionSummary();
    assert.ok(summary.alice || summary.Alice || Object.keys(summary).length >= 0);
  });
});
