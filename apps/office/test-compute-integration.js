'use strict';

/**
 * End-to-end compute integration test (no browser).
 * Run: node test-compute-integration.js
 */

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const results = { pass: 0, fail: 0, gaps: [] };

function pass(name) {
  results.pass += 1;
  console.log(`  PASS  ${name}`);
}

function fail(name, err) {
  results.fail += 1;
  console.error(`  FAIL  ${name}: ${err?.message || err}`);
}

function gap(desc) {
  results.gaps.push(desc);
  console.warn(`  GAP   ${desc}`);
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

// --- 1. Module exports ---

section('Module exports');

const computeQueue = require('./src/compute/denizen-compute-queue');
const nodeWorker = require('./src/integrations/denizen-node-worker');
const computePlatform = require('./src/compute/denizen-compute-platform');
const { mountComputeRoutes } = require('./src/compute/denizen-compute-routes');
const denizenDb = require('./src/intelligence/denizen-db');
const denizenCredits = require('./src/compute/denizen-credits');

const fnExports = [
  [computeQueue, ['enqueueJob', 'claimJob', 'completeJob', 'failJob', 'listPendingJobs']],
  [nodeWorker, ['registerNode', 'heartbeat', 'resolveNodeAuth', 'processJobLocally']],
  [computePlatform, ['getStatusForIdentity', 'upsertProfileForIdentity', 'buildStatusPayload']],
  [{ mountComputeRoutes }, ['mountComputeRoutes']],
  [denizenCredits, ['awardCredits']],
];

for (const [mod, keys] of fnExports) {
  for (const key of keys) {
    try {
      assert.equal(typeof mod[key], 'function', `${key} should be a function`);
      pass(`export ${key}`);
    } catch (err) {
      fail(`export ${key}`, err);
    }
  }
}

for (const [mod, key, type] of [
  [computeQueue, 'JOB_TABLE', 'string'],
  [nodeWorker, 'NODE_TABLE', 'string'],
]) {
  try {
    assert.equal(typeof mod[key], type, `${key} should be ${type}`);
    pass(`export ${key} (${type})`);
  } catch (err) {
    fail(`export ${key}`, err);
  }
}

// --- 2. Queue status transitions (mocked DB) ---

section('Queue claim/complete/fail transitions (mocked DB)');

const JOB_TABLE = computeQueue.JOB_TABLE;
const jobs = new Map();
let jobSeq = 0;

function resetJobs() {
  jobs.clear();
  jobSeq = 0;
}

function seedJob({ jobType = 'sim_tick', status = 'queued', priority = 50, payload = {} } = {}) {
  const id = `job-${++jobSeq}`;
  const row = {
    id,
    job_type: jobType,
    payload,
    priority,
    status,
    assigned_node_id: null,
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
  };
  jobs.set(id, row);
  return row;
}

const origEnabled = denizenDb.enabled;
const origGet = denizenDb._get;
const origPost = denizenDb._post;
const origPatch = denizenDb._patch;
const origGetSoft = denizenDb._getSoft;
const origPatchSoft = denizenDb._patchSoft;

denizenDb.enabled = true;

const mockGet = async (path) => {
  const m = path.match(/id=eq\.([^&]+)/);
  if (m) {
    const row = jobs.get(decodeURIComponent(m[1]));
    return row ? [row] : [];
  }
  if (path.includes('status=eq.queued')) {
    return [...jobs.values()]
      .filter((j) => j.status === 'queued')
      .sort((a, b) => b.priority - a.priority || a.created_at.localeCompare(b.created_at));
  }
  return [];
};

denizenDb._get = mockGet;
denizenDb._getSoft = mockGet;

denizenDb._post = async (table, body) => {
  if (table !== JOB_TABLE) return [];
  const row = seedJob({ jobType: body.job_type, status: body.status, priority: body.priority, payload: body.payload });
  return [row];
};

const mockPatch = async (path, patch) => {
  const idMatch = path.match(/id=eq\.([^&]+)/);
  const nodeMatch = path.match(/assigned_node_id=eq\.([^&]+)/);
  const statusMatch = path.match(/status=eq\.([^&]+)/);
  if (!idMatch) return [];
  const id = decodeURIComponent(idMatch[1]);
  const row = jobs.get(id);
  if (!row) return [];
  if (statusMatch && row.status !== decodeURIComponent(statusMatch[1])) return [];
  if (nodeMatch && row.assigned_node_id !== decodeURIComponent(nodeMatch[1])) return [];
  Object.assign(row, patch);
  return [row];
};

denizenDb._patch = mockPatch;
denizenDb._patchSoft = mockPatch;

async function runQueueTests() {
  resetJobs();

  try {
    const enqueued = await computeQueue.enqueueJob({ jobType: 'npc_think_batch', payload: { npc_ids: ['a'] }, priority: 60 });
    assert.ok(enqueued?.id, 'enqueue should return job');
    assert.equal(enqueued.status, 'queued');
    pass('enqueueJob creates queued job');

    const claimed = await computeQueue.claimJob('node-1');
    assert.ok(claimed, 'claim should return job');
    assert.equal(claimed.status, 'assigned');
    assert.equal(claimed.assigned_node_id, 'node-1');
    pass('claimJob transitions queued -> assigned');

    const completed = await computeQueue.completeJob(claimed.id, 'node-1', { ok: true });
    assert.equal(completed.status, 'done');
    assert.deepEqual(completed.result, { ok: true });
    pass('completeJob transitions assigned -> done');

    const failSeed = seedJob({ jobType: 'embedding_index', status: 'queued' });
    const claimed2 = await computeQueue.claimJob('node-2');
    assert.equal(claimed2.id, failSeed.id);
    const failed = await computeQueue.failJob(claimed2.id, 'node-2', 'boom');
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error, 'boom');
    pass('failJob transitions assigned -> failed');

    const pending = await computeQueue.listPendingJobs(10);
    assert.ok(Array.isArray(pending));
    pass('listPendingJobs returns array');
  } catch (err) {
    fail('queue transitions', err);
  }
}

