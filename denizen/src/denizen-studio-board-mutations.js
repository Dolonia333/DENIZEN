'use strict';

/**
 * Studio Board mutations used by MCP tools and (optionally) REST helpers.
 */

const boardStore = require('./denizen-studio-board-store');

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function actorName(actor) {
  return String(actor?.displayName || actor?.user || actor?.npc_key || actor?.npcKey || 'MCP').slice(0, 64);
}

function ensureArrays(task) {
  task.log = Array.isArray(task.log) ? task.log : [];
  task.comments = Array.isArray(task.comments) ? task.comments : [];
  task.subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  if (task.remind === undefined) task.remind = true;
  if (!task.statusSince) task.statusSince = todayISO();
  return task;
}

function logEvt(task, who, text) {
  ensureArrays(task);
  task.log.push({ ts: Date.now(), who, text: String(text || '').slice(0, 240) });
  if (task.log.length > 50) task.log = task.log.slice(-50);
}

function findTask(state, id) {
  const tid = String(id || '').trim();
  if (!tid) return null;
  return (state.tasks || []).find((t) => String(t.id) === tid) || null;
}

function findPerson(state, idOrName) {
  const q = String(idOrName || '').trim().toLowerCase();
  if (!q) return null;
  const people = state.people || [];
  return people.find((p) => String(p.id) === q)
    || people.find((p) => String(p.name || '').toLowerCase() === q)
    || people.find((p) => String(p.name || '').toLowerCase().startsWith(q))
    || null;
}

function isFinalStage(state, statusId) {
  const stages = state.config?.stages || [];
  const s = stages.find((x) => x.id === statusId);
  return !!(s && s.final);
}

function isBlockedStage(state, statusId) {
  const stages = state.config?.stages || [];
  const s = stages.find((x) => x.id === statusId);
  return !!(s && s.blocked);
}

function defaultStatus(state) {
  const stages = state.config?.stages || [];
  return stages[0]?.id || 'backlog';
}

function buildWorkingSet(state) {
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const people = Array.isArray(state?.people) ? state.people : [];
  const events = Array.isArray(state?.events) ? state.events : [];
  const today = todayISO();
  const open = tasks.filter((t) => !isFinalStage(state, t.status));
  const overdue = open.filter((t) => t.due && String(t.due) < today);
  const stuck = open.filter((t) => isBlockedStage(state, t.status));
  const byStatus = {};
  for (const t of open) {
    const k = t.status || 'unknown';
    byStatus[k] = (byStatus[k] || 0) + 1;
  }
  return {
    empty: tasks.length === 0,
    counts: {
      tasks: tasks.length,
      open: open.length,
      overdue: overdue.length,
      stuck: stuck.length,
      people: people.length,
      events: events.length,
      by_status: byStatus,
    },
    overdue: overdue.slice(0, 25).map(summarizeTask),
    stuck: stuck.slice(0, 25).map(summarizeTask),
    open_tasks: open.slice(0, 40).map(summarizeTask),
    people: people.slice(0, 40).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role || null,
      color: p.color || null,
    })),
    stages: (state.config?.stages || []).map((s) => ({
      id: s.id,
      label: s.label || s.id,
      final: !!s.final,
      blocked: !!s.blocked,
    })),
    categories: (state.config?.categories || []).map((c) => ({
      id: c.id,
      label: c.label || c.id,
    })),
  };
}

function summarizeTask(t) {
  return {
    id: t.id,
    title: t.title,
    client: t.client || null,
    type: t.type || null,
    assignee: t.assignee || null,
    status: t.status,
    priority: t.priority || null,
    due: t.due || null,
    block_reason: t.blockReason || null,
    comments: Array.isArray(t.comments) ? t.comments.length : 0,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.length : 0,
  };
}

async function loadState(orgId) {
  const row = await boardStore.getWorkspace(orgId);
  return {
    row,
    state: row?.state ? boardStore.sanitizeState(row.state) : boardStore.emptyState(),
  };
}

async function saveState(orgId, state, identityId, opts = {}) {
  return boardStore.upsertWorkspace(orgId, state, identityId, opts);
}

