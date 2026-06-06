'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const origTeam = process.env.DENIZEN_TEAM_CODE;
const origCeo = process.env.DENIZEN_CEO_ACCESS_CODE;
const origDemo = process.env.DENIZEN_DEMO_ORG_SLUG;
const origTeamOrg = process.env.DENIZEN_TEAM_ORG_SLUG;

describe('visitor access config', () => {
  beforeEach(() => {
    process.env.DENIZEN_TEAM_CODE = '1921';
    process.env.DENIZEN_CEO_ACCESS_CODE = 'ceo-secret';
    process.env.DENIZEN_DEMO_ORG_SLUG = 'acme';
    process.env.DENIZEN_TEAM_ORG_SLUG = 'zion';
    delete require.cache[require.resolve('../src/prompt-tuning.js')];
  });

  afterEach(() => {
    if (origTeam == null) delete process.env.DENIZEN_TEAM_CODE;
    else process.env.DENIZEN_TEAM_CODE = origTeam;
    if (origCeo == null) delete process.env.DENIZEN_CEO_ACCESS_CODE;
    else process.env.DENIZEN_CEO_ACCESS_CODE = origCeo;
    if (origDemo == null) delete process.env.DENIZEN_DEMO_ORG_SLUG;
    else process.env.DENIZEN_DEMO_ORG_SLUG = origDemo;
    if (origTeamOrg == null) delete process.env.DENIZEN_TEAM_ORG_SLUG;
    else process.env.DENIZEN_TEAM_ORG_SLUG = origTeamOrg;
    delete require.cache[require.resolve('../src/prompt-tuning.js')];
  });

  it('toClientConfig exposes visitorAccess without secrets', () => {
    const promptTuning = require('../src/prompt-tuning.js');
    const cfg = promptTuning.toClientConfig();
    assert.deepEqual(cfg.visitorAccess, {
      demoOrgSlug: 'acme',
      teamOrgSlug: 'zion',
      teamCodeRequired: true,
      ceoAccessRequired: true,
    });
    assert.equal(cfg.teamCode, undefined);
    assert.equal(cfg.ceoAccessCode, undefined);
  });

  it('verifyVisitorAccessCode validates team and ceo codes', () => {
    const promptTuning = require('../src/prompt-tuning.js');
    const team = promptTuning.verifyVisitorAccessCode('1921', 'team');
    assert.equal(team.ok, true);
    assert.equal(team.org_slug, 'zion');
    assert.equal(team.tier, 'team');
    assert.equal(promptTuning.verifyVisitorAccessCode('wrong', 'team').ok, false);
    assert.deepEqual(promptTuning.verifyVisitorAccessCode('ceo-secret', 'ceo'), { ok: true });
    assert.equal(promptTuning.verifyVisitorAccessCode('nope', 'ceo').ok, false);
  });
});

