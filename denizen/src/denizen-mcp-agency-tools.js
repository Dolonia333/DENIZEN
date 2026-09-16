'use strict';

/**
 * Cross-system CRM ↔ Studio Board MCP tools.
 * Keeps stores separate; optional link fields join them for agents.
 */

const crmStore = require('./denizen-crm-store');
const crmWorkingSet = require('./denizen-crm-working-set');
const boardStore = require('./denizen-studio-board-store');
const boardMutations = require('./denizen-studio-board-mutations');
const agencyBridge = require('./denizen-agency-bridge');
const denizenDb = require('./denizen-db');

const AGENCY_TOOL_DEFINITIONS = [
  {
    name: 'agency_working_set',
    description:
      'READ-ONLY joint brief: CRM open pipeline + Studio Board overdue/stuck, plus linked deal↔task pairs. '
      + 'Prefer this when coordinating sales + delivery.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Optional focus note' },
      },
    },
  },
  {
    name: 'agency_list_deal_tasks',
    description:
      'List Studio Board delivery tasks linked to a CRM deal (both deal.studio_task_ids and task.deal_id).',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'CRM deal id' },
      },
      required: ['deal_id'],
    },
  },
  {
    name: 'agency_link_deal_task',
    description:
      'Link a CRM deal to a Studio Board task both ways (task.deal_id + deal.studio_task_ids). '
      + 'Does not create records — pass existing ids.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'CRM deal id' },
        studio_task_id: { type: 'string', description: 'Studio Board task id' },
        contact_id: { type: 'string', description: 'Optional CRM contact id on the board task' },
      },
      required: ['deal_id', 'studio_task_id'],
    },
  },
  {
    name: 'agency_unlink_deal_task',
    description: 'Remove the bidirectional link between a CRM deal and a Studio Board task.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string' },
        studio_task_id: { type: 'string' },
      },
      required: ['deal_id', 'studio_task_id'],
    },
  },
  {
    name: 'agency_create_delivery_task',
    description:
      'Create a Studio Board delivery task from a CRM deal and link them. '
      + 'Does not require Closed Won — use for any active deal that needs delivery work.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string' },
        title: { type: 'string' },
        assignee: { type: 'string' },
        status: { type: 'string' },
        due: { type: 'string', description: 'YYYY-MM-DD' },
        notes: { type: 'string' },
      },
      required: ['deal_id'],
    },
  },
  {
    name: 'agency_handoff_won_deal',
    description:
      'Mark a CRM deal Closed Won (unless skip_stage_move) and create a linked Studio Board delivery task.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string' },
        title: { type: 'string' },
        assignee: { type: 'string' },
        status: { type: 'string' },
        skip_stage_move: { type: 'boolean' },
      },
      required: ['deal_id'],
    },
  },
  {
    name: 'agency_advance_deal_task',
    description: 'Advance (or set status on) a Studio Board task that is linked to a CRM deal.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string' },
        studio_task_id: { type: 'string' },
        status: { type: 'string', description: 'Optional explicit stage id' },
      },
      required: ['deal_id', 'studio_task_id'],
    },
  },
];

function resolveOrgId(scope) {
  return scope?.org_id || denizenDb.orgId || null;
}

function actorFromScope(scope) {
  return {
    npc_key: scope?.npc_key || 'mcp',
    displayName: scope?.display_name || scope?.user || scope?.npc_key || 'MCP',
    user: scope?.user || scope?.display_name || null,
    identityId: scope?.identity_id || null,
  };
}

function toolsForNpc(npcKey) {
  const mcpCrmTools = require('./denizen-mcp-crm-tools');
  if (!mcpCrmTools.hasCrmAccess(npcKey) && npcKey !== '_team') return [];
  return [...AGENCY_TOOL_DEFINITIONS];
}

function isAgencyTool(name) {
  return AGENCY_TOOL_DEFINITIONS.some((t) => t.name === name);
}

