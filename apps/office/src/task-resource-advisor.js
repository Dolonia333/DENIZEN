'use strict';

/**
 * Task resource advisor — mesh ETA, API spend hint, desktop pairing need.
 * Used in visitor assistant chat and /api/compute/task-advice.
 */

let resourcePressure = null;
try { resourcePressure = require('./resource-pressure'); } catch (_) {}

const TOKEN_ESTIMATES = {
  chat: { in: 8000, out: 400 },
  research: { in: 12000, out: 800 },
  coding: { in: 28000, out: 4500 },
  github: { in: 10000, out: 700 },
  browser: { in: 14000, out: 900 },
  skill_build: { in: 18000, out: 2500 },
  default: { in: 10000, out: 600 },
};

const BASE_MINUTES = {
  chat: 1,
  research: 4,
  coding: 20,
  github: 6,
  browser: 8,
  skill_build: 12,
  default: 6,
};

// USD per 1M tokens — Claude Sonnet 4.6 rough single-task quote.
const SONNET_INPUT = 3.0;
const SONNET_OUTPUT = 15.0;

function inferTaskType(text) {
  const msg = String(text || '').toLowerCase();
  if (/\b(build|create|draft)\b.*\b(skill|tool)\b/.test(msg)) return 'skill_build';
  if (/\b(code|fix|bug|implement|refactor|patch|pr)\b/.test(msg)) return 'coding';
  if (/\b(github|pull request|issue)\b/.test(msg)) return 'github';
  if (/\b(browser|navigate|scrape|click|screen|desktop|pc)\b/.test(msg)) return 'browser';
  if (/\b(research|look up|find out|google|search)\b/.test(msg)) return 'research';
  if (/\b(chat|explain|summarize|what is)\b/.test(msg)) return 'chat';
  return 'default';
}

function countGpuNodes(fleet = []) {
  return (fleet || []).filter((n) => {
    const vram = Number(n?.gpu?.vram_total_mb ?? n?.vram_mb ?? 0);
    return vram >= 6000 || String(n?.role || '').toLowerCase() === 'host';
  }).length;
}

function countContributingNodes(fleet = []) {
  return (fleet || []).filter((n) => n?.contributing || n?.role === 'host').length;
}

function estimateApiSpendUsd(taskType) {
  const est = TOKEN_ESTIMATES[taskType] || TOKEN_ESTIMATES.default;
  const cost = (est.in / 1e6) * SONNET_INPUT + (est.out / 1e6) * SONNET_OUTPUT;
  return Math.max(0.01, Math.round(cost * 100) / 100);
}

function buildRecommendation({
  taskType,
  meshSaturated,
  meshEtaMinutes,
  needsApi,
  needsDesktop,
  suggestedSpendUsd,
  hasVisitorKey,
  queuePending,
}) {
  const parts = [];
  if (needsDesktop) {
    parts.push('This task needs Denizen Desktop paired for screen/PC control.');
  }
  if (meshSaturated) {
    parts.push(`Mesh is busy (${queuePending} queued jobs) — expect ~${meshEtaMinutes} min on local compute alone.`);
    if (needsApi && !hasVisitorKey) {
      parts.push(`Add an API key in Account settings (~$${suggestedSpendUsd} for this task on Claude Sonnet) or opt into mesh compute.`);
    } else if (needsApi && hasVisitorKey) {
      parts.push(`Your API key will be used while the mesh is saturated (~$${suggestedSpendUsd} estimated).`);
    }
  } else {
    parts.push(`Mesh has capacity — this ${taskType} task should finish in ~${meshEtaMinutes} min on shared compute.`);
  }
  return parts.join(' ');
}

/**
 * @param {object} opts
 * @returns {object} advice block for prompts and APIs
 */
function advise({
  taskText = '',
  taskType = null,
  queuePending = 0,
  assignedStuck = 0,
  fleet = [],
  lmStudioReachable = true,
  hasVisitorAnthropicKey = false,
  hasVisitorOpenaiKey = false,
  meshQueueDepth = null,
} = {}) {
  const type = taskType || inferTaskType(taskText);
  const pending = Number(meshQueueDepth ?? queuePending) || 0;
  const stuck = Number(assignedStuck) || 0;
  const gpuNodes = Math.max(1, countGpuNodes(fleet));
  const contributing = countContributingNodes(fleet);
  const hasVisitorKey = hasVisitorAnthropicKey || hasVisitorOpenaiKey;

  const pressureSignals = resourcePressure?.gatherSignals?.({
    queuePending: pending,
    assignedStuck: stuck,
    fleet,
    lmStudioReachable,
    denizenRoot: null,
  }) || null;

  const meshSaturated = pressureSignals?.saturated
    ?? (!lmStudioReachable || stuck > 0 || pending >= 5 || contributing < 1);

  const baseMin = BASE_MINUTES[type] || BASE_MINUTES.default;
  const queuePenalty = Math.floor(pending / 3) * 2 + stuck * 5;
  const meshEtaMinutes = Math.max(
    1,
    Math.round((baseMin + queuePenalty) / Math.max(1, gpuNodes * 0.75)),
  );

  const needsDesktop = /\b(screen|desktop|pc|click|type|mouse|window|app)\b/i.test(taskText);
  const suggestedSpendUsd = estimateApiSpendUsd(type);
  const needsApi = meshSaturated && type !== 'chat';

  const recommendation = buildRecommendation({
    taskType: type,
    meshSaturated,
    meshEtaMinutes,
    needsApi,
    needsDesktop,
    suggestedSpendUsd,
    hasVisitorKey,
    queuePending: pending,
  });

  return {
    task_type: type,
    mesh_eta_minutes: meshEtaMinutes,
    mesh_saturated: meshSaturated,
    needs_api: needsApi,
    needs_desktop: needsDesktop,
    suggested_spend_usd: suggestedSpendUsd,
    queue_pending: pending,
    assigned_stuck: stuck,
    contributing_nodes: contributing,
    gpu_nodes: gpuNodes,
    recommendation,
    resource_pressure: pressureSignals,
    prompt_block: [
      '## Task resource plan (mesh + API)',
      `- Task type: ${type}`,
      `- Mesh ETA: ~${meshEtaMinutes} min (${meshSaturated ? 'saturated' : 'healthy'})`,
      pressureSignals?.pressures?.length
        ? `- Live pressures: ${pressureSignals.pressures.join(', ')} (${pressureSignals.severity})`
        : null,
      needsDesktop ? '- Needs: Denizen Desktop paired' : null,
      needsApi && !hasVisitorKey ? `- Suggest: add API key (~$${suggestedSpendUsd} est.) or mesh opt-in` : null,
      needsApi && hasVisitorKey ? `- Will use visitor API key while mesh is busy (~$${suggestedSpendUsd} est.)` : null,
      `- Guidance: ${recommendation}`,
      meshCtxBlock(pressureSignals),
    ].filter(Boolean).join('\n'),
  };
}

function meshCtxBlock(signals) {
  if (!signals?.pressures?.length) return null;
  if (resourcePressure?.buildResourcePressureBlock) {
    return resourcePressure.buildResourcePressureBlock(signals);
  }
  return null;
}

function isMeshSaturated(ctx = {}) {
  return advise(ctx).mesh_saturated;
}

module.exports = {
  advise,
  inferTaskType,
  isMeshSaturated,
  estimateApiSpendUsd,
  TOKEN_ESTIMATES,
};