async function listTasks(orgId, filters = {}) {
  const { state } = await loadState(orgId);
  let tasks = [...(state.tasks || [])];
  const status = filters.status || filters.stage || null;
  const assignee = filters.assignee || null;
  const client = filters.client || null;
  const search = String(filters.search || filters.q || '').trim().toLowerCase();
  const openOnly = filters.open_only === true || filters.openOnly === true
    || String(filters.open || '') === '1';
  if (status) tasks = tasks.filter((t) => String(t.status) === String(status));
  if (assignee) {
    const p = findPerson(state, assignee);
    const aid = p?.id || assignee;
    tasks = tasks.filter((t) => String(t.assignee || '') === String(aid)
      || String(t.assignee || '').toLowerCase() === String(assignee).toLowerCase());
  }
  if (client) {
    tasks = tasks.filter((t) => String(t.client || '').toLowerCase() === String(client).toLowerCase());
  }
  if (openOnly) tasks = tasks.filter((t) => !isFinalStage(state, t.status));
  if (search) {
    tasks = tasks.filter((t) => `${t.title} ${t.client || ''} ${t.notes || ''}`.toLowerCase().includes(search));
  }
  const limit = Math.min(Math.max(Number(filters.limit) || 40, 1), 100);
  return {
    ok: true,
    count: tasks.length,
    tasks: tasks.slice(0, limit).map(summarizeTask),
    stages: (state.config?.stages || []).map((s) => s.id),
  };
}

async function getTask(orgId, taskId) {
  const { state } = await loadState(orgId);
  const task = findTask(state, taskId);
  if (!task) return { ok: false, error: 'task not found' };
  return { ok: true, task: ensureArrays({ ...task }) };
}

async function upsertTask(orgId, input = {}, identityId = null, actor = {}) {
  const { state, row } = await loadState(orgId);
  const who = actorName(actor);
  const id = String(input.id || input.task_id || input.taskId || '').trim();
  let task = id ? findTask(state, id) : null;
  const creating = !task;
  if (creating) {
    task = ensureArrays({
      id: id || uid(),
      title: String(input.title || 'Untitled').slice(0, 200),
      client: String(input.client || '').slice(0, 120),
      type: input.type || (state.config?.categories?.[0]?.id || 'general'),
      assignee: input.assignee || null,
      status: input.status || defaultStatus(state),
      priority: input.priority || 'normal',
      due: input.due || null,
      notes: String(input.notes || '').slice(0, 4000),
      statusSince: todayISO(),
      log: [],
      comments: [],
      subtasks: Array.isArray(input.subtasks) ? input.subtasks : [],
      remind: input.remind !== false,
    });
    if (input.assignee) {
      const p = findPerson(state, input.assignee);
      if (p) task.assignee = p.id;
    }
    logEvt(task, who, 'Created via MCP');
    state.tasks = [...(state.tasks || []), task];
  } else {
    ensureArrays(task);
    if (input.title != null) task.title = String(input.title).slice(0, 200);
    if (input.client != null) task.client = String(input.client).slice(0, 120);
    if (input.type != null) task.type = input.type;
    if (input.priority != null) task.priority = input.priority;
    if (input.due != null) task.due = input.due || null;
    if (input.notes != null) task.notes = String(input.notes).slice(0, 4000);
    if (input.assignee != null) {
      const p = findPerson(state, input.assignee);
      task.assignee = p?.id || input.assignee || null;
      logEvt(task, who, `Assignee → ${task.assignee || 'unassigned'}`);
    }
    if (input.status != null && input.status !== task.status) {
      logEvt(task, who, `Status: ${task.status} → ${input.status}`);
      task.status = input.status;
      task.statusSince = todayISO();
    }
    if (Array.isArray(input.subtasks)) task.subtasks = input.subtasks;
  }
  const saved = await saveState(orgId, state, identityId, {
    ifUpdatedAt: row?.updated_at || null,
  });
  if (saved?.conflict) {
    return { ok: false, error: 'workspace conflict — reload and retry', code: 'CONFLICT' };
  }
  return { ok: true, created: creating, task: summarizeTask(task), updated_at: saved?.updated_at };
}

