'use strict';

/**
 * Shared CRM ↔ Studio Board bridge.
 * Used by MCP agency tools and CRM HTTP routes so both stay in sync.
 */

const crmStore = require('./denizen-crm-store');
const crmMutations = require('./denizen-crm-mutations');
const boardStore = require('./denizen-studio-board-store');
const boardMutations = require('./denizen-studio-board-mutations');

function studioIdsOnDeal(deal) {
  if (!deal) return [];
  if (Array.isArray(deal.studioTaskIds)) return deal.studioTaskIds.map(String);
  if (Array.isArray(deal.studio_task_ids)) return deal.studio_task_ids.map(String);
  return [];
}

function collectLinks(crmState, boardState) {
  const deals = Array.isArray(crmState?.deals) ? crmState.deals : [];
  const boardTasks = Array.isArray(boardState?.tasks) ? boardState.tasks : [];
  const byDeal = new Map();
  for (const d of deals) {
    const ids = studioIdsOnDeal(d);
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

async function listTasksForDeal(orgId, dealId) {
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  if (dealId == null || dealId === '') return { ok: false, error: 'deal_id required' };
  const [crmRow, boardRow] = await Promise.all([
    crmStore.getWorkspace(orgId),
    boardStore.getWorkspace(orgId),
  ]);
  const crmState = crmRow?.state || {};
  const boardState = boardRow?.state || boardStore.emptyState();
  const deal = (crmState.deals || []).find((d) => String(d?.id) === String(dealId));
  if (!deal) return { ok: false, error: 'CRM deal not found' };
  const idSet = new Set(studioIdsOnDeal(deal));
  const tasks = (boardState.tasks || []).filter((t) => {
    const linked = String(t.dealId ?? t.deal_id ?? '') === String(dealId);
    return linked || idSet.has(String(t.id));
  });
  // Heal one-way links so CRM and board stay consistent when read.
  const healedIds = [...new Set([...idSet, ...tasks.map((t) => String(t.id))])];
  return {
    ok: true,
    deal_id: String(dealId),
    deal: {
      id: deal.id,
      title: deal.title,
      stage: deal.stage,
      contact: deal.contact || null,
      company: deal.company || null,
      value: deal.value ?? null,
      studioTaskIds: healedIds,
    },
    tasks: tasks.map((t) => ({
      ...boardMutations.summarizeTask(t),
      notes: t.notes || '',
      due: t.due || null,
      dueTime: t.dueTime || t.due_time || null,
      priority: t.priority || null,
      type: t.type || null,
      client: t.client || null,
      assignee: t.assignee || null,
    })),
    stages: Array.isArray(boardState.config?.stages)
      ? boardState.config.stages.map((s) => ({ id: s.id, hex: s.hex || null, final: !!s.final }))
      : [],
    board_url: `/studio-board/?deal=${encodeURIComponent(String(dealId))}`,
  };
}

async function linkDealTask(orgId, { dealId, taskId, contactId = null, identityId = null, actor = null } = {}) {
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  if (dealId == null || dealId === '' || !taskId) {
    return { ok: false, error: 'deal_id and studio_task_id required' };
  }
  const existingTask = await boardMutations.getTask(orgId, taskId);
  if (!existingTask?.ok) return { ok: false, error: 'Studio Board task not found' };

  const boardRes = await boardMutations.upsertTask(orgId, {
    id: taskId,
    deal_id: dealId,
    contact_id: contactId ?? undefined,
  }, identityId, actor || { npc_key: 'agency' });
  if (!boardRes?.ok) return boardRes;

  const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
  const deals = Array.isArray(state.deals) ? [...state.deals] : [];
  const idx = deals.findIndex((d) => String(d?.id) === String(dealId));
  if (idx < 0) return { ok: false, error: 'CRM deal not found' };
  const prev = deals[idx];
  const nextIds = [...new Set([...studioIdsOnDeal(prev), String(taskId)])];
  deals[idx] = { ...prev, studioTaskIds: nextIds };
  await crmStore.upsertWorkspace(orgId, { ...state, deals }, identityId, { ifUpdatedAt });

  return {
    ok: true,
    summary: `Linked CRM deal ${dealId} ↔ Studio Board task ${taskId}.`,
    deal_id: String(dealId),
    studio_task_id: String(taskId),
    studio_task_ids: nextIds,
    task: boardRes.task,
  };
}

async function unlinkDealTask(orgId, { dealId, taskId, identityId = null } = {}) {
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  if (dealId == null || dealId === '' || !taskId) {
    return { ok: false, error: 'deal_id and studio_task_id required' };
  }

  const boardRow = await boardStore.getWorkspace(orgId);
  const boardState = boardRow?.state || boardStore.emptyState();
  const tasks = Array.isArray(boardState.tasks) ? boardState.tasks.map((x) => {
    if (String(x.id) !== String(taskId)) return x;
    const linked = x.dealId ?? x.deal_id;
    if (linked != null && String(linked) !== String(dealId)) return x;
    const next = { ...x };
    delete next.dealId;
    delete next.deal_id;
    return next;
  }) : [];
  await boardStore.upsertWorkspace(orgId, { ...boardState, tasks }, identityId, {
    ifUpdatedAt: boardRow?.updated_at || null,
  });

  const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
  const deals = Array.isArray(state.deals) ? [...state.deals] : [];
  const idx = deals.findIndex((d) => String(d?.id) === String(dealId));
  if (idx < 0) return { ok: false, error: 'CRM deal not found' };
  const prev = deals[idx];
  const nextIds = studioIdsOnDeal(prev).filter((id) => id !== String(taskId));
  deals[idx] = { ...prev, studioTaskIds: nextIds };
  await crmStore.upsertWorkspace(orgId, { ...state, deals }, identityId, { ifUpdatedAt });

  return {
    ok: true,
    summary: `Unlinked CRM deal ${dealId} from Studio Board task ${taskId}.`,
    deal_id: String(dealId),
    studio_task_id: String(taskId),
    studio_task_ids: nextIds,
  };
}

async function createDeliveryFromDeal(orgId, {
  dealId,
  title = null,
  assignee = null,
  status = null,
  due = null,
  notes = null,
  markWon = false,
  identityId = null,
  actor = null,
} = {}) {
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  if (dealId == null || dealId === '') return { ok: false, error: 'deal_id required' };

  let deal;
  let previousStage = null;
  try {
    if (markWon) {
      const dealResult = await crmMutations.updateDeal(orgId, {
        deal_id: dealId,
        stage: 'Closed Won',
      }, identityId);
      deal = dealResult.deal;
      previousStage = dealResult.previousStage || null;
    } else {
      const { state } = await crmMutations.loadOrgWorkspace(orgId);
      deal = (state.deals || []).find((d) => String(d?.id) === String(dealId));
      if (!deal) return { ok: false, error: 'deal not found' };
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }

  const taskTitle = String(title || `Delivery: ${deal.title}`).slice(0, 200);
  const boardRes = await boardMutations.upsertTask(orgId, {
    title: taskTitle,
    client: deal.company || deal.contact || '',
    deal_id: deal.id,
    assignee: assignee || null,
    status: status || undefined,
    due: due || undefined,
    notes: notes || `Linked from CRM deal #${deal.id} (${deal.stage}).`,
    priority: markWon ? 'high' : 'medium',
  }, identityId, actor || { npc_key: 'agency' });
  if (!boardRes?.ok) {
    return { ok: false, error: boardRes?.error || 'failed to create board task', deal };
  }

  const link = await linkDealTask(orgId, {
    dealId: deal.id,
    taskId: boardRes.task.id,
    identityId,
    actor,
  });
  return {
    ok: true,
    summary: `CRM “${deal.title}” → Board “${boardRes.task.title}”.`,
    deal,
    previous_stage: previousStage,
    task: boardRes.task,
    link,
    board_url: `/studio-board/?deal=${encodeURIComponent(String(deal.id))}&task=${encodeURIComponent(String(boardRes.task.id))}`,
  };
}

async function advanceDealTask(orgId, { dealId, taskId, status = null, identityId = null, actor = null } = {}) {
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const listed = await listTasksForDeal(orgId, dealId);
  if (!listed.ok) return listed;
  const hit = listed.tasks.find((t) => String(t.id) === String(taskId));
  if (!hit) return { ok: false, error: 'Task is not linked to this deal' };
  return boardMutations.advanceTask(
    orgId,
    { id: taskId, status: status || undefined },
    identityId,
    actor || { npc_key: 'agency' },
  );
}

module.exports = {
  collectLinks,
  listTasksForDeal,
  linkDealTask,
  unlinkDealTask,
  createDeliveryFromDeal,
  advanceDealTask,
  studioIdsOnDeal,
};
