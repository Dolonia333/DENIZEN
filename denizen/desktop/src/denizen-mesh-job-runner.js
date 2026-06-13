'use strict';

const { normalizeBaseUrl, probeLmStudioEndpoint } = require('./lm-studio-probe');

const LM_STUDIO_URL = normalizeBaseUrl(
  process.env.LM_STUDIO_URL
  || process.env.LM_STUDIO_BASE_URL
  || 'http://127.0.0.1:1234',
);

function lmStudioBase(url = LM_STUDIO_URL) {
  return normalizeBaseUrl(url || LM_STUDIO_URL);
}

async function isLmStudioReachable(url = LM_STUDIO_URL) {
  const probe = await probeLmStudioEndpoint(lmStudioBase(url), { timeoutMs: 4000 });
  return !!probe.reachable;
}

async function resolveLmStudioModel(base) {
  const pinned = process.env.LM_STUDIO_FAST_MODEL || process.env.LM_STUDIO_MODEL;
  if (pinned) return pinned;

  const res = await fetch(`${base}/v1/models`, {
    method: 'GET',
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) return null;

  const data = await res.json().catch(() => ({}));
  const models = Array.isArray(data?.data) ? data.data : [];
  const first = models.find((m) => m?.id) || models[0];
  return first?.id ? String(first.id) : null;
}

function mockMeshJob(jobType, payload = {}) {
  const type = String(jobType || '').trim();
  const safePayload = payload && typeof payload === 'object' ? payload : {};

  if (type === 'npc_think_batch') {
    return {
      ok: true,
      jobType: type,
      mocked: true,
      thought_count: Array.isArray(safePayload.npc_ids) ? safePayload.npc_ids.length : 1,
      completed_at: new Date().toISOString(),
    };
  }

  if (type === 'embedding_index') {
    return {
      ok: true,
      jobType: type,
      mocked: true,
      indexed_documents: Array.isArray(safePayload.documents) ? safePayload.documents.length : 0,
      completed_at: new Date().toISOString(),
    };
  }

  if (type === 'sim_tick') {
    return {
      ok: true,
      jobType: type,
      mocked: true,
      tick_ms: Number(safePayload.tick_ms || 33),
      world_delta: { npc_updates: 0, events: 0 },
      completed_at: new Date().toISOString(),
    };
  }

  return {
    ok: false,
    jobType: type || 'unknown',
    mocked: true,
    error: `Unsupported local job type: ${type || 'unknown'}`,
    completed_at: new Date().toISOString(),
  };
}

async function runNpcThinkBatch(payload = {}) {
  const npcIds = Array.isArray(payload.npc_ids) ? payload.npc_ids : [];
  const thoughtCount = npcIds.length || 1;
  const base = lmStudioBase();
  const model = await resolveLmStudioModel(base);
  if (!model) throw new Error('No LM Studio model available');
  const npcLabel = npcIds.slice(0, 8).join(', ') || 'office worker';

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: 'You simulate brief NPC thoughts in a virtual office. Reply with one short sentence only.',
      },
      {
        role: 'user',
        content: `NPCs: ${npcLabel}. One ambient thought (max 20 words).`,
      },
    ],
    max_tokens: 48,
    temperature: 0.75,
  };

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LM_STUDIO_API_KEY || 'lm-studio'}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LM Studio chat failed (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`);
  }

  const data = await res.json();
  const msg = data?.choices?.[0]?.message || {};
  const thought = String(msg.content || msg.reasoning_content || '').trim();

  return {
    ok: true,
    jobType: 'npc_think_batch',
    lm_studio: true,
    thought_count: thoughtCount,
    sample_thought: thought.slice(0, 200),
    completed_at: new Date().toISOString(),
  };
}

async function processMeshJob(jobType, payload = {}) {
  const type = String(jobType || '').trim();
  const safePayload = payload && typeof payload === 'object' ? payload : {};

  if (type === 'npc_think_batch') {
    if (await isLmStudioReachable()) {
      try {
        return await runNpcThinkBatch(safePayload);
      } catch (err) {
        console.warn('[mesh-job-runner] npc_think_batch LM Studio error:', err?.message || err);
      }
    }
    return mockMeshJob(type, safePayload);
  }

  if (type === 'embedding_index' || type === 'sim_tick') {
    return mockMeshJob(type, safePayload);
  }

  return mockMeshJob(type, safePayload);
}

module.exports = {
  processMeshJob,
  isLmStudioReachable,
  mockMeshJob,
  LM_STUDIO_URL,
};
