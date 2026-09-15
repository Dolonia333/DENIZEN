'use strict';

/**
 * First-class Studio Board MCP tools — manage the agency board like CRM.
 */

const boardStore = require('./denizen-studio-board-store');
const boardMutations = require('./denizen-studio-board-mutations');
const denizenDb = require('./denizen-db');

const STUDIO_BOARD_TOOL_DEFINITIONS = [
  {
    name: 'studio_board_working_set',
    description:
      'READ-ONLY Studio Board working set: open tasks, overdue, stuck/blocked, people, pipeline stages. '
      + 'Call this first before creating or advancing Studio Board tasks. Empty board is OK — do not invent work.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Optional note for agent context' },
      },
    },
  },
  {
    name: 'studio_board_brief',
    description: 'Short Studio Board briefing: counts, overdue titles, stuck items, pipeline stage mix.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Optional focus (client, assignee, stage)' },
      },
    },
  },
  {
    name: 'studio_board_list_tasks',
    description: 'List Studio Board tasks with optional filters (status, assignee, client, search, open_only).',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Pipeline stage id' },
        assignee: { type: 'string', description: 'Person id or name' },
        client: { type: 'string', description: 'Client / account label' },
        search: { type: 'string', description: 'Title/notes search' },
        open_only: { type: 'boolean', description: 'Exclude final/done stages' },
        limit: { type: 'number', description: 'Max tasks (default 40)' },
      },
    },
  },
  {
    name: 'studio_board_get_task',
    description: 'Get one Studio Board task by id (includes notes, comments, subtasks, log).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id' },
        task_id: { type: 'string', description: 'Alias for id' },
      },
      required: ['id'],
    },
  },
  {
    name: 'studio_board_upsert_task',
    description:
      'Create or update a Studio Board task. Pass id to update; omit id to create. '
      + 'Prefer studio_board_working_set first so you reuse real people/stage ids.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Existing task id (omit to create)' },
        title: { type: 'string', description: 'Task title' },
        client: { type: 'string', description: 'Client / brand' },
        type: { type: 'string', description: 'Category id from board config' },
        assignee: { type: 'string', description: 'Person id or name' },
        status: { type: 'string', description: 'Pipeline stage id' },
        priority: { type: 'string', description: 'e.g. low|normal|high' },
        due: { type: 'string', description: 'YYYY-MM-DD' },
        notes: { type: 'string', description: 'Task notes' },
      },
      required: ['title'],
    },
  },
  {
    name: 'studio_board_advance_task',
    description:
      'Advance a task to the next pipeline stage, or set status explicitly. '
      + 'For blocked stages, pass reason.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id' },
        status: { type: 'string', description: 'Explicit stage id (optional)' },
        reason: { type: 'string', description: 'Block reason when moving to a blocked stage' },
      },
      required: ['id'],
    },
  },
  {
    name: 'studio_board_assign_task',
    description: 'Assign a Studio Board task to a teammate (person id or name).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id' },
        assignee: { type: 'string', description: 'Person id or name' },
      },
      required: ['id', 'assignee'],
    },
  },
  {
    name: 'studio_board_add_comment',
    description: 'Add a comment on a Studio Board task (shows in Activity / task drawer).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id' },
        comment: { type: 'string', description: 'Comment text' },
      },
      required: ['id', 'comment'],
    },
  },
  {
    name: 'studio_board_list_people',
    description: 'List people on the Studio Board team strip.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'studio_board_upsert_person',
    description: 'Create or update a Studio Board person (name, role, color).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Existing person id (omit to create)' },
        name: { type: 'string', description: 'Display name' },
        role: { type: 'string', description: 'Role label' },
        color: { type: 'string', description: 'Avatar hex color' },
      },
      required: ['name'],
    },
  },
];

function hasStudioBoardAccess(npcKey) {
  const key = String(npcKey || '').toLowerCase();
  if (!key || key === '_team') return true;
  // Office NPCs that already touch CRM / ops also get Studio Board.
  const allowed = new Set([
    'abby', 'lucy', 'marcus', 'sarah', 'jenny', 'rob', 'josh', 'molly', 'dan', 'edward', 'oscar', 'pier', 'roki', 'bob', 'alex',
  ]);
  return allowed.has(key);
}

function toolsForNpc(npcKey) {
  if (!hasStudioBoardAccess(npcKey)) return [];
  return [...STUDIO_BOARD_TOOL_DEFINITIONS];
}

function isStudioBoardTool(name) {
  return STUDIO_BOARD_TOOL_DEFINITIONS.some((t) => t.name === name);
}

function resolveOrgId(scope) {
  return scope?.org_id || denizenDb.orgId || null;
}

function actorFromScope(scope) {
  return {
    npc_key: scope?.npc_key || 'mcp',
    displayName: scope?.npc_key || 'MCP',
    identityId: scope?.identity_id || null,
  };
}

async function toolWorkingSet(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const row = await boardStore.getWorkspace(orgId);
  const board = boardMutations.buildWorkingSet(row?.state || boardStore.emptyState());
  const c = board.counts || {};
  return {
    ok: true,
    focus: args?.focus || null,
    summary: board.empty
      ? 'Studio Board empty — no tasks yet. Do not invent client work.'
      : `Studio Board: ${c.open} open, ${c.overdue} overdue, ${c.stuck} stuck, ${c.people} people.`,
    ...board,
  };
}

async function toolBrief(scope, args = {}) {
  const ws = await toolWorkingSet(scope, args);
  if (!ws.ok) return ws;
  const overdueTitles = (ws.overdue || []).slice(0, 5).map((t) => t.title);
  const stuckTitles = (ws.stuck || []).slice(0, 5).map((t) => t.title);
  return {
    ok: true,
    focus: args?.focus || null,
    summary: ws.summary,
    counts: ws.counts,
    overdue_titles: overdueTitles,
    stuck_titles: stuckTitles,
    stages: ws.stages,
  };
}

async function callTool(scope, name, args = {}) {
  const key = scope?.npc_key;
  if (!hasStudioBoardAccess(key) && scope?.scope_mode !== 'team') {
    return { ok: false, error: `Studio Board tools not available for ${key}` };
  }
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const identityId = scope?.identity_id || null;
  const actor = actorFromScope(scope);

  switch (name) {
    case 'studio_board_working_set':
      return toolWorkingSet(scope, args);
    case 'studio_board_brief':
      return toolBrief(scope, args);
    case 'studio_board_list_tasks':
      return boardMutations.listTasks(orgId, args || {});
    case 'studio_board_get_task':
      return boardMutations.getTask(orgId, args?.id || args?.task_id || args?.taskId);
    case 'studio_board_upsert_task':
      return boardMutations.upsertTask(orgId, args || {}, identityId, actor);
    case 'studio_board_advance_task':
      return boardMutations.advanceTask(orgId, args || {}, identityId, actor);
    case 'studio_board_assign_task':
      return boardMutations.assignTask(orgId, args || {}, identityId, actor);
    case 'studio_board_add_comment':
      return boardMutations.addComment(orgId, args || {}, identityId, actor);
    case 'studio_board_list_people':
      return boardMutations.listPeople(orgId);
    case 'studio_board_upsert_person':
      return boardMutations.upsertPerson(orgId, args || {}, identityId);
    default:
      return { ok: false, error: `unknown studio board tool: ${name}` };
  }
}

module.exports = {
  STUDIO_BOARD_TOOL_DEFINITIONS,
  hasStudioBoardAccess,
  toolsForNpc,
  isStudioBoardTool,
  callTool,
};
