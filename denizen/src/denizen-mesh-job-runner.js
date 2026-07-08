'use strict';

const inferenceRuntime = require('./denizen-inference-runtime');
const { runEmbeddingIndex } = require('./denizen-embedding-worker');
const { runSimTick } = require('./denizen-sim-tick');
const { runNodePatrol } = require('./denizen-bouncer-mesh-patrol');
const { spawn } = require('node:child_process');
const path = require('node:path');

function vendorWebSearchScript() {
  try {
    const p = require('../jelly/paths').vendorScriptPath('web-search');
    return p || null;
  } catch (_) {
    return null;
  }
}

async function runWebSearchJob(payload = {}) {
  const query = String(payload.query || payload.q || '').trim();
  if (!query) {
    return { ok: false, jobType: 'web_search', error: 'query required', completed_at: new Date().toISOString() };
  }
  const script = vendorWebSearchScript();
  if (!script) {
    return { ok: false, jobType: 'web_search', error: 'web-search.mjs not found', completed_at: new Date().toISOString() };
  }

  const headless = payload.headless === true ? 'true' : 'false';
  const lingerMs = Number(process.env.LUCY_SEARCH_LINGER_MS || 120_000);

  return new Promise((resolve) => {
    const args = ['--query', query, '--headless', headless, '--linger-ms', String(lingerMs)];
    const proc = spawn(process.execPath, [script, ...args], {
      cwd: path.dirname(script),
      env: { ...process.env, LUCY_BROWSER_MODE: process.env.LUCY_BROWSER_MODE || 'auto' },
      windowsHide: false,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (c) => { stdout += c; });
    proc.stderr?.on('data', (c) => { stderr += c; });
    proc.on('error', (err) => {
      resolve({
        ok: false,
        jobType: 'web_search',
        error: err.message,
        completed_at: new Date().toISOString(),
      });
    });
    proc.on('close', (code) => {
      let parsed = null;
      try {
        const line = stdout.trim().split('\n').filter(Boolean).pop();
        parsed = line ? JSON.parse(line) : null;
      } catch (_) {}
      const summary = parsed?.summary || parsed?.error || stderr.slice(0, 400) || stdout.slice(0, 400);
      resolve({
        ok: code === 0 && parsed?.success !== false,
        jobType: 'web_search',
        query,
        summary: summary || 'Browser search finished.',
        output: summary,
        parsed,
        completed_at: new Date().toISOString(),
      });
    });
  });
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
    kind: 'idle',
    systemPrompt: 'You simulate brief NPC thoughts in a virtual office. Reply with one short sentence only.',
    messages: [{
      role: 'user',
      content: `NPCs: ${npcLabel}. One ambient thought (max 20 words).`,
    }],
    max_tokens: 48,
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

  if (type === 'grok_cli_chat') {
    const grokCli = require('./grok-cli-chat');
    try {
      const messages = Array.isArray(safePayload.messages) ? safePayload.messages : [];
      const text = await grokCli.completePlayerChat({
        systemPrompt: safePayload.system_prompt || safePayload.systemPrompt || '',
        messages,
        prefer: 'local',
        timeoutMs: safePayload.timeout_ms || safePayload.timeoutMs,
        priority: safePayload.priority,
      });
      return {
        ok: true,
        jobType: 'grok_cli_chat',
        text,
        completed_at: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        jobType: 'grok_cli_chat',
        error: err?.message || String(err),
        completed_at: new Date().toISOString(),
      };
    }
  }

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
          kind: safePayload.kind || safePayload.task_kind || 'chat',
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

  if (type === 'web_search') {
    try {
      return await runWebSearchJob(safePayload);
    } catch (err) {
      return {
        ok: false,
        jobType: 'web_search',
        error: err?.message || String(err),
        completed_at: new Date().toISOString(),
      };
    }
  }

  if (type === 'bouncer_patrol') {
    try {
      const nodeInfo = safePayload.node && typeof safePayload.node === 'object'
        ? { ...safePayload.node, ...safePayload }
        : safePayload;
      const patrol = await runNodePatrol(nodeInfo);
      return {
        ...patrol,
        jobType: 'bouncer_patrol',
        completed_at: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        jobType: 'bouncer_patrol',
        error: err?.message || String(err),
        completed_at: new Date().toISOString(),
      };
    }
  }

  return mockMeshJob(type, safePayload);
}

module.exports = {
  processMeshJob,
  isInferenceReachable,
  mockMeshJob,
  LM_STUDIO_URL: inferenceRuntime.defaultLmStudioUrl(),
};
