'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('compute-queue reclaim helpers', () => {
  it('exports reclaim and expire functions', () => {
    const queue = require('../src/denizen-compute-queue');
    assert.equal(typeof queue.reclaimStaleJobs, 'function');
    assert.equal(typeof queue.expireOldQueuedJobs, 'function');
  });
});
