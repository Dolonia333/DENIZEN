'use strict';

/**
 * Shared Supabase client for Jelly data skills.
 * Desktop dev: local secure-bridge.py (AGENT_TOKEN + port 18790).
 * NAS / Docker production: direct PostgREST when SUPABASE_SERVICE_ROLE_KEY is set.
 */

const orgPolicy = require('../../src/denizen-org-policy');

const FILTER_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in']);

function bridgeConfig(config = {}) {
  return {
    url: (config?.supabase?.bridgeUrl || process.env.SUPABASE_BRIDGE_URL || 'http://127.0.0.1:18790').replace(/\/$/, ''),
    token: config?.supabase?.agentToken || process.env.AGENT_TOKEN || '',
    orgSlug: config?.orgSlug || config?.supabase?.orgSlug || process.env.DENIZEN_ORG_SLUG || 'zion',
  };
}

function directSupabaseConfig() {
  if (/^(1|true|yes)$/i.test(String(process.env.DENIZEN_SUPABASE_BRIDGE_ONLY || ''))) return null;
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) return null;
  return { url, key };
}

function useDirectSupabase() {
  return !!directSupabaseConfig();
}

function directHeaders(key, { prefer } = {}) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

function assertTableAllowed(orgSlug, table) {
  if (table && !orgPolicy.isBusinessTableAllowedSync(orgSlug, table)) {
    throw new Error(`Table "${table}" blocked for org "${orgSlug}" (demo sandbox)`);
  }
}

function buildSelectParam(select) {
  if (!select) return 'select=*';
  if (Array.isArray(select)) return `select=${select.join(',')}`;
  return `select=${String(select)}`;
}

function buildFilterParams(filters = {}) {
  const params = [];
  for (const [col, ops] of Object.entries(filters || {})) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col) || typeof ops !== 'object') continue;
    for (const [op, val] of Object.entries(ops)) {
      if (!FILTER_OPS.has(op)) continue;
      let v = val;
      if (op === 'in' && Array.isArray(val)) v = `(${val.join(',')})`;
      params.push(`${col}=${op}.${v}`);
    }
  }
  return params;
}

async function directHealth(cfg) {
  const res = await fetch(`${cfg.url}/rest/v1/`, {
    headers: directHeaders(cfg.key),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`PostgREST health HTTP ${res.status}`);
  return { ok: true, mode: 'direct' };
}

async function directQuery(cfg, orgSlug, { table, select, filters, order, limit = 20 }) {
  assertTableAllowed(orgSlug, table);
  const params = [
    buildSelectParam(select),
    `limit=${Math.min(Math.max(Number(limit) || 20, 1), 1000)}`,
    ...buildFilterParams(filters),
  ];
  if (order && typeof order === 'object') {
    for (const [col, dir] of Object.entries(order)) {
      params.push(`order=${col}.${dir === 'desc' ? 'desc' : 'asc'}`);
    }
  }
  const res = await fetch(`${cfg.url}/rest/v1/${table}?${params.join('&')}`, {
    headers: directHeaders(cfg.key),
    signal: AbortSignal.timeout(12000),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.message || data?.error || text.slice(0, 200);
    throw new Error(`Query ${table} → HTTP ${res.status}: ${msg}`);
  }
  return Array.isArray(data) ? data : (data?.rows || data?.data || []);
}

async function directInsert(cfg, orgSlug, { table, rows }) {
  assertTableAllowed(orgSlug, table);
  const list = Array.isArray(rows) ? rows : [rows];
  const res = await fetch(`${cfg.url}/rest/v1/${table}`, {
    method: 'POST',
    headers: directHeaders(cfg.key, { prefer: 'return=representation' }),
    body: JSON.stringify(list),
    signal: AbortSignal.timeout(12000),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.message || data?.error || text.slice(0, 200);
    throw new Error(`Insert ${table} → HTTP ${res.status}: ${msg}`);
  }
  return { data, count: Array.isArray(data) ? data.length : 0 };
}

async function directUpdate(cfg, orgSlug, { table, filters, data }) {
  assertTableAllowed(orgSlug, table);
  const params = buildFilterParams(filters);
  if (!params.length) throw new Error('UPDATE requires at least one filter');
  const res = await fetch(`${cfg.url}/rest/v1/${table}?${params.join('&')}`, {
    method: 'PATCH',
    headers: directHeaders(cfg.key, { prefer: 'return=representation' }),
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(12000),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!res.ok) {
    const msg = parsed?.message || parsed?.error || text.slice(0, 200);
    throw new Error(`Update ${table} → HTTP ${res.status}: ${msg}`);
  }
  return { data: parsed, count: Array.isArray(parsed) ? parsed.length : 0 };
}

async function bridgeRequest(config, path, { method = 'GET', body } = {}) {
  const { url, token, orgSlug } = bridgeConfig(config);
  if (!token) throw new Error('AGENT_TOKEN not set — configure denizen/jelly/services/supabase-bridge/.env.secure');

  if (body?.table) assertTableAllowed(orgSlug, body.table);

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
  const direct = directSupabaseConfig();
  if (direct) {
    return directQuery(direct, bridgeConfig(config).orgSlug, { table, select, filters, order, limit });
  }
  const data = await bridgeRequest(config, '/query', {
    method: 'POST',
    body: { table, select, filters: filters || {}, order: order || {}, limit },
  });
  return data?.rows || data?.data || data || [];
}

async function bridgeInsert(config, { table, rows }) {
  const direct = directSupabaseConfig();
  if (direct) {
    return directInsert(direct, bridgeConfig(config).orgSlug, { table, rows });
  }
  const list = Array.isArray(rows) ? rows : [rows];
  return bridgeRequest(config, '/insert', {
    method: 'POST',
    body: { table, rows: list },
  });
}

async function bridgeUpdate(config, { table, filters, data }) {
  const direct = directSupabaseConfig();
  if (direct) {
    return directUpdate(direct, bridgeConfig(config).orgSlug, { table, filters, data });
  }
  return bridgeRequest(config, '/update', {
    method: 'POST',
    body: { table, filters, data },
  });
}

async function bridgeHealth(config) {
  const direct = directSupabaseConfig();
  if (direct) return directHealth(direct);
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
  useDirectSupabase,
  fmtRows,
};