async function advanceTask(orgId, input = {}, identityId = null, actor = {}) {
  const { state, row } = await loadState(orgId);
  const task = findTask(state, input.id || input.task_id || input.taskId);
  if (!task) return { ok: false, error: 'task not found' };
  const who = actorName(actor);
  ensureArrays(task);
  let next = input.status || input.to || input.next_status || null;
  if (!next) {
    const stages = state.config?.stages || [];
    const idx = stages.findIndex((s) => s.id === task.status);
    next = idx >= 0 && idx < stages.length - 1 ? stages[idx + 1].id : null;
  }
  if (!next) return { ok: false, error: 'no next stage' };
  const reason = input.reason || input.block_reason || input.blockReason || null;
  logEvt(task, who, `Status: ${task.status} → ${next}`);
  if (isBlockedStage(state, next) && !isBlockedStage(state, task.status)) {
    task.preBlockStatus = task.status;
  }
  task.status = next;
  task.statusSince = todayISO();
  if (isBlockedStage(state, next)) task.blockReason = reason || 'No reason given';
  else delete task.blockReason;
  const saved = await saveState(orgId, state, identityId, {
    ifUpdatedAt: row?.updated_at || null,
  });
  if (saved?.conflict) return { ok: false, error: 'workspace conflict', code: 'CONFLICT' };
  return { ok: true, task: summarizeTask(task), updated_at: saved?.updated_at };
}

async function assignTask(orgId, input = {}, identityId = null, actor = {}) {
  return upsertTask(orgId, {
    id: input.id || input.task_id || input.taskId,
    assignee: input.assignee || input.person || input.person_id || null,
  }, identityId, actor);
}

async function addComment(orgId, input = {}, identityId = null, actor = {}) {
  const { state, row } = await loadState(orgId);
  const task = findTask(state, input.id || input.task_id || input.taskId);
  if (!task) return { ok: false, error: 'task not found' };
  const text = String(input.comment || input.text || input.body || '').trim();
  if (!text) return { ok: false, error: 'comment required' };
  const who = actorName(actor);
  ensureArrays(task);
  task.comments.push({ id: uid(), ts: Date.now(), who, text: text.slice(0, 2000) });
  logEvt(task, who, 'Comment added');
  const saved = await saveState(orgId, state, identityId, {
    ifUpdatedAt: row?.updated_at || null,
  });
  if (saved?.conflict) return { ok: false, error: 'workspace conflict', code: 'CONFLICT' };
  return { ok: true, task: summarizeTask(task), comment_count: task.comments.length };
}

async function upsertPerson(orgId, input = {}, identityId = null) {
  const { state, row } = await loadState(orgId);
  const id = String(input.id || input.person_id || '').trim();
  let person = id ? (state.people || []).find((p) => String(p.id) === id) : null;
  const creating = !person;
  if (creating) {
    person = {
      id: id || uid(),
      name: String(input.name || 'Teammate').slice(0, 120),
      role: String(input.role || '').slice(0, 120),
      color: input.color || '#3F6FA8',
    };
    state.people = [...(state.people || []), person];
  } else {
    if (input.name != null) person.name = String(input.name).slice(0, 120);
    if (input.role != null) person.role = String(input.role).slice(0, 120);
    if (input.color != null) person.color = input.color;
  }
  const saved = await saveState(orgId, state, identityId, {
    ifUpdatedAt: row?.updated_at || null,
  });
  if (saved?.conflict) return { ok: false, error: 'workspace conflict', code: 'CONFLICT' };
  return { ok: true, created: creating, person };
}

async function listPeople(orgId) {
  const { state } = await loadState(orgId);
  return {
    ok: true,
    people: (state.people || []).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role || null,
      color: p.color || null,
    })),
  };
}

module.exports = {
  buildWorkingSet,
  summarizeTask,
  listTasks,
  getTask,
  upsertTask,
  advanceTask,
  assignTask,
  addComment,
  upsertPerson,
  listPeople,
  loadState,
};
