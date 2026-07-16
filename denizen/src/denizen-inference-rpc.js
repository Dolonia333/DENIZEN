'use strict';

const computeQueue = require('./denizen-compute-queue');
const inferenceRuntime = require('./denizen-inference-runtime');
const inferenceMetrics = require('./denizen-inference-metrics');
const inferenceProgress = require('./denizen-inference-progress');

const DEFAULT_RPC_TIMEOUT_MS = Number(process.env.DENIZEN_INFERENCE_RPC_TIMEOUT_MS) || 120_000;

function isQueueEnabled() {
  return typeof computeQueue.isEnabled === 'function' && computeQueue.isEnabled();
}

async function waitForJobWithProgress(jobId, opts = {}) {
  const timeoutMs = Math.max(5000, Number(opts.timeoutMs) || DEFAULT_RPC_TIMEOUT_MS);
  const pollMs = Math.max(100, Number(opts.pollMs) || 350);
  const deadline = Date.now() + timeoutMs;
  const onToken = typeof opts.onToken === 'function' ? opts.onToken : null;
  let lastLen = 0;

  while (Date.now() < deadline) {
    if (onToken) {
      const partial = inferenceProgress.getProgress(jobId);
      if (partial?.text && partial.text.length > lastLen) {
        onToken(partial.text.slice(lastLen));
        lastLen = partial.text.length;
      }
      if (partial?.done && partial.text) {
        const job = await computeQueue.getJobById(jobId);
        if (job) return job;
      }
    }

    const job = await computeQueue.getJobById(jobId);
    if (!job) return null;
    if (job.status === 'done' || job.status === 'failed') {
      inferenceProgress.markDone(jobId, job.result?.text || job.result?.content || '');
      return job;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  return computeQueue.getJobById(jobId);
}

/**
 * Enqueue an inference_rpc job targeted at a mesh node and wait for completion.
 */
async function runMeshInference(opts = {}) {
  if (!isQueueEnabled()) {
    throw new Error('Compute queue disabled — cannot run Denizen-to-Denizen inference');
  }

  const targetMachineId = String(
    opts.targetMachineId
    || opts.target_machine_id
    || opts.nodeId
    || opts.node_id
    || '',
  ).trim();
  if (!targetMachineId) {
    throw new Error('targetMachineId is required for mesh inference');
  }

  const started = Date.now();
  const messages = Array.isArray(opts.messages) ? opts.messages : [];
  const job = await computeQueue.enqueueJob({
    jobType: 'inference_rpc',
    payload: {
      target_machine_id: targetMachineId,
      system_prompt: opts.systemPrompt || opts.system_prompt || '',
      messages,
      model: opts.model || null,
      tier: opts.tier === 'fast' ? 'fast' : 'main',
      max_tokens: Number(opts.max_tokens ?? opts.maxTokens) || 256,
      temperature: Number(opts.temperature ?? 0.75),
      kind: opts.kind || opts.task_kind || 'chat',
      source: opts.source || 'inference_rpc',
      stream: !!opts.onToken,
    },
    priority: opts.priority === 'high' ? 92 : 75,
  });

  if (!job?.id) throw new Error('Failed to enqueue inference_rpc job');

  const timeoutMs = Math.max(5000, Number(opts.timeoutMs) || DEFAULT_RPC_TIMEOUT_MS);
  const completed = await waitForJobWithProgress(job.id, {
    timeoutMs,
    onToken: opts.onToken,
  });
  if (!completed) {
    inferenceMetrics.recordInferenceResult('rpc', false);
    throw new Error('Inference RPC timed out');
  }

  if (completed.status === 'failed') {
    inferenceMetrics.recordInferenceResult('rpc', false);
    throw new Error(completed.error || 'Inference RPC job failed');
  }

  const result = completed.result && typeof completed.result === 'object'
    ? completed.result
    : {};
  const text = String(result.text || result.content || '').trim();
  if (!text) {
    inferenceMetrics.recordInferenceResult('rpc', false);
    throw new Error('Inference RPC returned empty text');
  }

  inferenceMetrics.recordInferenceResult('rpc', true, Date.now() - started);
  return {
    ok: true,
    text,
    model: result.model || null,
    backend: result.backend || null,
    job_id: job.id,
    node_id: completed.assigned_node_id || null,
    mode: 'mesh_rpc',
  };
}

/**
 * Direct HTTP inference (LM Studio / Ollama on reachable URL).
 */
async function runDirectInference(opts = {}) {
  const started = Date.now();
  try {
    let result = null;
    let mode = 'direct';
    try {
      const { getActiveHarness } = require('./denizen-harness');
      const harness = getActiveHarness?.();
      if (harness?.complete && !opts.onToken) {
        result = await harness.complete({
          backend: opts.backend,
          baseUrl: opts.baseUrl || opts.url,
          model: opts.model,
          tier: opts.tier === 'fast' ? 'fast' : (opts.tier === 'heavy' || opts.tier === 'reasoning' ? 'heavy' : 'main'),
          systemPrompt: opts.systemPrompt || opts.system_prompt,
          messages: opts.messages,
          max_tokens: opts.max_tokens ?? opts.maxTokens,
          temperature: opts.temperature,
          kind: opts.kind || opts.task_kind || 'chat',
          apiKey: opts.apiKey,
          timeoutMs: opts.timeoutMs,
          enableThinking: opts.enableThinking === true || opts.reasoning === true,
        });
        mode = 'harness';
      }
    } catch (_) { /* fall through to runtime */ }

    if (!result) {
      result = await inferenceRuntime.chatCompletion({
        backend: opts.backend,
        baseUrl: opts.baseUrl || opts.url,
        lmStudioUrl: opts.baseUrl || opts.url,
        model: opts.model,
        tier: opts.tier,
        systemPrompt: opts.systemPrompt || opts.system_prompt,
        messages: opts.messages,
        max_tokens: opts.max_tokens ?? opts.maxTokens,
        temperature: opts.temperature,
        kind: opts.kind || opts.task_kind || 'chat',
        apiKey: opts.apiKey,
        timeoutMs: opts.timeoutMs,
        onToken: opts.onToken,
      });
    }
    inferenceMetrics.recordInferenceResult(mode === 'harness' ? 'harness' : 'direct', true, Date.now() - started);
    return {
      ok: true,
      text: result.text,
      model: result.model,
      backend: result.backend,
      mode,
    };
  } catch (err) {
    inferenceMetrics.recordInferenceResult('direct', false);
    throw err;
  }
}

/**
 * Pick mesh RPC or direct HTTP based on router hints.
 */
async function runInference(opts = {}) {
  const mode = String(opts.mode || opts._inferenceMode || 'auto').toLowerCase();
  if (mode === 'rpc' || mode === 'mesh') {
    return runMeshInference(opts);
  }
  if (mode === 'direct') {
    return runDirectInference(opts);
  }

  if (opts.rpc_capable && opts.network_reachable === false) {
    return runMeshInference(opts);
  }

  try {
    return await runDirectInference(opts);
  } catch (err) {
    if (opts.rpc_capable && isQueueEnabled()) {
      return runMeshInference(opts);
    }
    throw err;
  }
}

async function runInferenceRpcJob(payload = {}) {
  return inferenceRuntime.runInferenceRpcJob(payload);
}

module.exports = {
  runInference,
  runDirectInference,
  runMeshInference,
  runInferenceRpcJob,
  isQueueEnabled,
  waitForJobWithProgress,
};
