'use strict';

const { normalizeBaseUrl, probeLmStudioEndpoint, parseModelList } = require('../integrations/lm-studio-probe');

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_LM_URL = 'http://127.0.0.1:1234';
const DEFAULT_LLAMACPP_URL = 'http://127.0.0.1:8081';

function resolveBackendPreference(env = process.env) {
  const explicit = String(env.DENIZEN_INFERENCE_BACKEND || '').trim().toLowerCase();
  if (explicit === 'ollama' || explicit === 'lmstudio' || explicit === 'llamacpp') return explicit;
  return 'auto';
}

function defaultOllamaUrl(env = process.env) {
  return normalizeBaseUrl(env.OLLAMA_URL || env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL);
}

function defaultLmStudioUrl(env = process.env) {
  return normalizeBaseUrl(
    env.LM_STUDIO_URL
    || env.LM_STUDIO_BASE_URL
    || DEFAULT_LM_URL,
  );
}

function defaultLlamaCppUrl(env = process.env) {
  return normalizeBaseUrl(
    env.LLAMACPP_URL
    || env.LLAMA_SERVER_URL
    || env.LLAMACPP_BASE_URL
    || DEFAULT_LLAMACPP_URL,
  );
}

function parseOllamaTags(data) {
  const models = Array.isArray(data?.models) ? data.models : [];
  return models
    .map((m) => (m?.name ? String(m.name) : null))
    .filter(Boolean);
}

/**
 * Probe an Ollama endpoint (OpenAI-compatible + native tags API).
 */
async function probeOllamaEndpoint(baseUrl, opts = {}) {
  const url = normalizeBaseUrl(baseUrl);
  if (!url) {
    return {
      backend: 'ollama',
      url: null,
      reachable: false,
      models: [],
      error: 'empty url',
      probed_at: new Date().toISOString(),
    };
  }

  const timeoutMs = Math.max(1000, Number(opts.timeoutMs) || 4000);
  const errors = [];

  for (const path of ['/v1/models', '/api/tags']) {
    try {
      const res = await fetch(`${url}${path}`, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        errors.push(`${path}: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json().catch(() => ({}));
      const models = path === '/api/tags'
        ? parseOllamaTags(data)
        : parseModelList(data);
      return {
        backend: 'ollama',
        url,
        reachable: true,
        models,
        main_model: models[0] || null,
        fast_model: models[0] || null,
        probed_at: new Date().toISOString(),
        probed_path: path,
        http_status: res.status,
      };
    } catch (err) {
      errors.push(`${path}: ${err?.message || String(err)}`);
    }
  }

  return {
    backend: 'ollama',
    url,
    reachable: false,
    models: [],
    error: errors.join('; ') || 'unreachable',
    probed_at: new Date().toISOString(),
  };
}

/**
 * Probe configured backends and return the best active runtime.
 */
async function probeInferenceRuntime(opts = {}) {
  const env = opts.env || process.env;
  const preference = opts.backend || resolveBackendPreference(env);
  const probes = [];

  if (preference === 'ollama' || preference === 'auto') {
    probes.push(await probeOllamaEndpoint(
      opts.ollamaUrl || defaultOllamaUrl(env),
      opts,
    ));
  }
  if (preference === 'lmstudio' || preference === 'auto') {
    probes.push(await probeLmStudioEndpoint(
      opts.lmStudioUrl || defaultLmStudioUrl(env),
      {
        apiKey: opts.apiKey || env.LM_STUDIO_API_KEY,
        timeoutMs: opts.timeoutMs,
      },
    ).then((probe) => ({ ...probe, backend: 'lmstudio' })));
  }
  if (preference === 'llamacpp' || preference === 'auto') {
    probes.push(await probeLmStudioEndpoint(
      opts.llamaCppUrl || defaultLlamaCppUrl(env),
      { timeoutMs: opts.timeoutMs },
    ).then((probe) => ({ ...probe, backend: 'llamacpp' })));
  }

  const reachable = probes.filter((p) => p.reachable);
  if (!reachable.length) {
    return {
      backend: null,
      url: null,
      reachable: false,
      models: [],
      probes,
      probed_at: new Date().toISOString(),
    };
  }

  let pick = null;
  if (preference === 'ollama' || preference === 'lmstudio' || preference === 'llamacpp') {
    pick = reachable.find((p) => p.backend === preference) || reachable[0];
  } else {
    pick = reachable.find((p) => p.backend === 'lmstudio')
      || reachable.find((p) => p.backend === 'ollama')
      || reachable.find((p) => p.backend === 'llamacpp')
      || reachable[0];
  }

  return {
    ...pick,
    probes,
    rpc_capable: true,
    reachable_local: true,
  };
}

async function resolveRuntimeModel(runtime, tier = 'main', pinnedModel = null) {
  if (pinnedModel) return pinnedModel;
  const env = process.env;
  if (tier === 'fast') {
    return runtime.fast_model
      || env.LM_STUDIO_FAST_MODEL
      || env.OLLAMA_MODEL
      || runtime.main_model
      || env.LM_STUDIO_MODEL
      || (runtime.models || [])[0]
      || null;
  }
  return runtime.main_model
    || env.LM_STUDIO_MODEL
    || env.OLLAMA_MODEL
    || (runtime.models || [])[0]
    || null;
}

function buildChatMessages(systemPrompt, messages = []) {
  const oai = [];
  if (systemPrompt) oai.push({ role: 'system', content: systemPrompt });
  for (const m of messages) {
    if (!m || !m.content) continue;
    oai.push({ role: m.role || 'user', content: String(m.content) });
  }
  if (!oai.some((m) => m.role === 'user')) {
    oai.push({ role: 'user', content: 'Hello.' });
  }
  return oai;
}

function extractChatText(data) {
  const msg = data?.choices?.[0]?.message || {};
  return String(msg.content || msg.reasoning_content || '').trim();
}

/**
 * Run a chat completion against LM Studio or Ollama (OpenAI-compatible API).
 */
async function chatCompletion(opts = {}) {
  const runtime = opts.runtime || await probeInferenceRuntime({
    backend: opts.backend,
    ollamaUrl: opts.ollamaUrl,
    lmStudioUrl: opts.lmStudioUrl || opts.baseUrl,
    apiKey: opts.apiKey,
    timeoutMs: opts.probeTimeoutMs,
  });

  if (!runtime?.reachable || !runtime.url) {
    throw new Error('No inference runtime reachable');
  }

  const model = opts.model
    || await resolveRuntimeModel(runtime, opts.tier, opts.pinnedModel);
  if (!model) throw new Error('No inference model available');

  const base = normalizeBaseUrl(runtime.url);
  const stream = typeof opts.onToken === 'function';
  const body = {
    model,
    messages: buildChatMessages(opts.systemPrompt, opts.messages),
    max_tokens: Math.max(1, Number(opts.max_tokens ?? opts.maxTokens) || 256),
    temperature: Number(opts.temperature ?? 0.75),
    stream,
  };

  if (runtime.backend === 'lmstudio') {
    body.enable_thinking = false;
  }

  const headers = { 'Content-Type': 'application/json' };
  const apiKey = opts.apiKey || process.env.LM_STUDIO_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const timeoutMs = Math.max(5000, Number(opts.timeoutMs) || 120_000);

  if (stream) {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Inference chat failed (${res.status})${detail ? `: ${detail.slice(0, 160)}` : ''}`,
      );
    }
    const reader = res.body?.getReader?.();
    if (!reader) {
      const data = await res.json();
      const text = extractChatText(data);
      if (text) opts.onToken(text);
      return { ok: true, text, model, backend: runtime.backend, url: base, usage: data.usage || null, raw: data };
    }
    const decoder = new TextDecoder();
    let full = '';
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed?.choices?.[0]?.delta?.content || '';
          if (delta) {
            full += delta;
            opts.onToken(delta);
          }
        } catch (_) {}
      }
    }
    const text = full.trim();
    if (!text) throw new Error('Empty inference stream');
    return { ok: true, text, model, backend: runtime.backend, url: base, usage: null, raw: null };
  }

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `Inference chat failed (${res.status})${detail ? `: ${detail.slice(0, 160)}` : ''}`,
    );
  }

  const data = await res.json();
  const text = extractChatText(data);
  if (!text) throw new Error('Empty inference response');

  return {
    ok: true,
    text,
    model,
    backend: runtime.backend,
    url: base,
    usage: data.usage || null,
    raw: data,
  };
}

