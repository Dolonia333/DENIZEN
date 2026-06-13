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
        return {
          url,
          reachable: true,
          models,
          main_model: models[0] || null,
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
