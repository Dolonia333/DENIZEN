'use strict';

function normalizeBaseUrl(raw) {
  return String(raw || '')
    .trim()
    .replace(/\/v1\/?$/i, '')
    .replace(/\/+$/, '');
}

function parseModelList(data) {
  const models = Array.isArray(data?.data) ? data.data : [];
  return models
    .map((m) => (m?.id ? String(m.id) : null))
    .filter(Boolean);
}

/**
 * Probe an LM Studio (OpenAI-compatible) endpoint.
 * @param {string} baseUrl
 * @param {{ apiKey?: string, timeoutMs?: number }} opts
 */
async function probeLmStudioEndpoint(baseUrl, opts = {}) {
  const url = normalizeBaseUrl(baseUrl);
  if (!url) {
    return {
      url: null,
      reachable: false,
      models: [],
      error: 'empty url',
      probed_at: new Date().toISOString(),
    };
  }

  const timeoutMs = Math.max(1000, Number(opts.timeoutMs) || 4000);
  const headers = {};
  const apiKey = opts.apiKey || process.env.LM_STUDIO_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const paths = ['/v1/models', '/api/v0/models'];
  const errors = [];

  for (const path of paths) {
    try {
      const res = await fetch(`${url}${path}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok || res.status === 401 || res.status === 403) {
        let models = [];
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          models = parseModelList(data);
        }
        // Prefer env-pinned models when they appear in the catalog.
        const pickIfLoaded = (id) => {
          if (!id) return null;
          const want = String(id).toLowerCase();
          return models.find((m) => String(m).toLowerCase() === want
            || String(m).toLowerCase().includes(want)
            || want.includes(String(m).toLowerCase())) || null;
        };
        const envMain = process.env.LM_STUDIO_MODEL;
        const envFast = process.env.LM_STUDIO_FAST_MODEL;
        const envHeavy = process.env.LM_STUDIO_HEAVY_MODEL;
        const heavyPick = [
          envHeavy, 'qwen/qwen3.6-27b', 'qwen2.5-14b-instruct-1m',
          'mistralai/ministral-3-14b-reasoning',
        ].map(pickIfLoaded).find(Boolean) || null;
        const mainPick = pickIfLoaded(envMain)
          || heavyPick
          || models.find((m) => /14b|27b|32b|ministral/i.test(m))
          || models[0]
          || null;
        const fastPick = pickIfLoaded(envFast)
          || models.find((m) => /gemma|e2b|3b|1b|mini|8b/i.test(m) && !/14b|27b|32b/i.test(m))
          || models[0]
          || null;
        return {
          url,
          reachable: true,
          models,
          main_model: mainPick,
          fast_model: fastPick,
          heavy_model: heavyPick || mainPick,
          probed_at: new Date().toISOString(),
          probed_path: path,
          http_status: res.status,
        };
      }
      errors.push(`${path}: HTTP ${res.status}`);
    } catch (err) {
      errors.push(`${path}: ${err?.message || String(err)}`);
    }
  }

  return {
    url,
    reachable: false,
    models: [],
    error: errors.join('; ') || 'unreachable',
    probed_at: new Date().toISOString(),
  };
}

module.exports = {
  normalizeBaseUrl,
  probeLmStudioEndpoint,
  parseModelList,
};
