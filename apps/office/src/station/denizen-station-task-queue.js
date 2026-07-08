'use strict';

const crypto = require('node:crypto');

let denizenDb = null;
try { denizenDb = require('../intelligence/denizen-db'); } catch (_) {}

const pendingByInstall = new Map();
const tasksById = new Map();
const completionWaiters = new Map();

const MAX_TASK_AGE_MS = 15 * 60 * 1000;
const DEFAULT_WAIT_MS = 12 * 60 * 1000;
const DB_POLL_MS = 500;

function useDb() {
  return !!(denizenDb?.enabled);
}

function rowToTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    session_id: row.session_id,
    install_id: row.install_id,
    kind: row.kind,
    skill: row.skill || null,
    npc_name: row.npc_name || 'Denizen',
    instruction: row.instruction || '',
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    status: row.status || 'pending',
    created_at: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    claimed_at: row.claimed_at ? new Date(row.claimed_at).getTime() : null,
    completed_at: row.completed_at ? new Date(row.completed_at).getTime() : null,
    result: row.result || null,
  };
}

function pruneExpiredMemory() {
  const now = Date.now();
  for (const [installId, task] of pendingByInstall.entries()) {
    if (!task || now - task.created_at > MAX_TASK_AGE_MS) {
      pendingByInstall.delete(installId);
      if (task?.id) tasksById.delete(task.id);
    }
  }
}

async function pruneExpiredDb() {
  if (!useDb()) return;
  const cutoff = new Date(Date.now() - MAX_TASK_AGE_MS).toISOString();
  await denizenDb._patch(
    `denizen_station_tasks?status=in.(pending,claimed)&created_at=lt.${encodeURIComponent(cutoff)}`,
    { status: 'failed', result: { ok: false, error: 'expired' }, completed_at: new Date().toISOString() },
    { prefer: 'return=minimal' },
  ).catch(() => {});
}

function storeMemoryTask(task) {
  pendingByInstall.set(task.install_id, task);
  tasksById.set(task.id, task);
}

async function insertDbTask(task) {
  await denizenDb._post('denizen_station_tasks', {
    id: task.id,
    session_id: task.session_id,
    install_id: task.install_id,
    kind: task.kind,
    skill: task.skill,
    npc_name: task.npc_name,
    instruction: task.instruction,
    payload: task.payload,
    status: task.status,
    created_at: new Date(task.created_at).toISOString(),
  }, { prefer: 'return=minimal' });
}

async function enqueueTask({
  sessionId,
  installId,
  kind,
  skill = null,
  npcName = 'Denizen',
  instruction = '',
  payload = {},
} = {}) {
  pruneExpiredMemory();
  await pruneExpiredDb();

  const install = String(installId || '').trim();
  const session = String(sessionId || '').trim();
  if (!install || !session) return null;

  if (useDb()) {
    const pending = await denizenDb._get(
      `denizen_station_tasks?select=*&install_id=eq.${encodeURIComponent(install)}&status=eq.pending&order=created_at.desc&limit=1`,
    ).catch(() => []);
    const existing = rowToTask(pending?.[0]);
    if (existing && Date.now() - existing.created_at <= MAX_TASK_AGE_MS) {
      return { queued: false, error: 'station_busy', task: existing };
    }
  } else {
    const existing = pendingByInstall.get(install);
    if (existing && Date.now() - existing.created_at <= MAX_TASK_AGE_MS) {
      return { queued: false, error: 'station_busy', task: existing };
    }
  }

  const task = {
    id: crypto.randomBytes(10).toString('hex'),
    session_id: session,
    install_id: install,
    kind: String(kind || 'screen_observe'),
    skill: skill || null,
    npc_name: String(npcName || 'Denizen'),
    instruction: String(instruction || '').slice(0, 4000),
    payload: payload && typeof payload === 'object' ? payload : {},
    status: 'pending',
    created_at: Date.now(),
    claimed_at: null,
    completed_at: null,
    result: null,
  };

  storeMemoryTask(task);
  if (useDb()) {
    try {
      await insertDbTask(task);
    } catch (err) {
      pendingByInstall.delete(install);
      tasksById.delete(task.id);
      throw err;
    }
  }
  return { queued: true, task };
}

