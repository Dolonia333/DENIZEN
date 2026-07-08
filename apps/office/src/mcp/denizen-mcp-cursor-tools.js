'use strict';

/**
 * Denizen ↔ Cursor bridge — bidirectional self-improvement queue.
 *
 * Denizen NPCs enqueue structured work; Cursor polls via MCP, codes, completes.
 * Cursor can also enqueue work back into Denizen (assign_task / run_skill) via
 * the standard MCP tools on the same token.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_QUEUE_PATH = path.join(__dirname, '..', '..', 'data', 'cursor-bridge-queue.jsonl');
const MAX_BODY = 12_000;
const MAX_TITLE = 500;

const CURSOR_TOOL_DEFINITIONS = [
  {
    name: 'enqueue_cursor_work',
    description: 'Queue a coding/fix task for Cursor to pick up (self-improvement, bugfix, refactor). Cursor polls with list_cursor_work.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title' },
        description: { type: 'string', description: 'Full context: files, error logs, acceptance criteria' },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Repo-relative paths to focus on',
        },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Default normal' },
        kind: { type: 'string', description: 'bugfix | feature | refactor | ops (default bugfix)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_cursor_work',
    description: 'List pending Cursor bridge tasks for your org (Cursor polls this to find work Denizen queued).',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'pending | in_progress | done | all (default pending)' },
        limit: { type: 'number', description: 'Max rows (default 20)' },
      },
    },
  },
  {
    name: 'claim_cursor_work',
    description: 'Mark a queued task in_progress (Cursor claims it before editing).',
    inputSchema: {
      type: 'object',
      properties: {
        work_id: { type: 'string', description: 'Work id from list_cursor_work' },
        agent: { type: 'string', description: 'Optional agent label, e.g. cursor' },
      },
      required: ['work_id'],
    },
  },
  {
    name: 'complete_cursor_work',
    description: 'Mark Cursor work done or failed; optionally log summary and files changed.',
    inputSchema: {
      type: 'object',
      properties: {
        work_id: { type: 'string' },
        ok: { type: 'boolean', description: 'true if succeeded (default true)' },
        summary: { type: 'string', description: 'What was done' },
        files_changed: { type: 'array', items: { type: 'string' } },
        pr_url: { type: 'string', description: 'Optional PR or commit link' },
      },
      required: ['work_id'],
    },
  },
];

let _deps = {};

function queuePath() {
  return _deps.queuePath || DEFAULT_QUEUE_PATH;
}

function configure(deps = {}) {
  _deps = { ..._deps, ...deps };
}

function isCursorTool(name) {
  return CURSOR_TOOL_DEFINITIONS.some((t) => t.name === name);
}

function toolsForNpc() {
  return [...CURSOR_TOOL_DEFINITIONS];
}

function ensureQueueFile() {
  const QUEUE_PATH = queuePath();
  const dir = path.dirname(QUEUE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(QUEUE_PATH)) fs.writeFileSync(QUEUE_PATH, '', 'utf8');
}

function readAllRows() {
  const QUEUE_PATH = queuePath();
  ensureQueueFile();
  const raw = fs.readFileSync(QUEUE_PATH, 'utf8');
  const rows = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { rows.push(JSON.parse(t)); } catch (_) { /* skip corrupt */ }
  }
  return rows;
}

function writeAllRows(rows) {
  const QUEUE_PATH = queuePath();
  ensureQueueFile();
  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  fs.writeFileSync(QUEUE_PATH, body ? `${body}\n` : '', 'utf8');
}

function priorityRank(p) {
  const map = { urgent: 4, high: 3, normal: 2, low: 1 };
  return map[String(p || 'normal').toLowerCase()] || 2;
}

function filterOrg(rows, orgId) {
  if (!orgId) return rows;
  return rows.filter((r) => !r.org_id || r.org_id === orgId);
}

async function toolEnqueueCursorWork(scope, args) {
  const title = String(args?.title || args?.task || '').trim().slice(0, MAX_TITLE);
  if (!title) return { ok: false, error: 'title required' };

  const row = {
    id: `cwr_${crypto.randomBytes(8).toString('hex')}`,
    org_id: scope.org_id,
    org_slug: scope.org_slug || null,
    npc_key: scope.npc_key,
    session_id: scope.session_id || null,
    member_id: scope.member_id || null,
    title,
    description: String(args?.description || args?.context || '').slice(0, MAX_BODY),
    files: Array.isArray(args?.files) ? args.files.map(String).slice(0, 40) : [],
    priority: args?.priority || 'normal',
    kind: args?.kind || 'bugfix',
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    claimed_by: null,
    result: null,
  };

  const rows = readAllRows();
  rows.push(row);
  writeAllRows(rows);

  if (typeof _deps.broadcast === 'function') {
    _deps.broadcast({
      type: 'cursor_work_enqueued',
      work_id: row.id,
      title: row.title,
      npc_key: scope.npc_key,
      priority: row.priority,
    });
  }

  return { ok: true, work_id: row.id, status: 'pending', work: row };
}

