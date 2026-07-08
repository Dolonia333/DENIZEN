'use strict';

const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

const worker = require('../src/compute/denizen-mesh-telemetry-worker');

describe('denizen-mesh-telemetry-worker', () => {
  it('processOneTelemetryJob completes on successful script run', async () => {
    const calls = [];
    const computeQueue = {
      claimJobByTypes: async (nodeId, types) => {
        calls.push(['claim', nodeId, types]);
        return { id: 'job-1', job_type: 'grok_telemetry_check' };
      },
      completeJob: async (id, nodeId, result) => {
        calls.push(['complete', id, nodeId, result.ok]);
        return { id, status: 'done' };
      },
      failJob: async () => { throw new Error('should not fail'); },
    };

    const out = await worker.processOneTelemetryJob(computeQueue, {
      runScript: async () => ({ ok: true, output: 'facts ok' }),
    });

    assert.equal(out.processed, true);
    assert.equal(out.ok, true);
    assert.equal(calls[0][1], worker.SERVER_NODE_ID);
    assert.equal(calls[1][0], 'complete');
  });

  it('processOneTelemetryJob fails job when script errors', async () => {
    let failed = false;
    const computeQueue = {
      claimJobByTypes: async () => ({ id: 'job-2', job_type: 'grok_telemetry_check' }),
      completeJob: async () => { throw new Error('should not complete'); },
      failJob: async () => { failed = true; return { status: 'failed' }; },
    };

    const out = await worker.processOneTelemetryJob(computeQueue, {
      runScript: async () => ({ ok: false, error: 'python missing' }),
    });

    assert.equal(out.processed, true);
    assert.equal(out.ok, false);
    assert.equal(failed, true);
  });

  it('processOneTelemetryJob passes serverWorker opts to claim', async () => {
    let claimOpts = null;
    const computeQueue = {
      claimJobByTypes: async (nodeId, types, nodeProfile, opts) => {
        claimOpts = opts;
        return null;
      },
    };
    await worker.processOneTelemetryJob(computeQueue, {});
    assert.equal(claimOpts?.serverWorker, true);
  });

  it('drainTelemetryQueue stops when queue empty', async () => {
    let claims = 0;
    const computeQueue = {
      claimJobByTypes: async () => {
        claims += 1;
        if (claims === 1) return { id: 'j1', job_type: 'grok_telemetry_check' };
        return null;
      },
      completeJob: async () => ({}),
      failJob: async () => ({}),
    };

    const outcomes = await worker.drainTelemetryQueue(computeQueue, {
      maxJobs: 3,
      runScript: async () => ({ ok: true }),
    });

    assert.equal(outcomes.length, 2);
    assert.equal(outcomes[0].ok, true);
    assert.equal(outcomes[1].reason, 'no_pending');
  });
});
