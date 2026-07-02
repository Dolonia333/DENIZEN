'use strict';

const stationAgent = require('./station-agent');

const TASK_POLL_MS = 2000;

let pollTimer = null;
let runningTaskId = null;

function stopStationTaskLoop() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  runningTaskId = null;
}

async function claimTask(getSetup, desktopApi) {
  const setup = getSetup();
  if (!setup?.completed || !setup.sessionId || !setup.desktopInstallId) return null;

  const data = await desktopApi(
    setup.serverUrl,
    '/api/desktop/station/tasks/claim',
    {
      session_id: setup.sessionId,
      install_id: setup.desktopInstallId,
    },
    setup,
    { method: 'GET' },
  );

  return data?.task || null;
}

async function completeTask(getSetup, desktopApi, taskId, result) {
  const setup = getSetup();
  if (!setup?.completed || !setup.sessionId) return null;

  return desktopApi(
    setup.serverUrl,
    '/api/desktop/station/tasks/complete',
    {
      session_id: setup.sessionId,
      install_id: setup.desktopInstallId,
      task_id: taskId,
      result,
    },
    setup,
  );
}

async function runClaimedTask(task, { getSetup, desktopApi, onProgress }) {
  const setup = getSetup();
  try {
    const result = await stationAgent.executeTask(task, {
      desktopApi,
      setup,
      onProgress,
    });
    await completeTask(getSetup, desktopApi, task.id, result);
    return result;
  } catch (err) {
    const failure = {
      ok: false,
      error: err?.message || String(err),
    };
    await completeTask(getSetup, desktopApi, task.id, failure).catch(() => {});
    return failure;
  }
}

function startStationTaskLoop({ getSetup, desktopApi, onProgress }) {
  stopStationTaskLoop();

  const tick = async () => {
    if (runningTaskId) return;
    try {
      const task = await claimTask(getSetup, desktopApi);
      if (!task?.id) return;
      runningTaskId = task.id;
      await runClaimedTask(task, { getSetup, desktopApi, onProgress });
    } catch (err) {
      console.warn('[denizen-desktop] station task poll failed:', err?.message || err);
    } finally {
      runningTaskId = null;
    }
  };

  tick();
  pollTimer = setInterval(tick, TASK_POLL_MS);
}

module.exports = {
  startStationTaskLoop,
  stopStationTaskLoop,
  TASK_POLL_MS,
};
