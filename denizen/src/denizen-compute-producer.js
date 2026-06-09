'use strict';

const computeQueue = require('./denizen-compute-queue.js');
const denizenDb = require('./denizen-db.js');
const promptTuning = require('./prompt-tuning.js');
const npcRoster = require('./npc-roster.js');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MIN_GAP_MS = 5 * 60 * 1000;

let producerTimer = null;
let initialTimer = null;
let lastEnqueuedAt = 0;
let lastJobId = null;

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
  try {
    const job = await computeQueue.enqueueJob({
      jobType: 'npc_think_batch',
      payload: {
        npc_ids: npcIds,
        source: 'mesh_producer',
        economy_mode: !!promptTuning?.economyMode,
      },
      priority: promptTuning?.economyMode ? 55 : 50,
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
  enqueueThinkBatch,
  startMeshJobProducer,
  stopMeshJobProducer,
  getStatus,
};
