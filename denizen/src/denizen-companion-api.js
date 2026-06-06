'use strict';

/**
 * Denizen Companion — REST client for NPC sync (provider-agnostic).
 * Used by the browser extension and unit tests.
 */

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/$/, '');
}

function buildSyncUrls(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  return {
    status: `${base}/api/npc-sync/status`,
    memory: `${base}/api/npc-sync/memory`,
    activity: `${base}/api/npc-sync/activity`,
    openapi: `${base}/api/npc-sync/openapi.json`,
  };
}

function authHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function companionFetch(url, { method = 'GET', token, body, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, {
    method,
    headers: authHeaders(token),
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function getNpcStatus(credentials, { limit = 10, fetchImpl } = {}) {
  const urls = buildSyncUrls(credentials.baseUrl);
  const url = `${urls.status}?limit=${encodeURIComponent(limit)}`;
  return companionFetch(url, { token: credentials.token, fetchImpl });
}

async function pushMemory(credentials, text, { topic, outcome, fetchImpl } = {}) {
  const body = String(text || '').trim();
  if (!body) throw new Error('memory text required');
  const urls = buildSyncUrls(credentials.baseUrl);
  return companionFetch(urls.memory, {
    method: 'POST',
    token: credentials.token,
    body: { body, topic: topic || null, outcome: outcome || null },
    fetchImpl,
  });
}

async function logActivity(credentials, note, { phase, action, fetchImpl } = {}) {
  const urls = buildSyncUrls(credentials.baseUrl);
  return companionFetch(urls.activity, {
    method: 'POST',
    token: credentials.token,
    body: { note: String(note || '').trim(), phase, action },
    fetchImpl,
  });
}

function validateCredentials(creds) {
  if (!creds || typeof creds !== 'object') return 'credentials required';
  if (!creds.baseUrl) return 'baseUrl required';
  if (!creds.token || String(creds.token).length < 16) return 'token required';
  return null;
}

module.exports = {
  normalizeBaseUrl,
  buildSyncUrls,
  authHeaders,
  companionFetch,
  getNpcStatus,
  pushMemory,
  logActivity,
  validateCredentials,
};
