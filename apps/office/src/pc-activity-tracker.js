'use strict';
/**
 * PC Activity Tracker — records every "real PC task" an NPC runs.
 *
 * What counts as a PC task: anything that hits the OS or a real
 * service on Zion's machine. The categories today:
 *   - skill         → runNpcSkill() in server.js (any OpenClaw skill exec)
 *   - desktop-agent → src/desktop-agent.js (whole-PC control)
 *   - computer-use  → src/computer-use-agent.js (visible browser)
 *   - coding-agent  → src/coding-task-runner.js (Claude Code in a worktree)
 *   - linux-agent   → src/linux-agent.js investigate + perimeterPatrol
 *   - job-pipeline  → src/job-application.js runJobPipeline
 *
 * Each event carries: who (npc), what (kind/skill/task), how it's running
 * (mode: background | visible), where it is (status: started | progress |
 * done | failed), and how long it took.
 *
 * Storage: in-memory ring buffer of the last 200 events. No JSONL
 * persistence — this is short-lived, live UI signal, not a forensic log.
 * The LLM telemetry ring already covers the persisted side.
 *
 * Wire-up: server.js requires the singleton, calls setBroadcast() with
 * the agent-WS broadcaster, and uses wrapWithPcActivity() (or the raw
 * record() function) around each PC-task call site to bracket it with
 * a 'started' event and a matching 'done'/'failed' event.
 */

const _events = [];
const MAX = 200;
let _broadcast = null;

function setBroadcast(fn) { _broadcast = fn; }

/**
 * Record a PC activity event.
 *
 * @param {Object} entry
 *   @prop {string} [npc='system']  NPC name, e.g. 'Lucy' / 'Bouncer' / 'system'.
 *   @prop {string}  kind            'skill' | 'desktop-agent' | 'computer-use'
 *                                     | 'coding-agent' | 'linux-agent' | 'job-pipeline'
 *   @prop {string} [skill]          Skill name when kind='skill'.
 *   @prop {string} [task]           Human-readable task description.
 *   @prop {string} [mode='background']  'background' | 'visible'.
 *   @prop {string} [status='started']   'started' | 'progress' | 'done' | 'failed'.
 *   @prop {number} [durationMs]     Only set on terminal events.
 *   @prop {string} [detail]         Extra context (truncation, file count, etc).
 *   @prop {string} [id]             Pass an existing id to "update" a tracked
 *                                     activity (e.g. transition started→done).
 * @returns {Object} the normalized event (includes id + at)
 */
function record(entry) {
  const event = {
    id: entry.id || `pc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    npc: entry.npc || 'system',
    kind: entry.kind,
    skill: entry.skill || null,
    task: entry.task || '',
    mode: entry.mode || 'background',
    status: entry.status || 'started',
    durationMs: Number.isFinite(entry.durationMs) ? entry.durationMs : null,
    detail: entry.detail || null,
  };
  _events.unshift(event);
  if (_events.length > MAX) _events.length = MAX;
  if (_broadcast) {
    try { _broadcast({ type: 'pc_activity', event }); } catch (_) {}
  }
  return event;
}

/**
 * Recent activities, optionally filtered.
 * @param {Object} [opts]
 *   { limit=50, npc, kind, status }
 */
function getRecent({ limit = 50, npc, kind, status } = {}) {
  let list = _events;
  if (npc)    list = list.filter(e => e.npc === npc);
  if (kind)   list = list.filter(e => e.kind === kind);
  if (status) list = list.filter(e => e.status === status);
  return list.slice(0, limit);
}

/**
 * Rolling-window aggregate. Default window: 5 minutes.
 */
function getStats({ windowMs = 5 * 60 * 1000 } = {}) {
  const cutoff = Date.now() - windowMs;
  const recent = _events.filter(e => new Date(e.at).getTime() >= cutoff);
  const byKind = {}, byNpc = {}, byStatus = {};
  for (const e of recent) {
    byKind[e.kind]     = (byKind[e.kind]     || 0) + 1;
    byNpc[e.npc]       = (byNpc[e.npc]       || 0) + 1;
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
  }
  return { total: recent.length, byKind, byNpc, byStatus, windowMs };
}

/**
 * Currently-running activities: those whose latest event is 'started'
 * or 'progress' with no later 'done'/'failed' for the same id.
 *
 * The ring stores events in newest-first order via unshift, so we walk
 * once and keep the first event per id — that's the freshest status.
 */
function getActive() {
  const latestById = new Map();
  for (const e of _events) {
    if (!latestById.has(e.id)) latestById.set(e.id, e);
  }
  return [..._events].filter(e => {
    const latest = latestById.get(e.id);
    if (latest !== e) return false; // only count each id once, by its latest event
    return latest.status === 'started' || latest.status === 'progress';
  });
}

/**
 * Helper: bracket an async fn with 'started' / 'done'|'failed' events.
 * Lets call sites in server.js stay one-line:
 *
 *   wrapWithPcActivity({ npc, kind, task, mode }, () => linuxAgent.investigate(...))
 *
 * @returns Promise resolving to the wrapped fn's resolved value (or
 *          rejecting with its error after recording 'failed').
 */
async function wrapWithPcActivity(meta, fn) {
  const startedAt = Date.now();
  const start = record({
    npc:    meta.npc    || 'system',
    kind:   meta.kind,
    skill:  meta.skill  || null,
    task:   meta.task   || '',
    mode:   meta.mode   || 'background',
    status: 'started',
    detail: meta.detail || null,
  });
  try {
    const result = await fn();
    record({
      id: start.id, // share the id so getActive() clears this row
      npc:    start.npc,
      kind:   start.kind,
      skill:  start.skill,
      task:   start.task,
      mode:   start.mode,
      status: 'done',
      durationMs: Date.now() - startedAt,
      detail: meta.completionDetail || null,
    });
    return result;
  } catch (err) {
    record({
      id: start.id,
      npc:    start.npc,
      kind:   start.kind,
      skill:  start.skill,
      task:   start.task,
      mode:   start.mode,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      detail: (err && err.message) ? String(err.message).slice(0, 240) : null,
    });
    throw err;
  }
}

/** Test convenience — wipe the ring. */
function _reset() {
  _events.length = 0;
}

module.exports = {
  record,
  getRecent,
  getStats,
  getActive,
  setBroadcast,
  wrapWithPcActivity,
  _reset,
};
