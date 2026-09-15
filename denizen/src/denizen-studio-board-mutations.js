'use strict';

/**
 * Studio Board mutations used by MCP tools and (optionally) REST helpers.
 */

const boardStore = require('./denizen-studio-board-store');
const boardActivity = require('./denizen-studio-board-activity');
const boardAcl = require('./denizen-studio-board-acl');
const boardAutomations = require('./denizen-studio-board-automations');

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
  task.fields = task.fields && typeof task.fields === 'object' ? task.fields : {};
  task.blockedBy = Array.isArray(task.blockedBy) ? task.blockedBy : [];
  if (task.remind === undefined) task.remind = true;
  if (!task.statusSince) task.statusSince = todayISO();
  return task;
}

function logEvt(task, who, text) {
  ensureArrays(task);
  task.log.push({ ts: Date.now(), who, text: String(text || '').slice(0, 240) });
  if (task.log.length > 50) task.log = task.log.slice(-50);
}

function act(state, who, text, task) {
  boardActivity.appendActivity(state, {
    who,
    text,
    taskId: task?.id || null,
    title: task?.title || null,
  });
}

function wouldCycle(tasks, taskId, blockedByIds) {
  const byId = new Map((tasks || []).map((t) => [String(t.id), t]));
  const targets = (blockedByIds || []).map(String);
  const stack = [...targets];
  const seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (id === String(taskId)) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = byId.get(id);
    for (const b of t?.blockedBy || []) stack.push(String(b));
  }
  return false;
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
    || people.find((p) => String(p.email || '').toLowerCase() === q)
    || people.find((p) => String(p.identityId || p.identity_id || '').toLowerCase() === q)
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
    upcoming_events: upcomingEvents(events, today).slice(0, 20),
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

function eventOccursOn(ev, date) {
  if (!ev || !ev.date) return false;
  if (String(ev.date) === String(date)) return true;
  if (ev.repeat === 'weekly' && ev.kind === 'meeting') {
    const a = new Date(`${ev.date}T00:00:00`);
    const b = new Date(`${date}T00:00:00`);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return false;
    const days = Math.round((b - a) / 86400000);
    return days % 7 === 0;
  }
  return false;
}

function upcomingEvents(events, fromDate) {
  const start = String(fromDate || todayISO());
  const out = [];
  for (let i = 0; i < 14; i += 1) {
    const d = new Date(`${start}T00:00:00`);
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    for (const ev of events || []) {
      if (eventOccursOn(ev, iso)) {
        out.push(summarizeEvent({ ...ev, date: iso, source_date: ev.date }));
      }
    }
  }
  return out;
}

function summarizeEvent(e) {
  return {
    id: e.id,
    kind: e.kind || 'meeting',
    title: e.title || null,
    date: e.date || null,
    time: e.time || null,
    client: e.client || null,
    note: e.note || null,
    repeat: e.repeat || null,
    done: !!e.done,
  };
}

function summarizeNote(n) {
  return {
    id: n.id,
    from: n.from || null,
    to: n.to || null,
    text: n.text || '',
    ts: n.ts || null,
    read: !!n.read,
  };
}

function findEvent(state, id) {
  const eid = String(id || '').trim();
  if (!eid) return null;
  return (state.events || []).find((e) => String(e.id) === eid) || null;
}

