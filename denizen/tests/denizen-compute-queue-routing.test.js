'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const computeQueue = require('../src/denizen-compute-queue.js');

describe('denizen-compute-queue capability routing', () => {
  it('nodeCanRunJob rejects weak hardware for embedding jobs', () => {
    const job = { job_type: 'embedding_index', payload: {} };
    const weak = { hardware_score: 8, contribution_level: 'standard' };
    const strong = { hardware_score: 40, contribution_level: 'standard' };
    assert.equal(computeQueue.nodeCanRunJob(weak, job), false);
    assert.equal(computeQueue.nodeCanRunJob(strong, job), true);
  });

  it('nodeCanRunJob blocks heavy jobs on light contribution nodes', () => {
    const job = { job_type: 'npc_think_batch', payload: {} };
    const light = { hardware_score: 80, contribution_level: 'light' };
    assert.equal(computeQueue.nodeCanRunJob(light, job), false);
    assert.equal(computeQueue.nodeCanRunJob({ ...light, contribution_level: 'standard' }, job), true);
  });

  it('nodeCanRunJob allows sim_tick on modest hardware', () => {
    const job = { job_type: 'sim_tick', payload: {} };
    const node = { hardware_score: 10, contribution_level: 'standard' };
    assert.equal(computeQueue.nodeCanRunJob(node, job), true);
  });
});
