'use strict';

/**
 * Org policy — sandbox flags from denizen_organizations.settings.
 * Demo orgs (e.g. acme) cannot query business CRM/RFP tables.
 */

const denizenDb = require('./denizen-db');

const DEFAULT_POLICY = {
  tier: 'team',
  allow_business_data: true,
  allow_real_work: true,
  allow_ceo_handoff: true,
  demo: false,
};

const BUSINESS_TABLES = new Set([
  'intake_forms',
  'leads',
  'clients',
  'rfps',
  'rfp_documents',
  'rfp_requirements',
  'proposal_outlines',
  'past_performance',
  'workflow_runs',
  'rfp_comments',
  'denizen_intake_funnel',
  'denizen_rfp_velocity',
]);

const BUSINESS_ACTIONS = new Set([
  'intake-triage',
  'lead-monitor',
  'rfp-status',
  'client-lookup',
  'rfp-requirement-review',
  'proposal-outline',
  'past-performance-match',
  'intake-to-client',
]);

const _cache = new Map();
const CACHE_TTL_MS = 60_000;

function mergePolicy(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const tier = s.tier || DEFAULT_POLICY.tier;
  const isDemo = s.demo === true || tier === 'demo';
  return {
    tier,
    allow_business_data: isDemo ? false : s.allow_business_data !== false,
    allow_real_work: isDemo ? false : s.allow_real_work !== false,
    allow_ceo_handoff: isDemo ? false : s.allow_ceo_handoff !== false,
    demo: isDemo,
  };
}

function fallbackPolicy(orgSlug) {
  const slug = String(orgSlug || 'zion').trim().toLowerCase();
  if (slug === 'acme') {
    return {
      tier: 'demo',
      allow_business_data: false,
      allow_real_work: false,
      allow_ceo_handoff: false,
      demo: true,
    };
  }
  return { ...DEFAULT_POLICY };
}

async function getOrgPolicy(orgSlug) {
  const slug = String(orgSlug || denizenDb.orgSlug || 'zion').trim().toLowerCase();
  const cached = _cache.get(slug);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.policy;
  }

  if (!denizenDb.enabled) {
    return fallbackPolicy(slug);
  }

  try {
    const rows = await denizenDb._get(
      `denizen_organizations?select=slug,settings&slug=eq.${encodeURIComponent(slug)}&limit=1`,
    );
    const policy = mergePolicy(rows?.[0]?.settings);
    _cache.set(slug, { policy, fetchedAt: Date.now() });
    return policy;
  } catch (_) {
    return fallbackPolicy(slug);
  }
}

function clearOrgPolicyCache(orgSlug) {
  if (orgSlug) {
    _cache.delete(String(orgSlug).trim().toLowerCase());
    return;
  }
  _cache.clear();
}

async function isBusinessTableAllowed(orgSlug, tableName) {
  if (!tableName || !BUSINESS_TABLES.has(tableName)) return true;
  const policy = await getOrgPolicy(orgSlug);
  return policy.allow_business_data !== false;
}

function isBusinessTableAllowedSync(orgSlug, tableName) {
  if (!tableName || !BUSINESS_TABLES.has(tableName)) return true;
  const slug = String(orgSlug || denizenDb.orgSlug || 'zion').trim().toLowerCase();
  const cached = _cache.get(slug);
  if (cached) return cached.policy.allow_business_data !== false;
  return slug !== 'acme';
}

async function assertBusinessActionAllowed(orgSlug, action) {
  if (!BUSINESS_ACTIONS.has(action)) return;
  const policy = await getOrgPolicy(orgSlug);
  if (!policy.allow_business_data) {
    const err = new Error(`Business data access disabled for org "${orgSlug || 'unknown'}" (tier=${policy.tier})`);
    err.code = 'ORG_POLICY_DENIED';
    throw err;
  }
}

module.exports = {
  DEFAULT_POLICY,
  BUSINESS_TABLES,
  BUSINESS_ACTIONS,
  getOrgPolicy,
  clearOrgPolicyCache,
  isBusinessTableAllowed,
  isBusinessTableAllowedSync,
  assertBusinessActionAllowed,
  mergePolicy,
};