async function claimTask(installId) {
  pruneExpiredMemory();
  const install = String(installId || '').trim();
  if (!install) return null;

  if (useDb()) {
    const rows = await denizenDb._get(
      `denizen_station_tasks?select=*&install_id=eq.${encodeURIComponent(install)}&status=eq.pending&order=created_at.asc&limit=1`,
    ).catch(() => []);
    const row = rows?.[0];
    if (!row) return null;
    const claimedAt = new Date().toISOString();
    await denizenDb._patch(
      `denizen_station_tasks?id=eq.${encodeURIComponent(row.id)}&status=eq.pending`,
      { status: 'claimed', claimed_at: claimedAt },
      { prefer: 'return=representation' },
    ).catch(() => {});
    const task = rowToTask({ ...row, status: 'claimed', claimed_at: claimedAt });
    storeMemoryTask(task);
    return task;
  }

  const task = pendingByInstall.get(install);
  if (!task || task.status !== 'pending') return null;
  task.status = 'claimed';
  task.claimed_at = Date.now();
  return task;
}

async function getTask(taskId) {
  pruneExpiredMemory();
  const id = String(taskId || '');
  if (!id) return null;

  const mem = tasksById.get(id);
  if (mem) return mem;

  if (!useDb()) return null;
  const rows = await denizenDb._get(
    `denizen_station_tasks?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
  ).catch(() => []);
  const task = rowToTask(rows?.[0]);
  if (task) tasksById.set(id, task);
  return task;
}

async function completeTask(taskId, result = {}) {
  const task = await getTask(taskId);
  if (!task) return { ok: false, error: 'task_not_found' };
  if (task.status === 'completed') return { ok: true, task };

  task.status = 'completed';
  task.completed_at = Date.now();
  task.result = result;
  pendingByInstall.delete(task.install_id);
  tasksById.set(task.id, task);

  if (useDb()) {
    await denizenDb._patch(
      `denizen_station_tasks?id=eq.${encodeURIComponent(task.id)}`,
      {
        status: 'completed',
        result,
        completed_at: new Date(task.completed_at).toISOString(),
      },
      { prefer: 'return=minimal' },
    ).catch(() => {});
  }

  const waiter = completionWaiters.get(task.id);
  if (typeof waiter === 'function') {
    completionWaiters.delete(task.id);
    waiter({ ok: true, task, result });
  }

  return { ok: true, task };
}

async function failTask(taskId, error = 'task_failed') {
  return completeTask(taskId, { ok: false, error: String(error || 'task_failed') });
}

function waitForTask(taskId, { timeoutMs = DEFAULT_WAIT_MS } = {}) {
  const id = String(taskId || '');
  if (!id) return Promise.reject(new Error('taskId required'));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      completionWaiters.delete(id);
      failTask(id, 'task_timeout').catch(() => {});
      reject(new Error('Station task timed out — is Denizen Desktop running?'));
    }, timeoutMs);

    const finish = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };

    completionWaiters.set(id, finish);

    const poll = async () => {
      if (!completionWaiters.has(id)) return;
      const existing = await getTask(id);
      if (existing?.status === 'completed') {
        completionWaiters.delete(id);
        clearTimeout(timer);
        resolve({ ok: true, task: existing, result: existing.result });
        return;
      }
      setTimeout(poll, DB_POLL_MS);
    };

    getTask(id).then((existing) => {
      if (existing?.status === 'completed') {
        completionWaiters.delete(id);
        clearTimeout(timer);
        resolve({ ok: true, task: existing, result: existing.result });
      } else {
        poll();
      }
    }).catch(() => poll());
  });
}

async function getPendingForInstall(installId) {
  pruneExpiredMemory();
  const install = String(installId || '');
  if (!install) return null;

  if (useDb()) {
    const rows = await denizenDb._get(
      `denizen_station_tasks?select=*&install_id=eq.${encodeURIComponent(install)}&status=eq.pending&order=created_at.asc&limit=1`,
    ).catch(() => []);
    return rowToTask(rows?.[0]) || null;
  }

  const task = pendingByInstall.get(install);
  if (!task || task.status !== 'pending') return null;
  return task;
}

module.exports = {
  enqueueTask,
  claimTask,
  completeTask,
  failTask,
  waitForTask,
  getTask,
  getPendingForInstall,
  MAX_TASK_AGE_MS,
};