function slugUnique(name, existing) {
  const base = String(name || '').trim() || 'item';
  const used = new Set((existing || []).map((x) => String(x.id)));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

function personHint(state, hint) {
  if (!hint) return null;
  return findPerson(state, hint.assignee || hint.person || hint.person_id || hint.name || hint.displayName || hint.user)
    || null;
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
    start: t.start || null,
    group_id: t.groupId || t.group_id || null,
    blocked_by: Array.isArray(t.blockedBy) ? t.blockedBy : [],
    fields: t.fields && typeof t.fields === 'object' ? t.fields : {},
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

async function commit(orgId, state, identityId, row, extra = {}) {
  const saved = await saveState(orgId, state, identityId, {
    ifUpdatedAt: row?.updated_at || null,
  });
  if (saved?.conflict) {
    return { ok: false, error: 'workspace conflict — reload and retry', code: 'CONFLICT' };
  }
  return { ok: true, updated_at: saved?.updated_at, ...extra };
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
  let statusFrom = null;
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
      start: input.start || null,
      groupId: input.group_id || input.groupId || 'active',
      notes: String(input.notes || '').slice(0, 4000),
      statusSince: todayISO(),
      fields: input.fields && typeof input.fields === 'object' ? input.fields : {},
      blockedBy: Array.isArray(input.blocked_by || input.blockedBy) ? (input.blocked_by || input.blockedBy) : [],
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
    act(state, who, `Created “${task.title}”`, task);
    state.tasks = [...(state.tasks || []), task];
  } else {
    ensureArrays(task);
    if (input.title != null) task.title = String(input.title).slice(0, 200);
    if (input.client != null) task.client = String(input.client).slice(0, 120);
    if (input.type != null) task.type = input.type;
    if (input.priority != null) task.priority = input.priority;
    if (input.due != null) task.due = input.due || null;
    if (input.start != null) task.start = input.start || null;
    if (input.group_id != null || input.groupId != null) {
      task.groupId = input.group_id || input.groupId || null;
    }
    if (input.notes != null) task.notes = String(input.notes).slice(0, 4000);
    if (input.assignee != null) {
      const p = findPerson(state, input.assignee);
      task.assignee = p?.id || input.assignee || null;
      logEvt(task, who, `Assignee → ${task.assignee || 'unassigned'}`);
      act(state, who, `Assignee → ${task.assignee || 'unassigned'}`, task);
    }
    if (input.status != null && input.status !== task.status) {
      statusFrom = task.status;
      logEvt(task, who, `Status: ${task.status} → ${input.status}`);
      act(state, who, `Status: ${task.status} → ${input.status}`, task);
      task.status = input.status;
      task.statusSince = todayISO();
    }
    if (Array.isArray(input.subtasks)) task.subtasks = input.subtasks;
    if (input.fields && typeof input.fields === 'object') {
      task.fields = { ...task.fields, ...input.fields };
    }
    if (input.blocked_by != null || input.blockedBy != null) {
      const next = Array.isArray(input.blocked_by || input.blockedBy)
        ? (input.blocked_by || input.blockedBy).map(String)
        : [];
      if (wouldCycle(state.tasks, task.id, next)) {
        return { ok: false, error: 'blockedBy would create a cycle' };
      }
      task.blockedBy = next;
    }
  }
  if (statusFrom != null) {
    boardAutomations.runRules(state, {
      kind: 'status_changed',
      task,
      from: statusFrom,
      to: task.status,
      who,
    });
  }
  const saved = await commit(orgId, state, identityId, row, {
    created: creating,
    task: summarizeTask(task),
  });
  return saved;
}

async function advanceTask(orgId, input = {}, identityId = null, actor = {}) {
  const { state, row } = await loadState(orgId);
  const task = findTask(state, input.id || input.task_id || input.taskId);
  if (!task) return { ok: false, error: 'task not found' };
  const who = actorName(actor);
  ensureArrays(task);
  // Block advance when open blockers remain
  const openBlockers = (task.blockedBy || []).filter((bid) => {
    const bt = findTask(state, bid);
    return bt && !isFinalStage(state, bt.status);
  });
  if (openBlockers.length && !input.force) {
    return {
      ok: false,
      error: `waiting on ${openBlockers.length} blocker(s)`,
      blocked_by: openBlockers,
    };
  }
  let next = input.status || input.to || input.next_status || null;
  if (!next) {
    const stages = state.config?.stages || [];
    const idx = stages.findIndex((s) => s.id === task.status);
    next = idx >= 0 && idx < stages.length - 1 ? stages[idx + 1].id : null;
  }
  if (!next) return { ok: false, error: 'no next stage' };
  const reason = input.reason || input.block_reason || input.blockReason || null;
  const from = task.status;
  logEvt(task, who, `Status: ${task.status} → ${next}`);
  act(state, who, `Status: ${from} → ${next}`, task);
  if (isBlockedStage(state, next) && !isBlockedStage(state, task.status)) {
    task.preBlockStatus = task.status;
  }
  task.status = next;
  task.statusSince = todayISO();
  if (isBlockedStage(state, next)) task.blockReason = reason || 'No reason given';
  else delete task.blockReason;
  boardAutomations.runRules(state, {
    kind: 'status_changed',
    task,
    from,
    to: next,
    who,
  });
  return commit(orgId, state, identityId, row, { task: summarizeTask(task) });
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
  act(state, who, 'commented', task);
  return commit(orgId, state, identityId, row, {
    task: summarizeTask(task),
    comment_count: task.comments.length,
  });
}

async function upsertPerson(orgId, input = {}, identityId = null) {
  const { state, row } = await loadState(orgId);
  const id = String(input.id || input.person_id || '').trim();
  const email = input.email ? String(input.email).trim().toLowerCase() : null;
  const identity = input.identity_id || input.identityId || null;
  let person = id ? (state.people || []).find((p) => String(p.id) === id) : null;
  if (!person && email) {
    person = (state.people || []).find((p) => String(p.email || '').toLowerCase() === email) || null;
  }
  if (!person && identity) {
    person = (state.people || []).find((p) => String(p.identityId || p.identity_id || '') === String(identity)) || null;
  }
  if (!person && input.name) {
    person = findPerson(state, input.name);
  }
  const creating = !person;
  if (creating) {
    person = {
      id: id || uid(),
      name: String(input.name || 'Teammate').slice(0, 120),
      role: String(input.role || '').slice(0, 120),
      color: input.color || '#3F6FA8',
    };
    if (email) person.email = email;
    if (identity) person.identityId = identity;
    state.people = [...(state.people || []), person];
  } else {
    if (input.name != null) person.name = String(input.name).slice(0, 120);
    if (input.role != null) person.role = String(input.role).slice(0, 120);
    if (input.color != null) person.color = input.color;
    if (email) person.email = email;
    if (identity) person.identityId = identity;
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
      email: p.email || null,
      identity_id: p.identityId || p.identity_id || null,
    })),
  };
}

