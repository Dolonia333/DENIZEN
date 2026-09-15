'use strict';

/**
 * Cross-system CRM ↔ Studio Board MCP tools.
 * Keeps stores separate; optional link fields join them for agents.
 */

const crmStore = require('./denizen-crm-store');
const crmWorkingSet = require('./denizen-crm-working-set');
const crmMutations = require('./denizen-crm-mutations');
const boardStore = require('./denizen-studio-board-store');
const boardMutations = require('./denizen-studio-board-mutations');
const denizenDb = require('./denizen-db');

const AGENCY_TOOL_DEFINITIONS = [
  {
    name: 'agency_working_set',
    description:
      'READ-ONLY joint brief: CRM open pipeline + Studio Board overdue/stuck, plus linked deal↔task pairs. '
      + 'Prefer this when coordinating sales + delivery. Solo tools (crm_working_set / studio_board_working_set) still apply.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Optional focus note' },
      },
    },
  },
  {
    name: 'agency_link_deal_task',
    description:
      'Link a CRM deal to a Studio Board task both ways (task.deal_id + deal.studio_task_ids). '
      + 'Does not create records — pass existing ids. Optional contact_id on the board task.',
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
    name: 'agency_handoff_won_deal',
    description:
      'Mark a CRM deal Closed Won (or leave if already won) and create a linked Studio Board delivery task. '
      + 'Use after a sale closes to start agency delivery work.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'CRM deal id' },
        title: { type: 'string', description: 'Override board task title' },
        assignee: { type: 'string', description: 'Board person id or name' },
        status: { type: 'string', description: 'Board stage id (default first stage)' },
        skip_stage_move: { type: 'boolean', description: 'If true, do not change CRM stage' },
      },
      required: ['deal_id'],
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
  // Same gate as CRM — agency sits on sales+delivery.
  const mcpCrmTools = require('./denizen-mcp-crm-tools');
  if (!mcpCrmTools.hasCrmAccess(npcKey) && npcKey !== '_team') return [];
  return [...AGENCY_TOOL_DEFINITIONS];
}

function isAgencyTool(name) {
  return AGENCY_TOOL_DEFINITIONS.some((t) => t.name === name);
}

function collectLinks(crmState, boardState) {
  const deals = Array.isArray(crmState?.deals) ? crmState.deals : [];
  const boardTasks = Array.isArray(boardState?.tasks) ? boardState.tasks : [];
  const byDeal = new Map();
  for (const d of deals) {
    const ids = Array.isArray(d.studioTaskIds) ? d.studioTaskIds.map(String)
      : (Array.isArray(d.studio_task_ids) ? d.studio_task_ids.map(String) : []);
    if (ids.length) byDeal.set(String(d.id), new Set(ids));
  }
  for (const t of boardTasks) {
    const dealId = t.dealId ?? t.deal_id;
    if (dealId == null || dealId === '') continue;
    const key = String(dealId);
    if (!byDeal.has(key)) byDeal.set(key, new Set());
    byDeal.get(key).add(String(t.id));
  }
  const links = [];
  for (const [dealId, taskIds] of byDeal) {
    const deal = deals.find((d) => String(d.id) === dealId);
    links.push({
      deal_id: dealId,
      deal_title: deal?.title || null,
      deal_stage: deal?.stage || null,
      studio_task_ids: [...taskIds],
      tasks: [...taskIds].map((tid) => {
        const t = boardTasks.find((x) => String(x.id) === tid);
        return t ? boardMutations.summarizeTask(t) : { id: tid, missing: true };
      }),
    });
  }
  return links;
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
  const links = collectLinks(crmState, boardState);
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
        ? 'Link delivery work with agency_link_deal_task or agency_handoff_won_deal.'
        : null,
      (bc.overdue || 0) > 0 ? 'Clear Studio Board overdue before chasing new CRM pipeline.' : null,
      (cc.at_risk || 0) > 0 ? 'Review CRM at-risk deals in crm_working_set.' : null,
    ].filter(Boolean),
  };
}

