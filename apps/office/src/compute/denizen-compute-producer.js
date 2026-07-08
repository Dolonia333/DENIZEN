'use strict';

const computeQueue = require('./denizen-compute-queue.js');
const denizenDb = require('../intelligence/denizen-db');
const promptTuning = require('../intelligence/prompt-tuning');
const npcRoster = require('../npc/npc-roster');
let lmStudioRouter = null;
try { lmStudioRouter = require('../integrations/lm-studio-router'); } catch (_) {}

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MIN_GAP_MS = 5 * 60 * 1000;

let producerTimer = null;
let initialTimer = null;
let lastEnqueuedAt = 0;
let lastJobId = null;
let lastPatrolEnqueuedAt = 0;

function envTriBool(name) {
  const v = process.env[name];
  if (v == null || v === '') return null;
  if (/^(0|false|no|off)$/i.test(String(v))) return false;
  if (/^(1|true|yes|on)$/i.test(String(v))) return true;
  return null;
}

function isMeshConfigured() {
  if (!denizenDb?.enabled) return false;
  const env = process.env;
  return Boolean(
    env.DENIZEN_FLEET_IDENTITY_ID ||
    env.DENIZEN_INTERNAL_API_TOKEN ||
    env.DENIZEN_FLEET_AGENT_TOKEN,
  );
}

function isProducerEnabled() {
  const explicit = envTriBool('DENIZEN_MESH_JOBS');
  if (explicit !== null) return explicit;
  return isMeshConfigured();
}

function isBouncerPatrolEnabled() {
  return envTriBool('BOUNCER_MESH_PATROL') === true;
}

function collectNpcIds(getNpcBrains) {
  try {
    const mgr = typeof getNpcBrains === 'function' ? getNpcBrains() : null;
    const keys = mgr?.brains ? Object.keys(mgr.brains) : [];
    if (keys.length) return keys;
  } catch (_) {}
  return (npcRoster.entries || []).map((e) => e.display);
}

async function enqueueThinkBatch(getNpcBrains) {
  if (!isProducerEnabled() || !denizenDb?.enabled) return null;

  const now = Date.now();
  if (now - lastEnqueuedAt < MIN_GAP_MS) return null;

  const maxPending = Number(process.env.DENIZEN_MESH_PRODUCER_MAX_PENDING) || 10;
  const pending = await computeQueue.listPendingJobs(30).catch(() => []);
  if (pending.length >= maxPending) {
    return null;
  }

  const npcIds = collectNpcIds(getNpcBrains);
  const mgr = typeof getNpcBrains === 'function' ? getNpcBrains() : null;
  const queueDepth = mgr?.getQueueDepth?.() || 0;
  const saturated = lmStudioRouter?.isSaturated?.(queueDepth);
  const hasRemote = lmStudioRouter?.hasRemoteNodes?.();
  let priority = promptTuning?.economyMode ? 55 : 50;
  if (saturated && hasRemote) priority = Math.min(100, priority + 15);

  try {
    const job = await computeQueue.enqueueJob({
      jobType: 'npc_think_batch',
      payload: {
        npc_ids: npcIds,
        source: 'mesh_producer',
        economy_mode: !!promptTuning?.economyMode,
        inference_saturated: saturated,
        offload_remote: !!(saturated && hasRemote),
      },
      priority,
    });
    if (job?.id) {
      lastEnqueuedAt = now;
      lastJobId = job.id;
    }
    return job;
  } catch (err) {
    console.warn('[compute-producer] enqueue failed:', err?.message || err);
    return null;
  }
}

async function enqueueGrokTelemetryCheck() {
  if (!isProducerEnabled() || !denizenDb?.enabled) return null;

  const pending = await computeQueue.listPendingJobs(50).catch(() => []);
  const alreadyQueued = pending.some((j) => j.job_type === 'grok_telemetry_check');
  if (alreadyQueued) return null;

  const now = Date.now();
  if (now - lastEnqueuedAt < MIN_GAP_MS) return null;

  try {
    const job = await computeQueue.enqueueJob({
      jobType: 'grok_telemetry_check',
      payload: {
        source: 'mesh_producer',
        note: 'Run grok-mesh-telemetry-job.py to analyze and auto-enqueue consults',
      },
      priority: 40,
    });
    if (job?.id) {
      console.log('[compute-producer] enqueued grok_telemetry_check');
    }
    return job;
  } catch (err) {
    console.warn('[compute-producer] telemetry enqueue failed:', err?.message || err);
    return null;
  }
}