async function deleteTask(orgId, input = {}, identityId = null, actor = {}) {
  const { state, row } = await loadState(orgId);
  const id = String(input.id || input.task_id || input.taskId || '').trim();
  const task = findTask(state, id);
  if (!task) return { ok: false, error: 'task not found' };
  state.tasks = (state.tasks || []).filter((t) => String(t.id) !== id);
  act(state, actorName(actor), `Deleted “${task.title || id}”`, task);
  return commit(orgId, state, identityId, row, {
    deleted: id,
    title: task.title || null,
  });
}

async function deletePerson(orgId, input = {}, identityId = null) {
  const { state, row } = await loadState(orgId);
  const person = findPerson(state, input.id || input.person_id || input.name);
  if (!person) return { ok: false, error: 'person not found' };
  const assigned = (state.tasks || []).filter((t) => String(t.assignee) === String(person.id)).length;
  if (assigned && !input.force && input.reassign == null) {
    return {
      ok: false,
      error: `${assigned} task(s) still assigned — pass reassign or force=true`,
      assigned,
    };
  }
  if (input.reassign) {
    const dest = findPerson(state, input.reassign);
    const destId = dest?.id || null;
    for (const t of state.tasks || []) {
      if (String(t.assignee) === String(person.id)) t.assignee = destId;
    }
  } else if (input.force) {
    for (const t of state.tasks || []) {
      if (String(t.assignee) === String(person.id)) t.assignee = null;
    }
  }
  state.people = (state.people || []).filter((p) => String(p.id) !== String(person.id));
  const saved = await saveState(orgId, state, identityId, {
    ifUpdatedAt: row?.updated_at || null,
  });
  if (saved?.conflict) return { ok: false, error: 'workspace conflict', code: 'CONFLICT' };
  return { ok: true, deleted: person.id, name: person.name, updated_at: saved?.updated_at };
}

async function listEvents(orgId, filters = {}) {
  const { state } = await loadState(orgId);
  const kind = String(filters.kind || '').trim().toLowerCase();
  const date = String(filters.date || '').trim();
  const search = String(filters.search || filters.q || '').trim().toLowerCase();
  let events = [...(state.events || [])];
  if (kind) events = events.filter((e) => String(e.kind || '').toLowerCase() === kind);
  if (date) events = events.filter((e) => eventOccursOn(e, date));
  if (search) {
    events = events.filter((e) => `${e.title || ''} ${e.client || ''} ${e.note || ''}`.toLowerCase().includes(search));
  }
  events.sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))
    || String(a.time || '').localeCompare(String(b.time || '')));
  const limit = Math.min(Math.max(Number(filters.limit) || 40, 1), 100);
  return { ok: true, count: events.length, events: events.slice(0, limit).map(summarizeEvent) };
}