async function agencyLinkDealTask(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const dealId = args.deal_id ?? args.dealId;
  const taskId = String(args.studio_task_id || args.studioTaskId || args.task_id || '').trim();
  if (dealId == null || dealId === '' || !taskId) {
    return { ok: false, error: 'deal_id and studio_task_id required' };
  }
  const identityId = scope?.identity_id || null;
  const actor = actorFromScope(scope);

  const existingTask = await boardMutations.getTask(orgId, taskId);
  if (!existingTask?.ok) return { ok: false, error: 'Studio Board task not found' };

  const boardRes = await boardMutations.upsertTask(orgId, {
    id: taskId,
    deal_id: dealId,
    contact_id: args.contact_id ?? args.contactId ?? undefined,
  }, identityId, actor);
  if (!boardRes?.ok) return boardRes;

  const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
  const deals = Array.isArray(state.deals) ? [...state.deals] : [];
  const idx = deals.findIndex((d) => String(d?.id) === String(dealId));
  if (idx < 0) return { ok: false, error: 'CRM deal not found' };
  const prev = deals[idx];
  const existing = Array.isArray(prev.studioTaskIds) ? prev.studioTaskIds.map(String)
    : (Array.isArray(prev.studio_task_ids) ? prev.studio_task_ids.map(String) : []);
  const nextIds = [...new Set([...existing, taskId])];
  deals[idx] = { ...prev, studioTaskIds: nextIds };
  await crmStore.upsertWorkspace(orgId, { ...state, deals }, identityId, { ifUpdatedAt });

  return {
    ok: true,
    summary: `Linked CRM deal ${dealId} ↔ Studio Board task ${taskId}.`,
    deal_id: String(dealId),
    studio_task_id: taskId,
    studio_task_ids: nextIds,
    task: boardRes.task,
  };
}

async function agencyHandoffWonDeal(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const dealId = args.deal_id ?? args.dealId;
  if (dealId == null || dealId === '') return { ok: false, error: 'deal_id required' };
  const identityId = scope?.identity_id || null;
  const actor = actorFromScope(scope);

  let dealResult;
  try {
    if (args.skip_stage_move) {
      const { state } = await crmMutations.loadOrgWorkspace(orgId);
      const deal = (state.deals || []).find((d) => String(d?.id) === String(dealId));
      if (!deal) return { ok: false, error: 'deal not found' };
      dealResult = { deal, previousStage: deal.stage, summary: `Using deal "${deal.title}" without stage change.` };
    } else {
      dealResult = await crmMutations.updateDeal(orgId, {
        deal_id: dealId,
        stage: 'Closed Won',
      }, identityId);
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }

  const deal = dealResult.deal;
  const title = String(args.title || `Kickoff: ${deal.title}`).slice(0, 200);
  const boardRes = await boardMutations.upsertTask(orgId, {
    title,
    client: deal.company || deal.contact || '',
    deal_id: deal.id,
    assignee: args.assignee || null,
    status: args.status || undefined,
    notes: `Handoff from CRM deal #${deal.id} (${deal.stage}).`,
    priority: 'high',
  }, identityId, actor);
  if (!boardRes?.ok) {
    return { ok: false, error: boardRes?.error || 'failed to create board task', deal };
  }

  const link = await agencyLinkDealTask(scope, {
    deal_id: deal.id,
    studio_task_id: boardRes.task.id,
  });
  return {
    ok: true,
    summary: `Won handoff: CRM “${deal.title}” → Board “${boardRes.task.title}”.`,
    deal,
    previous_stage: dealResult.previousStage || null,
    task: boardRes.task,
    link,
  };
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
    case 'agency_link_deal_task':
      return agencyLinkDealTask(scope, args);
    case 'agency_handoff_won_deal':
      return agencyHandoffWonDeal(scope, args);
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
  agencyHandoffWonDeal,
  collectLinks,
};