async function agencyWorkingSet(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const [crmRow, boardRow] = await Promise.all([
    crmStore.getWorkspace(orgId),
    boardStore.getWorkspace(orgId),
  ]);
  const crmState = crmRow?.state || {};
  const boardState = boardRow?.state || boardStore.emptyState();
  const crm = crmWorkingSet.buildWorkingSet(crmState);
  const board = boardMutations.buildWorkingSet(boardState);
  const links = agencyBridge.collectLinks(crmState, boardState);
  const cc = crm.counts || {};
  const bc = board.counts || {};
  return {
    ok: true,
    focus: args?.focus || null,
    summary: `Agency: CRM ${cc.open_pipeline || 0} live deals / $${Number(cc.open_pipeline_value || 0).toLocaleString()}; `
      + `Board ${bc.open || 0} open (${bc.overdue || 0} overdue, ${bc.stuck || 0} stuck); `
      + `${links.length} linked deal↔task pair(s).`,
    crm: {
      empty: !!crm.empty,
      counts: crm.counts,
      at_risk: (crm.atRiskDeals || []).slice(0, 8),
      open_tasks: (crm.openTasks || []).slice(0, 10),
      pipeline_deals: (crm.pipelineDeals || []).slice(0, 12),
    },
    studio: {
      empty: !!board.empty,
      counts: board.counts,
      overdue: (board.overdue || []).slice(0, 10),
      stuck: (board.stuck || []).slice(0, 10),
    },
    links,
    next_actions: [
      links.length === 0 && (cc.open_pipeline || 0) > 0
        ? 'Create delivery with agency_create_delivery_task or hand off won deals.'
        : null,
      (bc.overdue || 0) > 0 ? 'Clear Studio Board overdue before chasing new CRM pipeline.' : null,
      (cc.at_risk || 0) > 0 ? 'Review CRM at-risk deals in crm_working_set.' : null,
    ].filter(Boolean),
  };
}

async function agencyLinkDealTask(scope, args = {}) {
  return agencyBridge.linkDealTask(resolveOrgId(scope), {
    dealId: args.deal_id ?? args.dealId,
    taskId: String(args.studio_task_id || args.studioTaskId || args.task_id || '').trim(),
    contactId: args.contact_id ?? args.contactId ?? null,
    identityId: scope?.identity_id || null,
    actor: actorFromScope(scope),
  });
}

async function agencyUnlinkDealTask(scope, args = {}) {
  return agencyBridge.unlinkDealTask(resolveOrgId(scope), {
    dealId: args.deal_id ?? args.dealId,
    taskId: String(args.studio_task_id || args.studioTaskId || args.task_id || '').trim(),
    identityId: scope?.identity_id || null,
  });
}

async function agencyListDealTasks(scope, args = {}) {
  return agencyBridge.listTasksForDeal(resolveOrgId(scope), args.deal_id ?? args.dealId);
}

async function agencyCreateDeliveryTask(scope, args = {}) {
  return agencyBridge.createDeliveryFromDeal(resolveOrgId(scope), {
    dealId: args.deal_id ?? args.dealId,
    title: args.title || null,
    assignee: args.assignee || null,
    status: args.status || null,
    due: args.due || null,
    notes: args.notes || null,
    markWon: false,
    identityId: scope?.identity_id || null,
    actor: actorFromScope(scope),
  });
}

async function agencyHandoffWonDeal(scope, args = {}) {
  return agencyBridge.createDeliveryFromDeal(resolveOrgId(scope), {
    dealId: args.deal_id ?? args.dealId,
    title: args.title || null,
    assignee: args.assignee || null,
    status: args.status || null,
    markWon: !args.skip_stage_move,
    identityId: scope?.identity_id || null,
    actor: actorFromScope(scope),
  });
}

async function agencyAdvanceDealTask(scope, args = {}) {
  return agencyBridge.advanceDealTask(resolveOrgId(scope), {
    dealId: args.deal_id ?? args.dealId,
    taskId: String(args.studio_task_id || args.studioTaskId || args.task_id || '').trim(),
    status: args.status || null,
    identityId: scope?.identity_id || null,
    actor: actorFromScope(scope),
  });
}

async function callTool(scope, name, args = {}) {
  const mcpCrmTools = require('./denizen-mcp-crm-tools');
  const key = scope?.npc_key;
  if (!mcpCrmTools.hasCrmAccess(key) && scope?.scope_mode !== 'team' && key !== '_team') {
    return { ok: false, error: `Agency tools not available for ${key}` };
  }
  switch (name) {
    case 'agency_working_set':
      return agencyWorkingSet(scope, args);
    case 'agency_list_deal_tasks':
      return agencyListDealTasks(scope, args);
    case 'agency_link_deal_task':
      return agencyLinkDealTask(scope, args);
    case 'agency_unlink_deal_task':
      return agencyUnlinkDealTask(scope, args);
    case 'agency_create_delivery_task':
      return agencyCreateDeliveryTask(scope, args);
    case 'agency_handoff_won_deal':
      return agencyHandoffWonDeal(scope, args);
    case 'agency_advance_deal_task':
      return agencyAdvanceDealTask(scope, args);
    default:
      return { ok: false, error: `unknown agency tool: ${name}` };
  }
}

module.exports = {
  AGENCY_TOOL_DEFINITIONS,
  toolsForNpc,
  isAgencyTool,
  callTool,
  agencyWorkingSet,
  agencyLinkDealTask,
  agencyUnlinkDealTask,
  agencyListDealTasks,
  agencyCreateDeliveryTask,
  agencyHandoffWonDeal,
  agencyAdvanceDealTask,
  collectLinks: agencyBridge.collectLinks,
};
