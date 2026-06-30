'use strict';

/**
 * Mesh / City Power MCP tools (Phase 5).
 * Exposes compute queue + inference pool to Cursor/Claude via Denizen MCP.
 */

const ALLOWED_JOB_TYPES = new Set([
  'embedding_index',
  'npc_think_batch',
  'inference_rpc',
  'sim_tick',
  'cursor_bridge',
  'web_search',
]);

const MESH_TOOL_DEFINITIONS = [
  {
    name: 'enqueue_compute_job',
    description: 'Enqueue a City Power mesh job (embedding_index, inference_rpc, sim_tick, npc_think_batch). Returns job id for polling.',
    inputSchema: {
      type: 'object',
      properties: {
        job_type: { type: 'string', description: 'Job type, e.g. inference_rpc, embedding_index' },
        payload: { type: 'object', description: 'Job payload (target_node_id, model, messages, etc.)' },
        priority: { type: 'number', description: '0–100 (default 50)' },
        wait: { type: 'boolean', description: 'If true, block until done/failed (default false)' },
        timeout_ms: { type: 'number', description: 'Max wait when wait=true (default 120000)' },
      },
      required: ['job_type'],
    },
  },
  {
    name: 'get_job_status',
    description: 'Poll a mesh compute job by id (queued, assigned, done, failed).',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job UUID from enqueue_compute_job' },
        wait: { type: 'boolean', description: 'If true, poll until terminal state' },
        timeout_ms: { type: 'number', description: 'Max wait when wait=true (default 60000)' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'get_inference_nodes',
    description: 'Full LM Studio / inference mesh pool: nodes, scores, models, saturation.',
    inputSchema: {
      type: 'object',
      properties: {
        include_unreachable: { type: 'boolean', description: 'Include nodes marked unreachable (default true)' },
      },
    },
  },
];

let _deps = {};

function configure(deps = {}) {
  _deps = { ..._deps, ...deps };
}

function isMeshTool(name) {
  return MESH_TOOL_DEFINITIONS.some((t) => t.name === name);
}

function toolsForNpc(npcKey) {
  // Make available to Grok and other capable NPCs for mesh ops
  const key = String(npcKey || '').toLowerCase();
  if (key === 'grok' || key === 'oscar' || key.includes('compute')) {
    return [...MESH_TOOL_DEFINITIONS];
  }
  return [];
}

async function toolEnqueueComputeJob(scope, args) {
  const computeQueue = _deps.computeQueue;
  if (!computeQueue?.enqueueJob) {
    return { ok: false, error: 'compute queue not configured' };
  }
  if (typeof computeQueue.isEnabled === 'function' && !computeQueue.isEnabled()) {
    return { ok: false, error: 'compute queue disabled (Supabase required)' };
  }

  const jobType = String(args?.job_type || args?.jobType || '').trim();
  if (!jobType) return { ok: false, error: 'job_type required' };
  if (!ALLOWED_JOB_TYPES.has(jobType)) {
    return { ok: false, error: `unsupported job_type: ${jobType}`, allowed: [...ALLOWED_JOB_TYPES] };
  }

  const payload = {
    ...(args?.payload && typeof args.payload === 'object' ? args.payload : {}),
    org_id: scope.org_id,
    session_id: scope.session_id || null,
    member_id: scope.member_id || null,
    npc_key: scope.npc_key,
    source: 'mcp',
  };

  let job;
  try {
    job = await computeQueue.enqueueJob({
      jobType,
      payload,
      priority: args?.priority,
    });
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }

  if (!job?.id) return { ok: false, error: 'enqueue failed' };

  const wait = args?.wait === true;
  if (!wait) {
    return { ok: true, job_id: job.id, status: job.status || 'queued', job };
  }

  const timeoutMs = Math.max(5000, Number(args?.timeout_ms) || 120_000);
  const finalJob = await computeQueue.waitForJob(job.id, { timeoutMs });
  if (!finalJob) {
    return { ok: false, error: 'timeout', job_id: job.id, status: 'timeout' };
  }
  return {
    ok: finalJob.status === 'done',
    job_id: finalJob.id,
    status: finalJob.status,
    job: finalJob,
  };
}

async function toolGetJobStatus(scope, args) {
  const computeQueue = _deps.computeQueue;
  if (!computeQueue?.getJobById) {
    return { ok: false, error: 'compute queue not configured' };
  }

  const jobId = String(args?.job_id || args?.jobId || '').trim();
  if (!jobId) return { ok: false, error: 'job_id required' };

  const wait = args?.wait === true;
  const timeoutMs = Math.max(1000, Number(args?.timeout_ms) || 60_000);

  const job = wait
    ? await computeQueue.waitForJob(jobId, { timeoutMs })
    : await computeQueue.getJobById(jobId);

  if (!job) return { ok: false, error: 'job not found', job_id: jobId };

  const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
  if (payload.org_id && scope.org_id && payload.org_id !== scope.org_id) {
    return { ok: false, error: 'job not in your org' };
  }

  return {
    ok: true,
    job_id: job.id,
    status: job.status,
    job_type: job.job_type,
    assigned_node_id: job.assigned_node_id || null,
    result: job.result || null,
    error: job.error || null,
    created_at: job.created_at,
    completed_at: job.completed_at || null,
  };
}

async function toolGetInferenceNodes(scope, args) {
  const router = _deps.lmStudioRouter;
  if (!router?.buildStatus) {
    return { ok: false, error: 'inference router not configured' };
  }

  const queueDepth = _deps.npcBrains?.getQueueDepth?.() || 0;
  const status = router.buildStatus(queueDepth);
  const includeUnreachable = args?.include_unreachable !== false;

  let nodes = status?.nodes || [];
  if (!includeUnreachable) {
    nodes = nodes.filter((n) => n.reachable !== false);
  }

  return {
    ok: true,
    org_slug: scope.org_slug,
    enabled: status.enabled,
    saturated: status.saturated,
    any_reachable: status.any_reachable,
    remote_nodes: status.remote_nodes,
    host_url: status.host_url,
    queue_depth: queueDepth,
    selected: status.selected,
    nodes,
    count: nodes.length,
  };
}

async function callTool(scope, name, args) {
  switch (name) {
    case 'enqueue_compute_job': return toolEnqueueComputeJob(scope, args);
    case 'get_job_status': return toolGetJobStatus(scope, args);
    case 'get_inference_nodes': return toolGetInferenceNodes(scope, args);
    default: return { ok: false, error: `unknown mesh tool: ${name}` };
  }
}

module.exports = {
  configure,
  MESH_TOOL_DEFINITIONS,
  toolsForNpc,
  isMeshTool,
  callTool,
  ALLOWED_JOB_TYPES,
};