// --- 3. awardCredits signature via complete route ---

section('awardCredits via complete route (mocked)');

function mockReq({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  if (body != null) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(body)));
      req.emit('end');
    });
  } else {
    process.nextTick(() => req.emit('end'));
  }
  return req;
}

function mockRes() {
  const res = {
    status: null,
    body: null,
    writableEnded: false,
    writeHead(status) { this.status = status; },
    end(payload) { this.body = payload; this.writableEnded = true; },
  };
  return res;
}

async function runAwardCreditsTest() {
  resetJobs();
  const job = seedJob({ jobType: 'npc_think_batch', status: 'assigned', priority: 50 });
  job.assigned_node_id = 'node-abc';

  const awardCalls = [];
  const mockCredits = {
    awardCredits: async (identityId, amount, reason, opts) => {
      awardCalls.push({ identityId, amount, reason, opts });
      return { identityId, delta: amount, balance: 100 + amount };
    },
  };

  const handler = mountComputeRoutes({
    denizenCredits: mockCredits,
    verifyVisitorSession: async () => ({ session: {} }),
    userIdentity: {},
  });

  const req = mockReq({
    method: 'POST',
    url: '/api/compute/node/complete',
    headers: { 'x-node-token': 'tok' },
    body: { nodeId: 'node-abc', jobId: job.id, result: { ok: true } },
  });
  const res = mockRes();

  // Mock node auth
  const origResolve = nodeWorker.resolveNodeAuth;
  nodeWorker.resolveNodeAuth = async () => ({ id: 'node-abc', identity_id: 'ident-1' });
  const origIncrement = nodeWorker.incrementJobsCompleted;
  nodeWorker.incrementJobsCompleted = async () => null;

  try {
    const handled = await handler(req, res);
    assert.equal(handled, true);
    assert.equal(res.status, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.ok, true);
    assert.equal(awardCalls.length, 1);
    const call = awardCalls[0];
    assert.equal(call.identityId, 'ident-1');
    assert.ok(call.amount >= 1, 'job should award at least 1 credit');
    assert.equal(call.reason, 'compute_job_complete');
    assert.equal(call.opts.jobId, job.id);
    assert.equal(call.opts.metadata.job_type, 'npc_think_batch');
    assert.equal(call.opts.metadata.node_id, 'node-abc');
    assert.equal(call.opts.metadata.formula_version, 1);
    pass('complete route calls awardCredits(identityId, amount, reason, opts)');
  } catch (err) {
    fail('awardCredits signature', err);
  } finally {
    nodeWorker.resolveNodeAuth = origResolve;
    nodeWorker.incrementJobsCompleted = origIncrement;
  }
}

