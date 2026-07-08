'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const resourcePressure = require('../src/resource-pressure');

describe('resource-pressure', () => {
  it('gatherSignals flags saturation', () => {
    const s = resourcePressure.gatherSignals({
      queuePending: 12,
      assignedStuck: 2,
      fleet: [],
      lmStudioReachable: false,
    });
    assert.ok(s.pressures.includes('mesh_queue_saturated'));
    assert.ok(s.pressures.includes('lm_studio_down'));
    assert.equal(s.saturated, true);
    assert.equal(s.severity, 'critical');
  });

  it('buildResourcePressureBlock includes remediation hints when saturated', () => {
    const block = resourcePressure.buildResourcePressureBlock({
      pressures: ['mesh_queue_saturated'],
      severity: 'high',
      queue_pending: 9,
      assigned_stuck: 0,
      contributing_nodes: 0,
      gpu_nodes: 0,
      ram_free_pct: 40,
      saturated: true,
    });
    assert.match(block, /BYOK/);
    assert.match(block, /health-check/);
  });

  it('healthy mesh yields short block', () => {
    const block = resourcePressure.buildResourcePressureBlock({
      pressures: [],
      severity: 'low',
      saturated: false,
    });
    assert.match(block, /healthy/);
  });
});
