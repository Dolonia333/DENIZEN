'use strict';

const inferenceRuntime = require('./denizen-inference-runtime');
const { runEmbeddingIndex } = require('./denizen-embedding-worker');
const { runSimTick } = require('./denizen-sim-tick');

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

  return {
    ok: false,
    jobType: type || 'unknown',
    mocked: true,
    error: `Unsupported local job type: ${type || 'unknown'}`,
    completed_at: new Date().toISOString(),
  };
}

async function isInferenceReachable() {
  const probe = await inferenceRuntime.probeInferenceRuntime({ timeoutMs: 4000 });
  return !!probe.reachable;
}

async function runNpcThinkBatch(payload = {}) {
  const npcIds = Array.isArray(payload.npc_ids) ? payload.npc_ids : [];
  const thoughtCount = npcIds.length || 1;
  const npcLabel = npcIds.slice(0, 8).join(', ') || 'office worker';

  const result = await inferenceRuntime.chatCompletion({
    tier: 'fast',
    systemPrompt: 'You simulate brief NPC thoughts in a virtual office. Reply with one short sentence only.',
    messages: [{
      role: 'user',
      content: `NPCs: ${npcLabel}. One ambient thought (max 20 words).`,
    }],
    max_tokens: 48,
    temperature: 0.75,
    timeoutMs: 60_000,
  });

  return {
    ok: true,
    jobType: 'npc_think_batch',
    inference: true,
    backend: result.backend,
    thought_count: thoughtCount,
    sample_thought: result.text.slice(0, 200),
    completed_at: new Date().toISOString(),
  };
}

async function processMeshJob(jobType, payload = {}, ctx = {}) {
  const type = String(jobType || '').trim();
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const onProgress = typeof ctx.onProgress === 'function' ? ctx.onProgress : null;

  if (type === 'inference_rpc') {
    if (await isInferenceReachable()) {
      try {
        const result = await inferenceRuntime.chatCompletion({
          tier: safePayload.tier === 'fast' ? 'fast' : 'main',
          model: safePayload.model || null,
          systemPrompt: safePayload.system_prompt || safePayload.systemPrompt || '',
          messages: Array.isArray(safePayload.messages) ? safePayload.messages : [],
          max_tokens: safePayload.max_tokens ?? safePayload.maxTokens,
          temperature: safePayload.temperature,
          onToken: onProgress
            ? (delta) => onProgress({ delta, partial: true })
            : null,
        });
        return {
          ok: true,
          jobType: 'inference_rpc',
          text: result.text,
          model: result.model,
          backend: result.backend,
          completed_at: new Date().toISOString(),
        };
      } catch (err) {
        console.warn('[mesh-job-runner] inference_rpc error:', err?.message || err);
        return {
          ok: false,
          jobType: type,
          error: err?.message || String(err),
          completed_at: new Date().toISOString(),
        };
      }
    }
    return {
      ok: false,
      jobType: type,
      error: 'No local inference runtime reachable',
      completed_at: new Date().toISOString(),
    };
  }

  if (type === 'embedding_index') {
    if (await isInferenceReachable()) {
      try {
        return await runEmbeddingIndex(safePayload);
      } catch (err) {
        console.warn('[mesh-job-runner] embedding_index error:', err?.message || err);
      }
    }
    return mockMeshJob(type, safePayload);
  }

  if (type === 'sim_tick') {
    return runSimTick(safePayload);
  }

  if (type === 'npc_think_batch') {
    if (await isInferenceReachable()) {
      try {
        return await runNpcThinkBatch(safePayload);
      } catch (err) {
        console.warn('[mesh-job-runner] npc_think_batch inference error:', err?.message || err);
      }
    }
    return mockMeshJob(type, safePayload);
  }

  return mockMeshJob(type, safePayload);
}

module.exports = {
  processMeshJob,
  isInferenceReachable,
  mockMeshJob,
  LM_STUDIO_URL: inferenceRuntime.defaultLmStudioUrl(),
};