function buildInferenceBlockFromProbe(probe, extra = {}) {
  if (!probe || typeof probe !== 'object') return null;
  const localUrl = normalizeBaseUrl(probe.url || probe.local_url);
  return {
    backend: probe.backend || resolveBackendPreference(),
    url: localUrl,
    local_url: localUrl,
    reachable: !!probe.reachable,
    reachable_local: probe.reachable_local != null ? !!probe.reachable_local : !!probe.reachable,
    rpc_capable: probe.rpc_capable != null
      ? !!probe.rpc_capable
      : !!probe.reachable,
    models: Array.isArray(probe.models) ? probe.models : [],
    main_model: probe.main_model || null,
    fast_model: probe.fast_model || probe.main_model || null,
    probed_at: probe.probed_at || new Date().toISOString(),
    advertise_url: extra.advertise_url || probe.advertise_url || null,
    network_reachable: extra.network_reachable != null
      ? !!extra.network_reachable
      : null,
  };
}

async function runInferenceRpcJob(payload = {}) {
  const safe = payload && typeof payload === 'object' ? payload : {};
  const result = await chatCompletion({
    tier: safe.tier === 'fast' ? 'fast' : 'main',
    model: safe.model || null,
    systemPrompt: safe.system_prompt || safe.systemPrompt || '',
    messages: Array.isArray(safe.messages) ? safe.messages : [],
    max_tokens: safe.max_tokens ?? safe.maxTokens,
    temperature: safe.temperature,
  });
  return {
    ok: true,
    jobType: 'inference_rpc',
    text: result.text,
    model: result.model,
    backend: result.backend,
    completed_at: new Date().toISOString(),
  };
}

module.exports = {
  resolveBackendPreference,
  defaultOllamaUrl,
  defaultLmStudioUrl,
  defaultLlamaCppUrl,
  probeOllamaEndpoint,
  probeInferenceRuntime,
  resolveRuntimeModel,
  chatCompletion,
  runInferenceRpcJob,
  buildChatMessages,
  extractChatText,
  buildInferenceBlockFromProbe,
};