async function upsertEvent(orgId, input = {}, identityId = null) {
  const { state, row } = await loadState(orgId);
  const id = String(input.id || input.event_id || '').trim();
  let ev = id ? findEvent(state, id) : null;
  const creating = !ev;
  const kind = String(input.kind || ev?.kind || 'meeting').toLowerCase() === 'followup' ? 'followup' : 'meeting';
  if (creating) {
    const title = String(input.title || '').trim();
    if (!title) return { ok: false, error: 'title required' };
    ev = {
      id: id || uid(),
      kind,
      title: title.slice(0, 200),
      date: input.date || todayISO(),
      time: input.time || null,
      client: input.client || null,
      note: input.note || null,
      repeat: input.repeat === 'weekly' ? 'weekly' : null,
      done: !!input.done,
    };
    state.events = [...(state.events || []), ev];
  } else {
    if (input.title != null) ev.title = String(input.title).slice(0, 200);
    if (input.kind != null) ev.kind = kind;
    if (input.date != null) ev.date = input.date || ev.date;
    if (input.time != null) ev.time = input.time || null;
    if (input.client != null) ev.client = input.client || null;
    if (input.note != null) ev.note = input.note || null;
    if (input.repeat != null) ev.repeat = input.repeat === 'weekly' ? 'weekly' : null;
    if (input.done != null) ev.done = !!input.done;
  }
  const saved = await saveState(orgId, state, identityId, {
    ifUpdatedAt: row?.updated_at || null,
  });
  if (saved?.conflict) return { ok: false, error: 'workspace conflict', code: 'CONFLICT' };
  return { ok: true, created: creating, event: summarizeEvent(ev), updated_at: saved?.updated_at };
}

async function deleteEvent(orgId, input = {}, identityId = null) {
  const { state, row } = await loadState(orgId);
  const ev = findEvent(state, input.id || input.event_id);
  if (!ev) return { ok: false, error: 'event not found' };
  state.events = (state.events || []).filter((e) => String(e.id) !== String(ev.id));
  const saved = await saveState(orgId, state, identityId, {
    ifUpdatedAt: row?.updated_at || null,
  });
  if (saved?.conflict) return { ok: false, error: 'workspace conflict', code: 'CONFLICT' };
  return { ok: true, deleted: ev.id, title: ev.title || null, updated_at: saved?.updated_at };
}

async function addSubtask(orgId, input = {}, identityId = null, actor = {}) {
  const { state, row } = await loadState(orgId);
  const task = findTask(state, input.id || input.task_id || input.taskId);
  if (!task) return { ok: false, error: 'task not found' };
  const text = String(input.text || input.title || input.subtask || '').trim();
  if (!text) return { ok: false, error: 'subtask text required' };
  ensureArrays(task);
  const sub = { id: uid(), text: text.slice(0, 240), done: false };
  task.subtasks.push(sub);
  logEvt(task, actorName(actor), `Subtask added: ${sub.text}`);
  const saved = await saveState(orgId, state, identityId, {
    ifUpdatedAt: row?.updated_at || null,
  });
  if (saved?.conflict) return { ok: false, error: 'workspace conflict', code: 'CONFLICT' };
  return { ok: true, subtask: sub, task: summarizeTask(task), updated_at: saved?.updated_at };
}

async function toggleSubtask(orgId, input = {}, identityId = null, actor = {}) {
  const { state, row } = await loadState(orgId);
  const task = findTask(state, input.id || input.task_id || input.taskId);
  if (!task) return { ok: false, error: 'task not found' };
  ensureArrays(task);
  const sid = String(input.subtask_id || input.sub_id || '').trim();
  const text = String(input.text || '').trim().toLowerCase();
  const sub = task.subtasks.find((s) => String(s.id) === sid)
    || (text ? task.subtasks.find((s) => String(s.text || '').toLowerCase() === text) : null);
  if (!sub) return { ok: false, error: 'subtask not found' };
  sub.done = input.done == null ? !sub.done : !!input.done;
  logEvt(task, actorName(actor), `Subtask ${sub.done ? 'done' : 'reopened'}: ${sub.text}`);
  const saved = await saveState(orgId, state, identityId, {
    ifUpdatedAt: row?.updated_at || null,
  });
  if (saved?.conflict) return { ok: false, error: 'workspace conflict', code: 'CONFLICT' };
  return { ok: true, subtask: sub, task: summarizeTask(task), updated_at: saved?.updated_at };
}

async function deleteSubtask(orgId, input = {}, identityId = null, actor = {}) {
  const { state, row } = await loadState(orgId);
  const task = findTask(state, input.id || input.task_id || input.taskId);
  if (!task) return { ok: false, error: 'task not found' };
  ensureArrays(task);
  const sid = String(input.subtask_id || input.sub_id || '').trim();
  const before = task.subtasks.length;
  task.subtasks = task.subtasks.filter((s) => String(s.id) !== sid);
  if (task.subtasks.length === before) return { ok: false, error: 'subtask not found' };
  logEvt(task, actorName(actor), 'Subtask removed');
  const saved = await saveState(orgId, state, identityId, {
    ifUpdatedAt: row?.updated_at || null,
  });
  if (saved?.conflict) return { ok: false, error: 'workspace conflict', code: 'CONFLICT' };
  return { ok: true, task: summarizeTask(task), updated_at: saved?.updated_at };
}

