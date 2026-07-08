'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const mesh = require('../src/denizen-mcp-mesh-tools.js');
const cursor = require('../src/denizen-mcp-cursor-tools.js');

const SCOPE = {
  org_id: '11111111-1111-1111-1111-111111111111',
  org_slug: 'zion',
  npc_key: 'abby',
  session_id: 'sess-1',
};

describe('denizen-mcp-mesh-tools', () => {
  it('enqueue_compute_job validates job_type', async () => {
    mesh.configure({ computeQueue: { isEnabled: () => true, enqueueJob: async () => ({ id: 'j1', status: 'queued' }) } });
    const bad = await mesh.callTool(SCOPE, 'enqueue_compute_job', { job_type: 'nope' });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /unsupported/);

    const good = await mesh.callTool(SCOPE, 'enqueue_compute_job', { job_type: 'inference_rpc', payload: { model: 'x' } });
    assert.equal(good.ok, true);
    assert.equal(good.job_id, 'j1');
  });

  it('get_inference_nodes returns router status', async () => {
    mesh.configure({
      lmStudioRouter: {
        buildStatus: () => ({
          enabled: true,
          saturated: false,
          any_reachable: true,
          remote_nodes: true,
          host_url: 'http://192.168.1.232:1234',
          nodes: [{ node_id: 'pc', url: 'http://192.168.1.232:1234', reachable: true, score: 80 }],
          selected: { url: 'http://192.168.1.232:1234' },
        }),
      },
      npcBrains: { getQueueDepth: () => 2 },
    });
    const out = await mesh.callTool(SCOPE, 'get_inference_nodes', {});
    assert.equal(out.ok, true);
    assert.equal(out.count, 1);
    assert.equal(out.queue_depth, 2);
  });
});

describe('denizen-mcp-cursor-tools', () => {
  let tmpQueue;

  beforeEach(() => {
    tmpQueue = path.join(os.tmpdir(), `cursor-bridge-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
    cursor.configure({ queuePath: tmpQueue, denizenDb: { recordWorkOutput: () => {} } });
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpQueue); } catch (_) {}
  });

  it('enqueue → list → claim → complete lifecycle', async () => {
    const enq = await cursor.callTool(SCOPE, 'enqueue_cursor_work', {
      title: 'Fix AggregateError in cofounder',
      description: 'Unwrap Node AggregateError for LM telemetry',
      files: ['denizen/src/cofounder-agent.js'],
      priority: 'high',
    });
    assert.equal(enq.ok, true);
    assert.match(enq.work_id, /^cwr_/);

    const list = await cursor.callTool(SCOPE, 'list_cursor_work', {});
    assert.equal(list.ok, true);
    assert.equal(list.count, 1);

    const claim = await cursor.callTool(SCOPE, 'claim_cursor_work', { work_id: enq.work_id });
    assert.equal(claim.status, 'in_progress');

    const done = await cursor.callTool(SCOPE, 'complete_cursor_work', {
      work_id: enq.work_id,
      summary: 'Added formatProviderError helper',
      files_changed: ['denizen/src/format-provider-error.js'],
    });
    assert.equal(done.status, 'done');
    assert.equal(done.work.result.ok, true);
  });
});
