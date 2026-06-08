'use strict';

const os = require('os');
const pkg = require('./package.json');
const { collectMachineProfile, collectLiveMetrics } = require('./node-profiler');
const {
  registerComputeNode,
  startComputeWorker,
  stopComputeWorker,
} = require('./compute-worker');

const APP_VERSION = pkg.version || '0.1.0';
const UPDATE_CHANNEL = process.env.DENIZEN_UPDATE_CHANNEL || pkg.updateChannel || 'stable';

const SYNC_INTERVAL_MS = 60_000;
const PERMISSION_POLL_MS = 5_000;

let syncTimer = null;
let pollTimer = null;
let lastPendingId = null;

function stopWorkerLoop() {
  stopComputeWorker();
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  lastPendingId = null;
}

async function syncCapabilities(getSetup, desktopApi, onSetupPatch) {
  const setup = getSetup();
  if (!setup?.completed || !setup.sessionId) return null;

  const machine = collectMachineProfile();
  let liveMetrics = null;
  try {
    liveMetrics = await collectLiveMetrics({
      machine_id: setup.desktopInstallId ? `desktop-${setup.desktopInstallId}` : undefined,
      contributing: setup.optIn !== false,
      jobs_completed: 0,
    });
    machine.live_metrics = liveMetrics;
  } catch (err) {
    console.warn('[denizen-desktop] live metrics sample failed:', err?.message || err);
  }
  const data = await desktopApi(
    setup.serverUrl,
    '/api/desktop/capabilities/sync',
    {
      session_id: setup.sessionId,
      machine,
      live_metrics: liveMetrics,
      machine_id: liveMetrics?.machine_id || machine.hostname,
      agent_permission_level: setup.permission || 'ask',
      opt_in: setup.optIn !== false,
      desktop_install_id: setup.desktopInstallId || null,
      app_version: APP_VERSION,
      platform: process.platform,
      arch: process.arch,
      os_version: os.release(),
      update_channel: UPDATE_CHANNEL,
    },
    setup,
  );

  const node = data?.node;
  if (node?.id && node?.endpoint_token && typeof onSetupPatch === 'function') {
    onSetupPatch({
      nodeId: node.id,
      nodeToken: node.endpoint_token,
    });
  }
  return data;
}

async function pollPendingPermission(getSetup, desktopApi, onPermissionPending) {
  const setup = getSetup();
  if (!setup?.completed || !setup.sessionId) return;

  const data = await desktopApi(
    setup.serverUrl,
    '/api/desktop/permission/pending',
    { session_id: setup.sessionId },
    setup,
    { method: 'GET' },
  );

  const pending = data?.pending || null;
  if (!pending?.id) {
    lastPendingId = null;
    return;
  }
  if (pending.id === lastPendingId) return;
  lastPendingId = pending.id;
  if (typeof onPermissionPending === 'function') {
    onPermissionPending(pending);
  }
}

function clearLastPendingId() {
  lastPendingId = null;
}

async function bootstrapComputeWorker(getSetup, desktopApi, onSetupPatch) {
  const setup = getSetup();
  if (!setup?.completed) return;

  if (!setup.nodeToken && setup.identityId) {
    await registerComputeNode(setup, desktopApi, onSetupPatch).catch((err) => {
      console.warn('[denizen-desktop] compute node register failed:', err?.message || err);
    });
  }

  const fresh = getSetup();
  if (fresh.optIn && fresh.identityId && fresh.nodeToken) {
    await startComputeWorker(fresh, desktopApi, onSetupPatch, getSetup).catch((err) => {
      console.warn('[denizen-desktop] compute worker start failed:', err?.message || err);
    });
  } else {
    stopComputeWorker();
  }
}

function startWorkerLoop({ getSetup, desktopApi, onPermissionPending, onSetupPatch }) {
  stopWorkerLoop();

  const runSync = () => {
    syncCapabilities(getSetup, desktopApi, onSetupPatch)
      .then(() => bootstrapComputeWorker(getSetup, desktopApi, onSetupPatch))
      .catch((err) => {
        console.warn('[denizen-desktop] capabilities sync failed:', err?.message || err);
      });
  };

  const runPoll = () => {
    pollPendingPermission(getSetup, desktopApi, onPermissionPending).catch((err) => {
      console.warn('[denizen-desktop] permission poll failed:', err?.message || err);
    });
  };

  runSync();
  runPoll();

  syncTimer = setInterval(runSync, SYNC_INTERVAL_MS);
  pollTimer = setInterval(runPoll, PERMISSION_POLL_MS);
}

module.exports = {
  startWorkerLoop,
  stopWorkerLoop,
  clearLastPendingId,
  SYNC_INTERVAL_MS,
  PERMISSION_POLL_MS,
};