async function toolListCursorWork(scope, args) {
  const limit = Math.max(1, Math.min(50, Number(args?.limit) || 20));
  const statusFilter = String(args?.status || 'pending').toLowerCase();

  let rows = filterOrg(readAllRows(), scope.org_id);
  if (statusFilter !== 'all') {
    rows = rows.filter((r) => String(r.status || 'pending') === statusFilter);
  }

  rows.sort((a, b) => {
    const pr = priorityRank(b.priority) - priorityRank(a.priority);
    if (pr !== 0) return pr;
    return String(a.created_at).localeCompare(String(b.created_at));
  });

  return {
    ok: true,
    count: rows.length,
    items: rows.slice(0, limit),
    hint: 'Cursor: claim with claim_cursor_work, implement, then complete_cursor_work. Use run_skill coding-agent for in-repo worktrees.',
  };
}

async function toolClaimCursorWork(scope, args) {
  const workId = String(args?.work_id || '').trim();
  if (!workId) return { ok: false, error: 'work_id required' };

  const rows = readAllRows();
  const idx = rows.findIndex((r) => r.id === workId);
  if (idx < 0) return { ok: false, error: 'work not found' };
  const row = rows[idx];
  if (row.org_id && scope.org_id && row.org_id !== scope.org_id) {
    return { ok: false, error: 'work not in your org' };
  }
  if (row.status !== 'pending') {
    return { ok: false, error: `cannot claim status=${row.status}`, work_id: workId };
  }

  row.status = 'in_progress';
  row.claimed_by = args?.agent || 'cursor';
  row.claimed_at = new Date().toISOString();
  row.updated_at = row.claimed_at;
  rows[idx] = row;
  writeAllRows(rows);

  return { ok: true, work_id: workId, status: 'in_progress', work: row };
}

async function toolCompleteCursorWork(scope, args) {
  const workId = String(args?.work_id || '').trim();
  if (!workId) return { ok: false, error: 'work_id required' };

  const rows = readAllRows();
  const idx = rows.findIndex((r) => r.id === workId);
  if (idx < 0) return { ok: false, error: 'work not found' };
  const row = rows[idx];
  if (row.org_id && scope.org_id && row.org_id !== scope.org_id) {
    return { ok: false, error: 'work not in your org' };
  }

  const succeeded = args?.ok !== false;
  row.status = succeeded ? 'done' : 'failed';
  row.updated_at = new Date().toISOString();
  row.completed_at = row.updated_at;
  row.result = {
    ok: succeeded,
    summary: String(args?.summary || '').slice(0, 4000),
    files_changed: Array.isArray(args?.files_changed) ? args.files_changed.slice(0, 40) : [],
    pr_url: args?.pr_url || null,
    completed_by: args?.agent || 'cursor',
  };
  rows[idx] = row;
  writeAllRows(rows);

  const note = `[cursor-bridge] ${succeeded ? 'Done' : 'Failed'}: ${row.title} — ${String(row.result.summary || '').slice(0, 200)}`;
  if (_deps.denizenDb?.recordWorkOutput) {
    _deps.denizenDb.recordWorkOutput({
      orgId: scope.org_id,
      npcName: row.npc_key || scope.npc_key,
      phase: 'cursor-bridge',
      action: succeeded ? 'completed' : 'failed',
      note,
      role: 'mcp',
    });
  }

  return { ok: true, work_id: workId, status: row.status, work: row };
}

async function callTool(scope, name, args) {
  switch (name) {
    case 'enqueue_cursor_work': return toolEnqueueCursorWork(scope, args);
    case 'list_cursor_work': return toolListCursorWork(scope, args);
    case 'claim_cursor_work': return toolClaimCursorWork(scope, args);
    case 'complete_cursor_work': return toolCompleteCursorWork(scope, args);
    default: return { ok: false, error: `unknown cursor tool: ${name}` };
  }
}

module.exports = {
  configure,
  CURSOR_TOOL_DEFINITIONS,
  toolsForNpc,
  isCursorTool,
  callTool,
  DEFAULT_QUEUE_PATH,
};