async function listNotes(orgId, filters = {}) {
  const { state } = await loadState(orgId);
  let notes = [...(state.notes || [])];
  const to = filters.to || filters.person || null;
  const from = filters.from || null;
  if (to) {
    const p = findPerson(state, to);
    const pid = p?.id || to;
    notes = notes.filter((n) => String(n.to) === String(pid));
  }
  if (from) {
    const p = findPerson(state, from);
    const pid = p?.id || from;
    notes = notes.filter((n) => String(n.from) === String(pid));
  }
  notes.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
  const limit = Math.min(Math.max(Number(filters.limit) || 40, 1), 100);
  return { ok: true, count: notes.length, notes: notes.slice(0, limit).map(summarizeNote) };
}

async function sendNote(orgId, input = {}, identityId = null, actor = {}) {
  const { state, row } = await loadState(orgId);
  const toP = findPerson(state, input.to || input.person);
  if (!toP) return { ok: false, error: 'recipient not found' };
  const text = String(input.text || input.note || input.body || '').trim();
  if (!text) return { ok: false, error: 'note text required' };
  const fromP = findPerson(state, input.from || actor.displayName || actor.user || actor.npc_key);
  const note = {
    id: uid(),
    from: fromP?.id || actor.npc_key || 'mcp',
    to: toP.id,
    text: text.slice(0, 2000),
    ts: Date.now(),
    read: false,
  };
  state.notes = [...(state.notes || []), note];
  const saved = await saveState(orgId, state, identityId, {
    ifUpdatedAt: row?.updated_at || null,
  });
  if (saved?.conflict) return { ok: false, error: 'workspace conflict', code: 'CONFLICT' };
  return { ok: true, note: summarizeNote(note), updated_at: saved?.updated_at };
}

function getConfigFromState(state) {
  const cfg = boardStore.migrateConfig(state.config || {}) || {};
  return {
    team_name: cfg.teamName || null,
    team_sub: cfg.teamSub || null,
    client_label: cfg.clientLabel || 'Client',
    template_id: cfg.templateId || null,
    categories: Array.isArray(cfg.categories) ? cfg.categories : [],
    stages: Array.isArray(cfg.stages) ? cfg.stages : [],
    columns: Array.isArray(cfg.columns) ? cfg.columns : [],
    groups: Array.isArray(cfg.groups) ? cfg.groups : [],
    automations: Array.isArray(cfg.automations) ? cfg.automations : [],
    acl: cfg.acl || { owners: [], admins: [] },
  };
}

async function getConfig(orgId) {
  const { state } = await loadState(orgId);
  return { ok: true, ...getConfigFromState(state) };
}

async function updateConfig(orgId, input = {}, identityId = null, actor = {}) {
  const { state, row } = await loadState(orgId);
  if (!state.config || typeof state.config !== 'object') {
    state.config = {
      teamName: 'Team Board',
      teamSub: '',
      clientLabel: 'Client',
      categories: [{ id: 'General', hex: '#3F6FA8' }],
      stages: [
        { id: 'To do', hex: '#7E938A' },
        { id: 'Doing', hex: '#3F6FA8' },
        { id: 'Done', hex: '#2A6A55', final: true },
      ],
    };
  }
  boardAcl.seedOwnerIfEmpty(state.config, {
    identityId,
    identity_id: identityId,
    ...actor,
  });
  const adminErr = boardAcl.requireAdmin(state.config, {
    identityId,
    identity_id: identityId,
    ...actor,
  });
  // MCP actors with crm_write bypass UI ACL; only enforce when actor.enforceAcl
  if (actor.enforceAcl && adminErr) {
    return { ok: false, error: adminErr.message, code: 'FORBIDDEN' };
  }
  boardStore.migrateConfig(state.config);
  if (input.team_name != null || input.teamName != null) {
    state.config.teamName = String(input.team_name || input.teamName || 'Team Board').slice(0, 80);
  }
  if (input.team_sub != null || input.teamSub != null) {
    state.config.teamSub = String(input.team_sub || input.teamSub || '').slice(0, 120);
  }
  if (input.client_label != null || input.clientLabel != null) {
    state.config.clientLabel = String(input.client_label || input.clientLabel || 'Client').slice(0, 40);
  }
  if (input.add_category || input.category) {
    const name = String(input.add_category || input.category).trim();
    const cats = state.config.categories || [];
    const id = slugUnique(name, cats);
    cats.push({ id, hex: input.color || '#3F6FA8' });
    state.config.categories = cats;
  }
  if (input.add_stage || input.stage) {
    const name = String(input.add_stage || input.stage).trim();
    const stages = state.config.stages || [];
    const id = slugUnique(name, stages);
    const rowStage = { id, hex: input.color || '#3F6FA8', staleEligible: false };
    if (input.final) {
      stages.forEach((s) => { s.final = false; });
      rowStage.final = true;
    }
    if (input.blocked) {
      stages.forEach((s) => { s.blocked = false; });
      rowStage.blocked = true;
    }
    const finalIdx = stages.findIndex((s) => s.final);
    const insertAt = finalIdx >= 0 && !rowStage.final ? finalIdx : stages.length;
    stages.splice(insertAt, 0, rowStage);
    state.config.stages = stages;
  }
  if (input.acl && typeof input.acl === 'object') {
    state.config.acl = {
      owners: Array.isArray(input.acl.owners) ? input.acl.owners.map(String) : state.config.acl.owners,
      admins: Array.isArray(input.acl.admins) ? input.acl.admins.map(String) : state.config.acl.admins,
    };
  }
  act(state, actorName(actor), 'Updated board config');
  return commit(orgId, state, identityId, row, getConfigFromState(state));
}

