/**
 * Browser-side sync client (mirrors apps/office/src/compute/denizen-companion-api.js).
 */
(function (root) {
  'use strict';

  function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || '').replace(/\/$/, '');
  }

  function buildSyncUrls(baseUrl) {
    const base = normalizeBaseUrl(baseUrl);
    return {
      status: `${base}/api/npc-sync/status`,
      memory: `${base}/api/npc-sync/memory`,
      activity: `${base}/api/npc-sync/activity`,
    };
  }

  async function companionFetch(url, { method = 'GET', token, body } = {}) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function getNpcStatus(credentials, limit = 10) {
    const urls = buildSyncUrls(credentials.baseUrl);
    return companionFetch(`${urls.status}?limit=${limit}`, { token: credentials.token });
  }

  async function pushMemory(credentials, text, opts = {}) {
    const body = String(text || '').trim();
    if (!body) throw new Error('memory text required');
    const urls = buildSyncUrls(credentials.baseUrl);
    return companionFetch(urls.memory, {
      method: 'POST',
      token: credentials.token,
      body: { body, topic: opts.topic || null, outcome: opts.outcome || null },
    });
  }

  async function logActivity(credentials, note, opts = {}) {
    const urls = buildSyncUrls(credentials.baseUrl);
    return companionFetch(urls.activity, {
      method: 'POST',
      token: credentials.token,
      body: { note: String(note || '').trim(), phase: opts.phase, action: opts.action },
    });
  }

  root.DenizenSyncClient = {
    getNpcStatus,
    pushMemory,
    logActivity,
    buildSyncUrls,
  };
})(typeof self !== 'undefined' ? self : globalThis);
