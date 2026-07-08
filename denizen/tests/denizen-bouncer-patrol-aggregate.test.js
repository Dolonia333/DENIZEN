'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { applyMeshPatrolResult } = require('../src/denizen-bouncer-patrol-aggregate');

describe('denizen-bouncer-patrol-aggregate', () => {
  it('merges node patrol into worldState.bouncerPatrol', () => {
    const worldState = { bouncerPatrol: null };
    const agg = applyMeshPatrolResult(worldState, 'node-a', {
      ok: true,
      summary: 'TCP probes ok',
      openPorts: [{ port: '8888', state: 'open' }],
      elapsed: 42,
    });
    assert.equal(agg.totalNodes, 1);
    assert.equal(agg.healthyNodes, 1);
    assert.equal(worldState.bouncerPatrol.mesh, true);
    assert.ok(worldState.bouncerPatrol.nodes['node-a']);

    applyMeshPatrolResult(worldState, 'node-b', { ok: false, summary: 'down', elapsed: 10 });
    assert.equal(worldState.bouncerPatrol.totalNodes, 2);
    assert.equal(worldState.bouncerPatrol.unhealthyNodes, 1);
  });
});