function normalizeNodeHost(node = {}) {
  const fromHost = String(node.host || '').trim();
  if (fromHost) return fromHost;
  const fromUrl = String(node.url || '').trim();
  if (!fromUrl) return '';
  try {
    return new URL(fromUrl).hostname || '';
  } catch (_) {
    return '';
  }
}

async function enqueueBouncerPatrol() {
  if (!isProducerEnabled() || !denizenDb?.enabled || !isBouncerPatrolEnabled()) return null;

  const now = Date.now();
  if (now - lastPatrolEnqueuedAt < MIN_GAP_MS) return null;

  const pending = await computeQueue.listPendingJobs(100).catch(() => []);
  const queuedNodeIds = new Set(
    pending
      .filter((job) => job.job_type === 'bouncer_patrol')
      .map((job) => String(job.payload?.node_id || '').trim())
      .filter(Boolean),
  );
  const nodes = lmStudioRouter?.listNodes?.() || [];
  const candidates = nodes
    .map((node) => {
      const nodeId = String(node.node_id || node.id || node.machine_id || node.url || '').trim();
      const host = normalizeNodeHost(node);
      if (!nodeId || !host) return null;
      return {
        node_id: nodeId,
        url: node.url || null,
        host,
        health_url: node.health_url || null,
      };
    })
    .filter(Boolean)
    .filter((node) => !queuedNodeIds.has(node.node_id));

  if (!candidates.length) return null;

  const jobs = [];
  for (const node of candidates) {
    try {
      const job = await computeQueue.enqueueJob({
        jobType: 'bouncer_patrol',
        payload: {
          ...node,
          source: 'mesh_producer',
        },
        priority: 45,
      });
      if (job?.id) jobs.push(job);
    } catch (err) {
      console.warn('[compute-producer] bouncer patrol enqueue failed:', err?.message || err);
    }
  }

  if (jobs.length) {
    lastPatrolEnqueuedAt = now;
  }
  return jobs;
}

function startMeshJobProducer(ctx = {}) {
  if (!isProducerEnabled()) {
    return { ok: false, reason: 'disabled' };
  }
  if (producerTimer || initialTimer) {
    return { ok: true, alreadyRunning: true };
  }

  const intervalMs = Math.max(
    MIN_GAP_MS,
    Number(process.env.DENIZEN_MESH_JOBS_INTERVAL_MS) || DEFAULT_INTERVAL_MS,
  );
  const getNpcBrains = ctx.getNpcBrains;
  const tick = () => {
    enqueueThinkBatch(getNpcBrains).catch(() => {});
    enqueueBouncerPatrol().catch(() => {});
    // Occasionally enqueue telemetry check (every ~3 ticks)
    if (Math.random() < 0.33) {
      enqueueGrokTelemetryCheck().catch(() => {});
    }
  };

  const initialDelayMs = Math.min(60_000, intervalMs);
  initialTimer = setTimeout(() => {
    initialTimer = null;
    tick();
    producerTimer = setInterval(tick, intervalMs);
    producerTimer.unref?.();
  }, initialDelayMs);
  initialTimer.unref?.();

  console.log(
    `[compute-producer] mesh jobs ON — npc_think_batch every ${Math.round(intervalMs / 1000)}s` +
    (promptTuning?.economyMode ? ' (economy mode)' : ''),
  );

  return { ok: true, running: true, intervalMs, initialDelayMs };
}

function stopMeshJobProducer() {
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  if (producerTimer) {
    clearInterval(producerTimer);
    producerTimer = null;
  }
  return { ok: true, running: false };
}

function getStatus() {
  return {
    enabled: isProducerEnabled(),
    mesh_configured: isMeshConfigured(),
    running: !!(producerTimer || initialTimer),
    last_enqueued_at: lastEnqueuedAt ? new Date(lastEnqueuedAt).toISOString() : null,
    last_job_id: lastJobId,
  };
}

module.exports = {
  isProducerEnabled,
  isMeshConfigured,
  isBouncerPatrolEnabled,
  enqueueThinkBatch,
  enqueueBouncerPatrol,
  startMeshJobProducer,
  stopMeshJobProducer,
  getStatus,
};
