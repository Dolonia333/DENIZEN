'use strict';

const { requireDenizenSrc } = require('./denizen-src');
const nodeClient = requireDenizenSrc('denizen-node-client');
const { processMeshJob } = requireDenizenSrc('denizen-mesh-job-runner');
const { collectLiveMetrics } = require('./node-profiler');

const HEARTBEAT_INTERVAL_MS = 30_000;

let heartbeatTimer = null;

async function processJobLocally(job, ctx = {}) {
  const jobType = String(job?.job_type || job?.jobType || '').trim();
  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
  return processMeshJob(jobType, payload);
}

async function registerComputeNode(setup, desktopApi, onSetupPatch) {
  const identityId = String(setup?.identityId || '').trim();
  if (!identityId || !setup?.serverUrl) return null;

  if (setup.nodeToken && setup.nodeId) {
    return { nodeId: setup.nodeId, nodeToken: setup.nodeToken };
  }

  const data = await desktopApi(
    setup.serverUrl,
    '/api/compute/node/register',
    { identityId },
    setup,
  );

  const node = data?.node;
  if (!node?.id || !node?.endpoint_token) return null;

  const patch = {
    nodeId: node.id,
    nodeToken: node.endpoint_token,
  };
  if (typeof onSetupPatch === 'function') {
    onSetupPatch(patch);
  }
  return patch;
}

function stopHeartbeatLoop() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeatLoop(getSetup, desktopApi) {
  stopHeartbeatLoop();

  const tick = async () => {
    const setup = typeof getSetup === 'function' ? getSetup() : null;
    if (!setup?.nodeId || !setup?.nodeToken || !setup?.serverUrl) return;
    try {
      let liveMetrics = null;
      try {
        liveMetrics = await collectLiveMetrics({
          machine_id: setup.desktopInstallId ? `desktop-${setup.desktopInstallId}` : `node-${setup.nodeId}`,
          contributing: !!setup.optIn,
          jobs_completed: 0,
          brain_model: setup.brainModel || null,
        });
        if (setup.brainModel && liveMetrics?.inference) {
          liveMetrics.inference.main_model = setup.brainModel;
          liveMetrics.inference.fast_model = liveMetrics.inference.fast_model || setup.brainModel;
        }
      } catch (_) {}
      await desktopApi(
        setup.serverUrl,
        '/api/compute/node/heartbeat',
        {
          nodeId: setup.nodeId,
          nodeToken: setup.nodeToken,
          live_metrics: liveMetrics,
          machine_id: liveMetrics?.machine_id,
        },
        setup,
      );
    } catch (err) {
      console.warn('[denizen-desktop] compute heartbeat failed:', err?.message || err);
    }
  };

  tick();
  heartbeatTimer = setInterval(tick, HEARTBEAT_INTERVAL_MS);
}

async function startComputeWorker(setup, desktopApi, onSetupPatch, getSetup) {
  const resolveSetup = () => (typeof getSetup === 'function' ? getSetup() : setup);
  let current = resolveSetup();

  if (!current?.nodeToken && current?.identityId) {
    await registerComputeNode(current, desktopApi, onSetupPatch);
    current = resolveSetup();
  }

  if (!current?.optIn || !current?.identityId || !current?.nodeToken) {
    stopComputeWorker();
    return { ok: false, running: false };
  }

  nodeClient.startWorkerLoop({
    identityId: current.identityId,
    nodeToken: current.nodeToken,
    baseUrl: current.serverUrl,
    processJobLocally,
  });

  startHeartbeatLoop(getSetup || (() => current), desktopApi);
  return { ok: true, running: true };
}

function stopComputeWorker() {
  stopHeartbeatLoop();
  return nodeClient.stopWorkerLoop();
}

module.exports = {
  registerComputeNode,
  startComputeWorker,
  stopComputeWorker,
  processJobLocally,
  HEARTBEAT_INTERVAL_MS,
};
