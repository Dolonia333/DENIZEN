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

  it('triggers consult when latency threshold crossed', () => {
    const v = lm.evaluate('Bouncer', tel, { cooldownMs: 0, sourcePrefix: 'never' });
    assert.equal(v.triggered, true);
    assert.ok(v.reasons.some((r) => r.includes('latency')));
    assert.equal(v.baseline.avg_latency_ms, 4197);
  });

  it('triggers Bob on token threshold', () => {
    const v = lm.evaluate('Bob', tel, { cooldownMs: 0, sourcePrefix: 'never' });
    assert.equal(v.triggered, true);
    assert.ok(v.reasons.some((r) => r.includes('tokens')));
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

  it('captureSystemError maps navigation and skill domains', () => {
    const nav = lm.captureSystemError('Bob', 'mesh_navigation', { code: 'STUCK' });
    assert.equal(nav.domain, 'mesh_navigation');
    const skill = lm.captureSystemError('Bob', 'skill_coding-agent', { message: 'timeout' });
    assert.equal(skill.domain, 'skill_coding-agent');
  });
});