describe('visitor-access canUseRealWork', () => {
  const { canUseRealWork, assertTeamFeature, VisitorAccessError, DEMO_RESTRICTED_FEATURES } =
    require('../src/visitor-access.js');

  it('demo tier never gets real work', () => {
    assert.equal(canUseRealWork({ tier: 'demo' }, { allow_real_work: true }), false);
    assert.equal(canUseRealWork({ tier: 'demo' }, {}), false);
  });

  it('team tier may use real work', () => {
    assert.equal(canUseRealWork({ tier: 'team' }, {}), true);
    assert.equal(canUseRealWork({ tier: 'team' }, { allow_real_work: true }), true);
  });

  it('org demo settings block real work', () => {
    assert.equal(canUseRealWork({ tier: 'team' }, { tier: 'demo', allow_real_work: false }), false);
    assert.equal(canUseRealWork({}, { demo: true }), false);
  });

  it('CEO bridge sessions may use real work', () => {
    assert.equal(canUseRealWork({ bridge: 'ceo', tier: 'ceo' }, {}), true);
  });

  it('assertTeamFeature throws DEMO_RESTRICTED for demo handoff to CEO', () => {
    assert.throws(
      () => assertTeamFeature({ isDemo: true }, 'to_ceo'),
      (err) => err instanceof VisitorAccessError && err.code === 'DEMO_RESTRICTED',
    );
    assert.doesNotThrow(() => assertTeamFeature({ isDemo: false }, 'to_ceo'));
  });

  it('lists expected demo-restricted features', () => {
    assert.ok(DEMO_RESTRICTED_FEATURES.has('to_ceo'));
    assert.ok(DEMO_RESTRICTED_FEATURES.has('research_external'));
    assert.ok(DEMO_RESTRICTED_FEATURES.has('briefing'));
  });

  it('verifyAccessCode issues signed access_grant for team code', () => {
    process.env.DENIZEN_TEAM_CODE = '1921';
    delete require.cache[require.resolve('../src/prompt-tuning.js')];
    delete require.cache[require.resolve('../src/visitor-session-auth.js')];
    delete require.cache[require.resolve('../src/visitor-access.js')];
    const { verifyAccessCode } = require('../src/visitor-access.js');
    const sessionAuth = require('../src/visitor-session-auth.js');
    const result = verifyAccessCode('1921', 'team');
    assert.equal(result.ok, true);
    assert.ok(result.access_grant);
    const payload = sessionAuth.verifyAccessGrant(result.access_grant);
    assert.equal(payload.tier, 'team');
    assert.equal(payload.org_slug, 'zion');
  });
});

describe('visitor-access module', () => {
  const SESSION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const ACME_ORG_ID = '22222222-2222-2222-2222-222222222222';
  const ZION_ORG_ID = '11111111-1111-1111-1111-111111111111';

  let calls;

  beforeEach(() => {
    calls = [];
    process.env.DENIZEN_DEMO_ORG_SLUG = 'acme';
    process.env.DENIZEN_TEAM_ORG_SLUG = 'zion';
    delete require.cache[require.resolve('../src/prompt-tuning.js')];
    delete require.cache[require.resolve('../src/denizen-db.js')];
    delete require.cache[require.resolve('../src/denizen-visitor.js')];
    delete require.cache[require.resolve('../src/visitor-access.js')];

    const denizenDb = require('../src/denizen-db.js');
    denizenDb.enabled = true;
    denizenDb.orgSlug = 'zion';

    global.fetch = async (url) => {
      calls.push(url);
      if (url.includes('denizen_visitor_sessions') && url.includes(SESSION_ID)) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{
            id: SESSION_ID,
            display_name: 'Demo Guest',
            org_id: ACME_ORG_ID,
            metadata: { tier: 'demo', org_slug: 'acme' },
          }],
        };
      }
      if (url.includes('denizen_organizations') && url.includes(ACME_ORG_ID)) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{
            id: ACME_ORG_ID,
            slug: 'acme',
            settings: { tier: 'demo', demo: true },
          }],
        };
      }
      if (url.includes('denizen_organizations') && url.includes(ZION_ORG_ID)) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{
            id: ZION_ORG_ID,
            slug: 'zion',
            settings: { tier: 'team' },
          }],
        };
      }
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => [] };
    };
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('resolveSessionAccess returns demo flags for acme session', async () => {
    const {
      resolveSessionAccess,
      assertTeamFeature,
      VisitorAccessError,
      visitorAccessErrorStatus,
    } = require('../src/visitor-access.js');

    const access = await resolveSessionAccess(SESSION_ID);
    assert.equal(access.tier, 'demo');
    assert.equal(access.orgSlug, 'acme');
    assert.equal(access.orgId, ACME_ORG_ID);
    assert.equal(access.isDemo, true);
    assert.equal(access.isTeam, false);
    assert.equal(access.isCeoBridge, false);

    assert.throws(
      () => assertTeamFeature(access, 'to_ceo'),
      (err) => {
        assert.ok(err instanceof VisitorAccessError);
        assert.equal(err.code, 'DEMO_RESTRICTED');
        assert.equal(err.feature, 'to_ceo');
        assert.equal(visitorAccessErrorStatus(err), 403);
        return true;
      },
    );
  });
});