// --- 4. session_id route handlers ---

section('session_id status and opt-in routes');

async function runSessionRouteTests() {
  const identity = { id: 'ident-sess', credits_balance: 42, tier: 'player' };
  const profile = { opt_in: true, tier: 'player', hardware_score: 10, contribution_level: 'light' };

  const mockPlatform = {
    getStatusForIdentity: async (id) => computePlatform.buildStatusPayload(id, profile),
    upsertProfileForIdentity: async (id, opts) => ({ ...profile, opt_in: opts.optIn }),
    buildStatusPayload: computePlatform.buildStatusPayload,
  };

  const serverContext = {
    verifyVisitorSession: async (_req, sessionId) => ({
      session: { identity_id: identity.id, id: sessionId },
    }),
    userIdentity: {
      getIdentityById: async () => identity,
      getIdentityBySession: async () => identity,
    },
  };

  // Patch computePlatform for opt-in path
  const origUpsert = computePlatform.upsertProfileForIdentity;
  const origGetStatus = computePlatform.getStatusForIdentity;
  computePlatform.upsertProfileForIdentity = mockPlatform.upsertProfileForIdentity;
  computePlatform.getStatusForIdentity = mockPlatform.getStatusForIdentity;

  const handler = mountComputeRoutes(serverContext);

  try {
    // GET status with session_id
    const statusReq = mockReq({
      method: 'GET',
      url: '/api/compute/node/status?session_id=sess-123',
    });
    const statusRes = mockRes();
    const statusHandled = await handler(statusReq, statusRes);
    assert.equal(statusHandled, true);
    assert.equal(statusRes.status, 200);
    const statusPayload = JSON.parse(statusRes.body);
    assert.equal(statusPayload.ok, true);
    assert.equal(statusPayload.credits, 42);
    assert.equal(statusPayload.opted_in, true);
    pass('GET /api/compute/node/status?session_id= handles session');

    // POST opt-in with session_id
    const optReq = mockReq({
      method: 'POST',
      url: '/api/compute/node/opt-in',
      headers: { 'X-Denizen-Client': 'desktop' },
      body: { session_id: 'sess-123', opt_in: true, hardware: { cpu_cores: 8 } },
    });
    const optRes = mockRes();
    const optHandled = await handler(optReq, optRes);
    assert.equal(optHandled, true);
    assert.equal(optRes.status, 200);
    const optPayload = JSON.parse(optRes.body);
    assert.equal(optPayload.ok, true);
    assert.equal(optPayload.opted_in, true);
    pass('POST /api/compute/node/opt-in with session_id handles opt-in');

    // Missing session_id -> 400
    const badReq = mockReq({
      method: 'POST',
      url: '/api/compute/node/opt-in',
      body: { opt_in: true },
    });
    const badRes = mockRes();
    await handler(badReq, badRes);
    assert.equal(badRes.status, 400);
    pass('opt-in without session_id returns 400');
  } catch (err) {
    fail('session_id routes', err);
  } finally {
    computePlatform.upsertProfileForIdentity = origUpsert;
    computePlatform.getStatusForIdentity = origGetStatus;
  }
}

// --- 5. processJobLocally smoke ---

section('processJobLocally');

