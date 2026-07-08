'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const computeQueue = require('../src/compute/denizen-compute-queue');
const router = require('../src/integrations/lm-studio-router');

describe('denizen-inference-rpc helpers', () => {
  it('jobMatchesNode respects target_machine_id', () => {
    const job = {
      payload: { target_machine_id: 'desktop-abc' },
    };
    assert.equal(computeQueue.jobMatchesNode(job, 'node-1', null, { machineId: 'desktop-abc' }), true);
    assert.equal(computeQueue.jobMatchesNode(job, 'node-1', null, { machineId: 'other' }), false);
    assert.equal(computeQueue.jobMatchesNode({ payload: {} }, 'node-1', null, {}), true);
  });

  it('router selects rpc-capable fleet node without direct reachability', () => {
    router.clearRegistryForTests();
    router.upsertNode({
      node_id: 'desktop-abc',
      machine_id: 'desktop-abc',
      label: 'Desktop',
      role: 'desktop',
      url: null,
      reachable: false,
      reachable_local: true,
      rpc_capable: true,
      last_probe_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
    });
    const pick = router.selectEndpoint({ tier: 'main' });
    assert.equal(pick.node_id, 'desktop-abc');
    const cfg = router.resolveProviderConfig({ model: 'llama3.2' }, { tier: 'main' });
    assert.equal(cfg._inferenceMode, 'rpc');
    assert.equal(cfg._rpcCapable, true);
  });
});
