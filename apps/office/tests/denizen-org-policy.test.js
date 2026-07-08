'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const denizenDb = require('../src/intelligence/denizen-db');
const orgPolicy = require('../src/auth/denizen-org-policy');

describe('denizen-org-policy', () => {
  let origGet;

  beforeEach(() => {
    orgPolicy.clearOrgPolicyCache();
    origGet = denizenDb._get;
  });

  it('mergePolicy treats demo tier as sandboxed', () => {
    const p = orgPolicy.mergePolicy({ tier: 'demo', demo: true });
    assert.equal(p.allow_business_data, false);
    assert.equal(p.allow_real_work, false);
    assert.equal(p.demo, true);
  });

  it('getOrgPolicy reads settings from DB cache', async () => {
    denizenDb._get = async (path) => {
      if (path.includes('slug=eq.acme')) {
        return [{
          slug: 'acme',
          settings: {
            tier: 'demo',
            allow_business_data: false,
            allow_real_work: false,
            allow_ceo_handoff: false,
          },
        }];
      }
      return [];
    };

    const policy = await orgPolicy.getOrgPolicy('acme');
    assert.equal(policy.tier, 'demo');
    assert.equal(policy.allow_business_data, false);

    const cached = await orgPolicy.getOrgPolicy('acme');
    assert.deepEqual(cached, policy);
    denizenDb._get = origGet;
  });

  it('isBusinessTableAllowed blocks acme on intake_forms', async () => {
    denizenDb._get = async () => [{
      slug: 'acme',
      settings: { tier: 'demo', allow_business_data: false },
    }];

    assert.equal(await orgPolicy.isBusinessTableAllowed('acme', 'intake_forms'), false);
    assert.equal(await orgPolicy.isBusinessTableAllowed('acme', 'denizen_facts'), true);
    denizenDb._get = origGet;
  });

  it('isBusinessTableAllowedSync uses slug fallback without cache', () => {
    assert.equal(orgPolicy.isBusinessTableAllowedSync('acme', 'leads'), false);
    assert.equal(orgPolicy.isBusinessTableAllowedSync('zion', 'leads'), true);
  });

  it('assertBusinessActionAllowed throws for demo org business actions', async () => {
    denizenDb._get = async () => [{
      slug: 'acme',
      settings: { tier: 'demo', allow_business_data: false },
    }];

    await assert.rejects(
      () => orgPolicy.assertBusinessActionAllowed('acme', 'lead-monitor'),
      /Business data access disabled/,
    );
    await assert.rejects(
      () => orgPolicy.assertBusinessActionAllowed('acme', 'rfp-pipeline-summary'),
      /Business data access disabled/,
    );
    await orgPolicy.assertBusinessActionAllowed('acme', 'work-history');
    denizenDb._get = origGet;
  });
});
