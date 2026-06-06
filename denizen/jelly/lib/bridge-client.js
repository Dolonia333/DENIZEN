'use strict';

/**
 * Shared Supabase secure-bridge client for Jelly data skills.
 */

const orgPolicy = require('../../src/denizen-org-policy');

function bridgeConfig(config = {}) {
  return {
    url: (config?.supabase?.bridgeUrl || process.env.SUPABASE_BRIDGE_URL || 'http://127.0.0.1:18790').replace(/\/$/, ''),
    token: config?.supabase?.agentToken || process.env.AGENT_TOKEN || '',
    orgSlug: config?.orgSlug || config?.supabase?.orgSlug || process.env.DENIZEN_ORG_SLUG || 'zion',
  };
}

async function bridgeRequest(config, path, { method = 'GET', body } = {}) {
  const { url, token, orgSlug } = bridgeConfig(config);
  if (!token) throw new Error('AGENT_TOKEN not set — configure denizen/jelly/services/supabase-bridge/.env.secure');

  if (body?.table && !orgPolicy.isBusinessTableAllowedSync(orgSlug, body.table)) {
    throw new Error(`Table "${body.table}" blocked for org "${orgSlug}" (demo sandbox)`);
  }

  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Org-Slug': orgSlug,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg = data?.error || data?.message || text.slice(0, 200);
    throw new Error(`Bridge ${path} → HTTP ${res.status}: ${msg}`);
  }
  return data;
}

async function bridgeQuery(config, { table, select, filters, order, limit = 20 }) {
  const data = await bridgeRequest(config, '/query', {
    method: 'POST',
    body: { table, select, filters: filters || {}, order: order || {}, limit },
  });
  return data?.rows || data?.data || data || [];
}

async function bridgeInsert(config, { table, rows }) {
  const list = Array.isArray(rows) ? rows : [rows];
  return bridgeRequest(config, '/insert', {
    method: 'POST',
    body: { table, rows: list },
  });
}

async function bridgeUpdate(config, { table, filters, data }) {
  return bridgeRequest(config, '/update', {
    method: 'POST',
    body: { table, filters, data },
  });
}

async function bridgeHealth(config) {
  return bridgeRequest(config, '/health');
}

function fmtRows(rows, max = 8) {
  if (!rows?.length) return 'No rows found.';
  return JSON.stringify(rows.slice(0, max), null, 0).slice(0, 1200);
}

module.exports = {
  bridgeConfig,
  bridgeRequest,
  bridgeQuery,
  bridgeInsert,
  bridgeUpdate,
  bridgeHealth,
  fmtRows,
};
