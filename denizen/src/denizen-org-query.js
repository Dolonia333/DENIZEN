'use strict';

/**
 * Org-aware query layer — insulate callers from raw DenizenOrganizations /
 * org_id filter construction across 18+ tables.
 */

const denizenDb = require('./denizen-db.js');

function encode(value) {
  return encodeURIComponent(String(value ?? ''));
}

function requireOrgId(orgId) {
  const id = String(orgId || '').trim();
  if (!id) throw new Error('org_id required');
  return id;
}

function orgFilter(orgId) {
  return `org_id=eq.${encode(requireOrgId(orgId))}`;
}

async function getOrganization(orgId) {
  const id = requireOrgId(orgId);
  const rows = await denizenDb._get(
    `denizen_organizations?select=*&id=eq.${encode(id)}&limit=1`,
  ).catch(() => []);
  return rows?.[0] || null;
}

async function getOrganizationBySlug(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!s) return null;
  const rows = await denizenDb._get(
    `denizen_organizations?select=*&slug=eq.${encode(s)}&limit=1`,
  ).catch(() => []);
  return rows?.[0] || null;
}

async function listOrgRows(table, orgId, {
  select = '*',
  extra = '',
  order = '',
  limit = null,
} = {}) {
  const parts = [
    `${String(table).replace(/[^a-z0-9_]/gi, '')}?select=${select}`,
    orgFilter(orgId),
  ];
  if (extra) parts.push(String(extra).replace(/^\?/, '').replace(/^&/, ''));
  if (order) parts.push(`order=${order}`);
  if (limit != null) parts.push(`limit=${Number(limit) || 50}`);
  const path = parts[0] + '&' + parts.slice(1).join('&');
  return denizenDb._get(path).catch(() => []);
}

async function insertOrgRow(table, orgId, row = {}) {
  const body = { ...row, org_id: requireOrgId(orgId) };
  return denizenDb._post(
    String(table).replace(/[^a-z0-9_]/gi, ''),
    body,
    { prefer: 'return=representation' },
  );
}

module.exports = {
  orgFilter,
  requireOrgId,
  getOrganization,
  getOrganizationBySlug,
  listOrgRows,
  insertOrgRow,
};