async function runLocalWorkerTests() {
  try {
    for (const type of ['npc_think_batch', 'embedding_index', 'sim_tick']) {
      const out = await nodeWorker.processJobLocally(type, {});
      assert.equal(out.ok, true, type);
      assert.equal(out.jobType, type);
    }
    pass('processJobLocally handles known job types');

    const unknown = await nodeWorker.processJobLocally('unknown_type', {});
    assert.equal(unknown.ok, false);
    pass('processJobLocally rejects unknown job type');
  } catch (err) {
    fail('processJobLocally', err);
  }
}

// --- 6. DB disabled graceful degradation ---

section('DB disabled graceful degradation');

async function runDisabledDbTests() {
  denizenDb.enabled = false;
  try {
    assert.equal(await computeQueue.enqueueJob({ jobType: 'sim_tick' }), null);
    assert.equal(await computeQueue.claimJob('n1'), null);
    assert.equal(await computeQueue.completeJob('j1', 'n1', {}), null);
    pass('queue ops return null when DB disabled');
  } catch (err) {
    fail('DB disabled', err);
  } finally {
    denizenDb.enabled = origEnabled;
    denizenDb._get = origGet;
    denizenDb._post = origPost;
    denizenDb._patch = origPatch;
    denizenDb._getSoft = origGetSoft;
    denizenDb._patchSoft = origPatchSoft;
  }
}

// --- 7. Real DB status (informational) ---

section('Real denizen-db status');
if (denizenDb.enabled) {
  pass(`denizen-db enabled (url=${denizenDb.url ? 'set' : 'unset'})`);
} else {
  gap('denizen-db disabled — live queue/node tests skipped (set SUPABASE_URL to enable)');
}

// --- 8. Minimal HTTP smoke (mountComputeRoutes only) ---

section('HTTP smoke via minimal server');

async function runHttpSmoke() {
  const http = require('node:http');
  const handler = mountComputeRoutes({
    verifyVisitorSession: async () => { throw new Error('bad session'); },
    userIdentity: { getIdentityById: async () => null, getIdentityBySession: async () => null },
  });
  const server = http.createServer(async (req, res) => {
    const handled = await handler(req, res);
    if (!handled && !res.writableEnded) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const httpGet = (path) => new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });

  try {
    const status = await httpGet('/api/compute/node/status');
    assert.equal(status.status, 200);
    const payload = JSON.parse(status.body);
    assert.equal(payload.ok, true);
    assert.ok(Array.isArray(payload.pending_jobs));
    pass('HTTP GET /api/compute/node/status returns 200 with pending_jobs');

    const badSess = await httpGet('/api/compute/node/status?session_id=bad-sess');
    assert.equal(badSess.status, 404);
    pass('HTTP GET status with invalid session_id returns 404');

    const liveMissing = await httpGet('/api/compute/hardware/live');
    assert.equal(liveMissing.status, 400);
    pass('HTTP GET /api/compute/hardware/live without session_id returns 400');

    const liveBad = await httpGet('/api/compute/hardware/live?session_id=bad-sess');
    assert.equal(liveBad.status, 200);
    const liveBadPayload = JSON.parse(liveBad.body);
    assert.equal(liveBadPayload.ok, true);
    pass('HTTP GET /api/compute/hardware/live with invalid session still returns host metrics');
  } catch (err) {
    fail('HTTP smoke', err);
  } finally {
    server.close();
  }
}

// --- Run all ---

(async () => {
  console.log('Compute integration test\n');
  await runQueueTests();
  await runAwardCreditsTest();
  await runSessionRouteTests();
  await runLocalWorkerTests();
  await runDisabledDbTests();
  await runHttpSmoke();

  console.log('\n== Summary ==');
  console.log(`Passed: ${results.pass}`);
  console.log(`Failed: ${results.fail}`);
  if (results.gaps.length) {
    console.log('Gaps:');
    for (const g of results.gaps) console.log(`  - ${g}`);
  }
  process.exit(results.fail > 0 ? 1 : 0);
})();
