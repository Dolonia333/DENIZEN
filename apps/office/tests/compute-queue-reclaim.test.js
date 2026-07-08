'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('compute-queue reclaim helpers', () => {
  it('exports reclaim and expire functions', () => {
    const queue = require('../src/compute/denizen-compute-queue');
    assert.equal(typeof queue.reclaimStaleJobs, 'function');
    assert.equal(typeof queue.expireOldQueuedJobs, 'function');
    assert.equal(typeof queue.trimExcessQueuedJobs, 'function');
    assert.equal(typeof queue.isProducerThinkBatch, 'function');
  });

  it('isProducerThinkBatch detects mesh producer jobs', () => {
    const queue = require('../src/compute/denizen-compute-queue');
    assert.equal(queue.isProducerThinkBatch({
      job_type: 'npc_think_batch',
      payload: { source: 'mesh_producer' },
    }), true);
    assert.equal(queue.isProducerThinkBatch({
      job_type: 'sim_tick',
      payload: {},
    }), false);
  });
});