function dayDiff(iso) {
  if (!iso) return 0;
  const a = new Date(`${todayISO()}T00:00:00`);
  const b = new Date(`${iso}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

function isStale(state, task) {
  const stages = state.config?.stages || [];
  const s = stages.find((x) => x.id === task.status);
  if (!s?.staleEligible || isFinalStage(state, task.status)) return false;
  const since = task.statusSince || todayISO();
  return dayDiff(since) <= -4;
}

function standupText(state) {
  const open = (state.tasks || []).filter((t) => !isFinalStage(state, t.status));
  const od = open.filter((t) => t.due && dayDiff(t.due) < 0);
  const dt = open.filter((t) => t.due && dayDiff(t.due) === 0);
  const bl = open.filter((t) => isBlockedStage(state, t.status));
  const st = open.filter((t) => isStale(state, t));
  const today = todayISO();
  const meetings = (state.events || []).filter((e) => e.kind === 'meeting' && eventOccursOn(e, today));
  const who = (t) => findPerson(state, t.assignee)?.name || 'Unassigned';
  const line = (t) => `• ${t.title} — ${who(t)}${t.client ? ` (${t.client})` : ''}`;
  const sec = (name, list, extra) => `\n${name} (${list.length})\n${list.length ? list.map((t) => line(t) + (extra ? extra(t) : '')).join('\n') : '• none'}`;
  let s = `STANDUP — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}\n`;
  s += sec('OVERDUE', od);
  s += `\n${sec('DUE TODAY', dt)}`;
  s += `\n\nMEETINGS TODAY (${meetings.length})\n`;
  s += meetings.length
    ? meetings.map((e) => `• ${e.time ? `${e.time} ` : ''}${e.title}${e.client ? ` (${e.client})` : ''}`).join('\n')
    : '• none';
  s += sec('BLOCKED', bl, (t) => (t.blockReason ? ` — ${t.blockReason}` : ''));
  s += sec('STUCK', st, (t) => ` — ${Math.abs(dayDiff(t.statusSince || todayISO()))}d`);
  return s;
}

function recapText(state) {
  const inWin = (t, lo, hi) => {
    if (!isFinalStage(state, t.status) || !t.statusSince) return false;
    const d = dayDiff(t.statusSince);
    return d <= hi && d >= lo;
  };
  const thisW = (state.tasks || []).filter((t) => inWin(t, -6, 0));
  const lastW = (state.tasks || []).filter((t) => inWin(t, -13, -7));
  const who = (t) => findPerson(state, t.assignee)?.name || 'Unassigned';
  let s = `SHIPPED THIS WEEK — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}\n`;
  s += `${thisW.length} published${lastW.length ? ` (last week: ${lastW.length})` : ''}\n\n`;
  s += thisW.length
    ? thisW.map((t) => `• ${t.title} — ${who(t)}${t.client ? ` (${t.client})` : ''}`).join('\n')
    : '• nothing yet';
  return s;
}

async function standup(orgId, input = {}) {
  const { state } = await loadState(orgId);
  const kind = String(input.kind || input.type || 'standup').toLowerCase();
  const text = kind === 'recap' ? recapText(state) : standupText(state);
  return { ok: true, kind: kind === 'recap' ? 'recap' : 'standup', text };
}

async function myDay(orgId, input = {}, actor = {}) {
  const { state } = await loadState(orgId);
  const person = personHint(state, input) || personHint(state, actor);
  const today = todayISO();
  if (!person) {
    return {
      ok: true,
      identified: false,
      summary: 'No matching Studio Board person — pick or create a teammate first.',
      people: (state.people || []).map((p) => ({ id: p.id, name: p.name })),
    };
  }
  const mine = (state.tasks || []).filter((t) => String(t.assignee) === String(person.id) && !isFinalStage(state, t.status));
  const overdue = mine.filter((t) => t.due && dayDiff(t.due) < 0);
  const dueToday = mine.filter((t) => t.due && dayDiff(t.due) === 0);
  const later = mine.filter((t) => !t.due || dayDiff(t.due) > 0);
  const meetings = (state.events || []).filter((e) => e.kind === 'meeting' && eventOccursOn(e, today));
  const inbox = (state.notes || []).filter((n) => String(n.to) === String(person.id));
  return {
    ok: true,
    identified: true,
    person: { id: person.id, name: person.name, role: person.role || null },
    summary: `${person.name}: ${mine.length} open, ${overdue.length} overdue, ${dueToday.length} due today, ${meetings.length} meetings, ${inbox.filter((n) => !n.read).length} unread notes.`,
    overdue: overdue.map(summarizeTask),
    due_today: dueToday.map(summarizeTask),
    upcoming: later.slice(0, 15).map(summarizeTask),
    meetings: meetings.map(summarizeEvent),
    notes: inbox.slice(0, 20).map(summarizeNote),
  };
}

/* ---- Columns / fields (PR2) ---- */

async function listColumns(orgId) {
  const { state } = await loadState(orgId);
  const cfg = getConfigFromState(state);
  return { ok: true, columns: cfg.columns, groups: cfg.groups };
}

async function upsertColumn(orgId, input = {}, identityId = null, actor = {}) {
  const { state, row } = await loadState(orgId);
  if (!state.config) state.config = {};
  boardStore.migrateConfig(state.config);
  const cols = state.config.columns || [];
  const id = String(input.id || input.column_id || '').trim() || uid();
  let col = cols.find((c) => String(c.id) === id);
  const creating = !col;
  const type = String(input.type || col?.type || 'text').toLowerCase();
  const allowed = new Set(['status', 'person', 'date', 'number', 'dropdown', 'checkbox', 'link', 'file', 'formula', 'text']);
  if (!allowed.has(type)) return { ok: false, error: `unsupported column type: ${type}` };
  if (creating) {
    col = {
      id,
      name: String(input.name || 'Column').slice(0, 80),
      type,
      options: Array.isArray(input.options) ? input.options : [],
      formula: input.formula || null,
      width: input.width || null,
      system: false,
    };
    cols.push(col);
  } else {
    if (input.name != null) col.name = String(input.name).slice(0, 80);
    if (input.type != null) col.type = type;
    if (input.options != null) col.options = Array.isArray(input.options) ? input.options : col.options;
    if (input.formula != null) col.formula = input.formula;
    if (input.width != null) col.width = input.width;
  }
  state.config.columns = cols;
  act(state, actorName(actor), `${creating ? 'Added' : 'Updated'} column “${col.name}”`);
  return commit(orgId, state, identityId, row, { column: col, created: creating });
}

async function setField(orgId, input = {}, identityId = null, actor = {}) {
  const { state, row } = await loadState(orgId);
  const task = findTask(state, input.id || input.task_id || input.taskId);
  if (!task) return { ok: false, error: 'task not found' };
  const columnId = String(input.column_id || input.columnId || input.field || '').trim();
  if (!columnId) return { ok: false, error: 'column_id required' };
  ensureArrays(task);
  const prev = task.fields[columnId];
  task.fields[columnId] = input.value;
  const who = actorName(actor);
  logEvt(task, who, `Field ${columnId} updated`);
  act(state, who, `Field ${columnId} updated`, task);
  boardAutomations.runRules(state, {
    kind: 'field_changed',
    task,
    columnId,
    from: prev,
    to: input.value,
    who,
  });
  return commit(orgId, state, identityId, row, { task: summarizeTask(task) });
}

/* ---- Timeline / blockers (PR3) ---- */

async function setDates(orgId, input = {}, identityId = null, actor = {}) {
  const { state, row } = await loadState(orgId);
  const task = findTask(state, input.id || input.task_id || input.taskId);
  if (!task) return { ok: false, error: 'task not found' };
  const who = actorName(actor);
  ensureArrays(task);
  if (input.start != null) task.start = input.start || null;
  if (input.due != null) {
    task.due = input.due || null;
    logEvt(task, who, `Due → ${task.due || 'none'}`);
    act(state, who, `Due → ${task.due || 'none'}`, task);
  }
  return commit(orgId, state, identityId, row, { task: summarizeTask(task) });
}

async function setBlockers(orgId, input = {}, identityId = null, actor = {}) {
  const { state, row } = await loadState(orgId);
  const task = findTask(state, input.id || input.task_id || input.taskId);
  if (!task) return { ok: false, error: 'task not found' };
  const next = Array.isArray(input.blocked_by || input.blockedBy)
    ? (input.blocked_by || input.blockedBy).map(String)
    : [];
  if (wouldCycle(state.tasks, task.id, next)) {
    return { ok: false, error: 'blockedBy would create a cycle' };
  }
  ensureArrays(task);
  task.blockedBy = next;
  const who = actorName(actor);
  logEvt(task, who, `Blockers → ${next.length ? next.join(',') : 'none'}`);
  act(state, who, `Blockers updated (${next.length})`, task);
  return commit(orgId, state, identityId, row, { task: summarizeTask(task) });
}

async function timeline(orgId, input = {}) {
  const { state } = await loadState(orgId);
  boardAutomations.sweepDuePassed(state, 'Automation');
  const from = String(input.from || todayISO());
  const days = Math.min(Math.max(Number(input.days) || 28, 7), 90);
  const end = new Date(`${from}T00:00:00`);
  end.setDate(end.getDate() + days);
  const to = end.toISOString().slice(0, 10);
  const bars = (state.tasks || [])
    .filter((t) => t.due || t.start)
    .filter((t) => !isFinalStage(state, t.status) || input.include_done)
    .map((t) => {
      const due = t.due || t.start;
      let start = t.start;
      if (!start && t.due) {
        const d = new Date(`${t.due}T00:00:00`);
        d.setDate(d.getDate() - 2);
        start = d.toISOString().slice(0, 10);
      }
      return {
        ...summarizeTask(t),
        start,
        due,
        in_window: String(due) >= from && String(start || due) <= to,
      };
    })
    .filter((t) => t.in_window)
    .sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
  return { ok: true, from, to, days, tasks: bars };
}

/* ---- Automations (PR4) ---- */

async function listAutomations(orgId) {
  const { state } = await loadState(orgId);
  return { ok: true, automations: boardAutomations.listAutomations(state) };
}

async function upsertAutomation(orgId, input = {}, identityId = null, actor = {}) {
  const { state, row } = await loadState(orgId);
  if (!state.config) state.config = {};
  boardStore.migrateConfig(state.config);
  const list = state.config.automations || [];
  const id = String(input.id || input.automation_id || '').trim() || uid();
  let rule = list.find((r) => String(r.id) === id);
  const creating = !rule;
  if (creating) {
    rule = {
      id,
      name: String(input.name || 'Automation').slice(0, 80),
      enabled: input.enabled !== false,
      when: input.when || { type: 'status_changed' },
      then: Array.isArray(input.then) ? input.then : [],
    };
    list.push(rule);
  } else {
    if (input.name != null) rule.name = String(input.name).slice(0, 80);
    if (input.enabled != null) rule.enabled = !!input.enabled;
    if (input.when != null) rule.when = input.when;
    if (input.then != null) rule.then = Array.isArray(input.then) ? input.then : rule.then;
  }
  state.config.automations = list;
  act(state, actorName(actor), `${creating ? 'Added' : 'Updated'} automation “${rule.name}”`);
  return commit(orgId, state, identityId, row, { automation: rule, created: creating });
}

async function listOrgActivity(orgId, filters = {}) {
  const { state } = await loadState(orgId);
  const items = boardActivity.listActivity(state);
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  return { ok: true, count: items.length, activity: items.slice(0, limit) };
}

async function patchTaskEntity(orgId, taskId, patch = {}, identityId = null, actor = {}) {
  return upsertTask(orgId, { id: taskId, ...patch }, identityId, actor);
}

module.exports = {
  buildWorkingSet,
  summarizeTask,
  summarizeEvent,
  listTasks,
  getTask,
  upsertTask,
  advanceTask,
  assignTask,
  addComment,
  upsertPerson,
  listPeople,
  deleteTask,
  deletePerson,
  listEvents,
  upsertEvent,
  deleteEvent,
  addSubtask,
  toggleSubtask,
  deleteSubtask,
  listNotes,
  sendNote,
  getConfig,
  updateConfig,
  standup,
  myDay,
  loadState,
  standupText,
  recapText,
  listColumns,
  upsertColumn,
  setField,
  setDates,
  setBlockers,
  timeline,
  listAutomations,
  upsertAutomation,
  listOrgActivity,
  patchTaskEntity,
  wouldCycle,
  boardAcl,
  boardActivity,
  boardAutomations,
};
