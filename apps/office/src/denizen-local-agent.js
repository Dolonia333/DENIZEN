'use strict';

const fs = require('node:fs');
const path = require('node:path');
const desktopAgent = require('./desktop-agent');

const PERM_FILE = path.join(__dirname, '..', 'data', 'local-agent-permissions.json');
const VALID_LEVELS = new Set(['off', 'ask', 'trusted']);
const DEFAULT_LEVEL = 'off';

const pendingApprovals = new Map();
const activeBackgroundRuns = new Map();

function _loopbackAddress(raw) {
  const ip = String(raw || '').trim();
  if (!ip) return false;
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === 'localhost'
  );
}

function _isTrustedLocalCaller(opts = {}) {
  if (opts.trustedCaller === true) return true;
  return _loopbackAddress(opts.remoteAddress);
}

function _readPermissionFile() {
  try {
    if (!fs.existsSync(PERM_FILE)) {
      return { level: DEFAULT_LEVEL, updatedAt: 0 };
    }
    const parsed = JSON.parse(fs.readFileSync(PERM_FILE, 'utf8'));
    const level = VALID_LEVELS.has(parsed?.level) ? parsed.level : DEFAULT_LEVEL;
    const updatedAt = Number(parsed?.updatedAt) || 0;
    return { level, updatedAt };
  } catch (_) {
    return { level: DEFAULT_LEVEL, updatedAt: 0 };
  }
}

function _writePermissionFile(next) {
  const payload = {
    level: VALID_LEVELS.has(next?.level) ? next.level : DEFAULT_LEVEL,
    updatedAt: Number(next?.updatedAt) || Date.now(),
  };
  try {
    fs.mkdirSync(path.dirname(PERM_FILE), { recursive: true });
    const tmp = `${PERM_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, PERM_FILE);
  } catch (_) {
    try {
      fs.writeFileSync(PERM_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (__) {}
  }
  return payload;
}

function _newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getPermissions() {
  return _readPermissionFile();
}

function setPermissionLevel(level) {
  const normalized = String(level || '').trim().toLowerCase();
  if (!VALID_LEVELS.has(normalized)) {
    throw new Error(`Invalid permission level "${level}". Use off, ask, or trusted.`);
  }
  return _writePermissionFile({ level: normalized, updatedAt: Date.now() });
}

function canRunAgent(npcName) {
  if (!String(npcName || '').trim()) return false;
  const perms = getPermissions();
  return perms.level === 'trusted';
}

function createPendingApproval(id, instruction, meta = {}) {
  const approvalId = String(id || _newId('approval'));
  const item = {
    id: approvalId,
    instruction: String(instruction || '').trim(),
    npcName: String(meta.npcName || 'Lucy'),
    mode: meta.mode === 'background' ? 'background' : 'visible',
    status: 'pending',
    createdAt: Date.now(),
    decidedAt: null,
    reason: null,
  };
  pendingApprovals.set(approvalId, item);
  return item;
}

function approvePendingApproval(id) {
  const key = String(id || '');
  const existing = pendingApprovals.get(key);
  if (!existing) return null;
  existing.status = 'approved';
  existing.decidedAt = Date.now();
  existing.reason = null;
  return existing;
}

function rejectPendingApproval(id, reason) {
  const key = String(id || '');
  const existing = pendingApprovals.get(key);
  if (!existing) return null;
  existing.status = 'rejected';
  existing.decidedAt = Date.now();
  existing.reason = String(reason || 'rejected');
  return existing;
}

function getPendingApproval(id) {
  return pendingApprovals.get(String(id || '')) || null;
}

function listPendingApprovals() {
  return Array.from(pendingApprovals.values());
}

async function _runDesktopTaskAllowed(payload) {
  return desktopAgent.runDesktopTask({
    instruction: payload.instruction,
    npcName: payload.npcName,
    broadcast: payload.broadcast,
  });
}

async function requestAgentTask(payload = {}) {
  const instruction = String(payload.instruction || '').trim();
  const npcName = String(payload.npcName || 'Lucy').trim() || 'Lucy';
  const mode = payload.mode === 'background' ? 'background' : 'visible';

  if (!instruction) {
    return { ok: false, error: 'instruction_required', code: 'INVALID_INPUT' };
  }
  if (!_isTrustedLocalCaller(payload)) {
    return { ok: false, error: 'remote_requests_forbidden', code: 'REMOTE_NOT_ALLOWED' };
  }

  const perms = getPermissions();
  if (perms.level === 'off') {
    return { ok: false, error: 'local_agent_off', code: 'PERMISSION_DENIED', permissionLevel: 'off' };
  }

  if (perms.level === 'ask') {
    const existingApproval = payload.approvalId ? getPendingApproval(payload.approvalId) : null;
    if (!existingApproval || existingApproval.status !== 'approved') {
      const pending = createPendingApproval(payload.approvalId || _newId('approval'), instruction, { npcName, mode });
      return {
        ok: false,
        code: 'APPROVAL_REQUIRED',
        permissionLevel: 'ask',
        requiresApproval: true,
        pendingApproval: pending,
      };
    }
  }

  if (mode === 'background') {
    const runId = _newId('desktop_task');
    activeBackgroundRuns.set(runId, {
      id: runId,
      npcName,
      instruction,
      status: 'running',
      startedAt: Date.now(),
      result: null,
      error: null,
    });
    _runDesktopTaskAllowed({ instruction, npcName, broadcast: payload.broadcast })
      .then((result) => {
        const run = activeBackgroundRuns.get(runId);
        if (!run) return;
        run.status = result?.ok ? 'done' : 'failed';
        run.finishedAt = Date.now();
        run.result = result || null;
      })
      .catch((err) => {
        const run = activeBackgroundRuns.get(runId);
        if (!run) return;
        run.status = 'failed';
        run.finishedAt = Date.now();
        run.error = err?.message || String(err);
      });
    return { ok: true, async: true, runId, permissionLevel: perms.level, mode };
  }

  const result = await _runDesktopTaskAllowed({ instruction, npcName, broadcast: payload.broadcast });
  return {
    ok: !!result?.ok,
    permissionLevel: perms.level,
    npcName,
    mode,
    result,
  };
}

function getBackgroundRun(id) {
  return activeBackgroundRuns.get(String(id || '')) || null;
}

function listBackgroundRuns() {
  return Array.from(activeBackgroundRuns.values());
}

module.exports = {
  VALID_LEVELS: Array.from(VALID_LEVELS),
  getPermissions,
  setPermissionLevel,
  canRunAgent,
  requestAgentTask,
  createPendingApproval,
  approvePendingApproval,
  rejectPendingApproval,
  getPendingApproval,
  listPendingApprovals,
  getBackgroundRun,
  listBackgroundRuns,
  _isTrustedLocalCaller,
  _PERM_FILE: PERM_FILE,
};
