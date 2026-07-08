'use strict';

/**
 * Server-side grok_telemetry_check executor — NAS runs telemetry without desktop mesh worker.
 * Claims pending jobs, runs infra/grok-mesh-telemetry-job.py, completes/fails in compute queue.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const nodeWorker = require('./denizen-node-worker.js');

const DEFAULT_INTERVAL_MS = Number(process.env.DENIZEN_SERVER_TELEMETRY_POLL_MS) || 60_000;
function resolveServerNodeId() {
  const configured = String(process.env.DENIZEN_SERVER_TELEMETRY_NODE_ID || '').trim();
  if (nodeWorker.isUuid(configured)) return configured;
  return nodeWorker.BUILTIN_SERVER_NODE_ID;
}
const SERVER_NODE_ID = resolveServerNodeId();
const JOB_TYPE = 'grok_telemetry_check';
const SCRIPT_PATH = path.join(__dirname, '..', 'infra', 'grok-mesh-telemetry-job.py');
const TIMEOUT_MS = Number(process.env.DENIZEN_TELEMETRY_JOB_TIMEOUT_MS) || 120_000;

let workerTimer = null;
let running = false;
let lastRunAt = 0;
let lastResult = null;
let nodeReady = false;
let nodeBootstrapPromise = null;

async function ensureServerNodeReady(log) {
  if (nodeReady) return true;
  if (!nodeBootstrapPromise) {
    nodeBootstrapPromise = nodeWorker.ensureBuiltinServerNode({
      nodeId: SERVER_NODE_ID,
      identityId: process.env.DENIZEN_FLEET_IDENTITY_ID || null,
    }).then(() => {
      nodeReady = true;
      return true;
    }).catch((err) => {
      log?.warn?.('MeshTelemetryWorker', `server node registration failed: ${err?.message || err}`);
      nodeBootstrapPromise = null;
      return false;
    });
  }
  return nodeBootstrapPromise;
}

function resolvePythonBin() {
  const explicit = String(process.env.DENIZEN_PYTHON_BIN || '').trim();
  if (explicit) return explicit;
  if (process.platform === 'win32') return 'python';
  return 'python3';
}

function runGrokTelemetryScript(opts = {}) {
  const pythonBin = opts.pythonBin || resolvePythonBin();
  const script = opts.scriptPath || SCRIPT_PATH;
  const cwd = path.dirname(script);
  const timeoutMs = opts.timeoutMs || TIMEOUT_MS;

  if (!fs.existsSync(script)) {
    return Promise.resolve({
      ok: false,
      error: `missing script: ${script}`,
      completed_at: new Date().toISOString(),
    });
  }

  return new Promise((resolve) => {
    const proc = spawn(pythonBin, [script], {
      cwd,
      env: { ...process.env, GROK_AGENT: '1' },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try { proc.kill('SIGTERM'); } catch (_) {}
    }, timeoutMs);

    proc.stdout?.on('data', (c) => { stdout += c; });
    proc.stderr?.on('data', (c) => { stderr += c; });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        jobType: JOB_TYPE,
        error: err.code === 'ENOENT'
          ? `python not found (${pythonBin}) — install python3 in container or set DENIZEN_PYTHON_BIN`
          : err.message,
        completed_at: new Date().toISOString(),
      });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !killed,
        jobType: JOB_TYPE,
        exit_code: code,
        killed,
        output: (stdout + stderr).slice(0, 4000),
        completed_at: new Date().toISOString(),
      });
    });
  });
}

async function processOneTelemetryJob(computeQueue, opts = {}) {
  if (!computeQueue?.claimJobByTypes) return { processed: false, reason: 'no_claim_api' };
  const ready = await ensureServerNodeReady(opts.log);
  if (!ready) return { processed: false, reason: 'node_not_ready' };

  const job = await computeQueue.claimJobByTypes(SERVER_NODE_ID, [JOB_TYPE], null, {
    serverWorker: true,
  });
  if (!job) return { processed: false, reason: 'no_pending' };

  const runFn = opts.runScript || runGrokTelemetryScript;
  const result = await runFn(opts.runScriptOpts || {});

  try {
    if (result.ok) {
      await computeQueue.completeJob(job.id, SERVER_NODE_ID, {
        ...result,
        server_worker: true,
        job_type: JOB_TYPE,
      });
      return { processed: true, ok: true, job_id: job.id, result };
    }
    await computeQueue.failJob(job.id, SERVER_NODE_ID, result.error || result.output || 'telemetry job failed');
    return { processed: true, ok: false, job_id: job.id, result };
  } catch (err) {
    try {
      await computeQueue.failJob(job.id, SERVER_NODE_ID, err?.message || String(err));
    } catch (_) {}
    return { processed: true, ok: false, job_id: job.id, error: err?.message || String(err) };
  }
}

async function drainTelemetryQueue(computeQueue, opts = {}) {
  const maxJobs = Math.max(1, Number(opts.maxJobs) || 5);
  const outcomes = [];
  for (let i = 0; i < maxJobs; i += 1) {
    const one = await processOneTelemetryJob(computeQueue, opts);
    outcomes.push(one);
    if (!one.processed || one.reason === 'no_pending') break;
  }
  return outcomes;
}

async function tick(computeQueue, opts = {}) {
  if (running) return { skipped: true, reason: 'busy' };
  running = true;
  lastRunAt = Date.now();
  try {
    const outcomes = await drainTelemetryQueue(computeQueue, opts);
    lastResult = { at: lastRunAt, outcomes };
    const processed = outcomes.filter((o) => o.processed).length;
    if (processed > 0) {
      opts.log?.info?.('MeshTelemetryWorker', `processed ${processed} grok_telemetry_check job(s)`);
    }
    return lastResult;
  } finally {
    running = false;
  }
}

function startServerTelemetryWorker({ computeQueue, log, intervalMs, ...opts } = {}) {
  if (workerTimer) return { ok: true, alreadyRunning: true };
  if (process.env.DENIZEN_SERVER_TELEMETRY_WORKER === '0') {
    return { ok: false, reason: 'disabled' };
  }
  if (!computeQueue) return { ok: false, reason: 'no_compute_queue' };

  const ms = Number(intervalMs) || DEFAULT_INTERVAL_MS;
  const tickOpts = { ...opts, log };

  ensureServerNodeReady(log).then((ready) => {
    if (!ready) return;
    tick(computeQueue, tickOpts).catch((err) => {
      log?.warn?.('MeshTelemetryWorker', err?.message || err);
    });
  });

  workerTimer = setInterval(() => {
    tick(computeQueue, tickOpts).catch((err) => {
      log?.warn?.('MeshTelemetryWorker', err?.message || err);
    });
  }, ms);
  if (workerTimer.unref) workerTimer.unref();

  log?.info?.('MeshTelemetryWorker', `ON — server claims ${JOB_TYPE} every ${Math.round(ms / 1000)}s as ${SERVER_NODE_ID}`);
  return { ok: true, running: true, intervalMs: ms, nodeId: SERVER_NODE_ID };
}

function stopServerTelemetryWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
  return { ok: true, running: false };
}

function getStatus() {
  return {
    running: !!workerTimer,
    busy: running,
    nodeId: SERVER_NODE_ID,
    lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
    lastResult,
  };
}

module.exports = {
  SERVER_NODE_ID,
  JOB_TYPE,
  SCRIPT_PATH,
  resolvePythonBin,
  runGrokTelemetryScript,
  processOneTelemetryJob,
  drainTelemetryQueue,
  tick,
  startServerTelemetryWorker,
  stopServerTelemetryWorker,
  getStatus,
};
