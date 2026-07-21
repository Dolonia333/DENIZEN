'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

describe('discord map team-code gate', () => {
  const prevDb = process.env.DENIZEN_DB_ENABLED;
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  before(() => {
    process.env.DENIZEN_DB_ENABLED = 'false';
    delete process.env.SUPABASE_URL;
  });

  after(() => {
    if (prevDb == null) delete process.env.DENIZEN_DB_ENABLED;
    else process.env.DENIZEN_DB_ENABLED = prevDb;
    if (prevUrl == null) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    // Clear module cache so other suites see real env
    for (const key of Object.keys(require.cache)) {
      if (key.includes('denizen-guild-org') || key.includes('denizen-map-access')
        || key.includes('visitor-session-auth')) {
        delete require.cache[key];
      }
    }
  });

  it('createMapGrant / verifyMapGrant round-trip scoped to guild', () => {
    delete require.cache[require.resolve(path.join(ROOT, 'src/visitor-session-auth.js'))];
    const auth = require(path.join(ROOT, 'src/visitor-session-auth.js'));
    const tok = auth.createMapGrant({
      guildId: 'guild-1',
      orgId: 'org-1',
      orgSlug: 'acme',
    });
    const payload = auth.verifyMapGrant(tok);
    assert.equal(payload.typ, 'map_grant');
    assert.equal(payload.guild_id, 'guild-1');
    assert.equal(payload.org_slug, 'acme');
    assert.equal(auth.verifyMapGrant('not.a.grant'), null);
    assert.equal(auth.verifyAccessGrant(tok), null);
  });

  it('assertMapAccess allows when DB is disabled', async () => {
    delete require.cache[require.resolve(path.join(ROOT, 'src/denizen-db.js'))];
    delete require.cache[require.resolve(path.join(ROOT, 'src/denizen-guild-org.js'))];
    delete require.cache[require.resolve(path.join(ROOT, 'src/denizen-map-access.js'))];
    const mapAccess = require(path.join(ROOT, 'src/denizen-map-access.js'));
    const gate = await mapAccess.assertMapAccess(
      { url: '/api/discord/map/presence?guildId=99', headers: {} },
      { guildId: '99' },
    );
    assert.equal(gate.ok, true);
    assert.equal(gate.reason, 'db_open');
  });

  it('extractMapGrant reads header and query', () => {
    delete require.cache[require.resolve(path.join(ROOT, 'src/denizen-map-access.js'))];
    const mapAccess = require(path.join(ROOT, 'src/denizen-map-access.js'));
    assert.equal(
      mapAccess.extractMapGrant({ headers: { 'x-map-grant': 'abc' }, url: '/' }),
      'abc',
    );
    assert.equal(
      mapAccess.extractMapGrant({ headers: {}, url: '/p?map_grant=xyz' }),
      'xyz',
    );
    assert.equal(
      mapAccess.extractGuildId({ url: '/p?guildId=42', headers: {} }),
      '42',
    );
  });

  it('map grant rejects wrong guild id on verify path', async () => {
    delete require.cache[require.resolve(path.join(ROOT, 'src/visitor-session-auth.js'))];
    delete require.cache[require.resolve(path.join(ROOT, 'src/denizen-map-access.js'))];
    const auth = require(path.join(ROOT, 'src/visitor-session-auth.js'));
    const mapAccess = require(path.join(ROOT, 'src/denizen-map-access.js'));
    const tok = auth.createMapGrant({ guildId: 'guild-a', orgId: 'o1' });
    assert.equal(
      mapAccess.extractMapGrant({
        headers: { 'x-map-grant': tok },
        url: '/api/discord/map/presence?guildId=guild-b',
      }),
      tok,
    );
    const payload = auth.verifyMapGrant(tok);
    assert.notEqual(String(payload.guild_id), 'guild-b');
  });

  it('assertMapAccess: unlinked guild + no session → MEMBERSHIP_REQUIRED', async () => {
    delete require.cache[require.resolve(path.join(ROOT, 'src/denizen-map-access.js'))];
    const guildOrgMock = require(path.join(ROOT, 'src/denizen-guild-org.js'));
    const origDbReady = guildOrgMock.dbReady;
    const origGetAccessStatus = guildOrgMock.getAccessStatus;
    guildOrgMock.dbReady = () => true;
    guildOrgMock.getAccessStatus = async () => ({ linked: false, gated: false, guild_id: 'g1' });
    try {
      const mapAccess = require(path.join(ROOT, 'src/denizen-map-access.js'));
      const gate = await mapAccess.assertMapAccess(
        { url: '/api/discord/map/presence?guildId=g1', headers: {} },
        { guildId: 'g1' },
      );
      assert.equal(gate.ok, false);
      assert.equal(gate.code, 'MEMBERSHIP_REQUIRED');
    } finally {
      guildOrgMock.dbReady = origDbReady;
      guildOrgMock.getAccessStatus = origGetAccessStatus;
    }
  });

  it('assertMapAccess: tokenless demo session (Discord OAuth) still resolves membership', async () => {
    // Discord OAuth logins are demo-tier and never mint a session token, so
    // the request carries only session_id. Membership must still resolve.
    delete require.cache[require.resolve(path.join(ROOT, 'src/denizen-map-access.js'))];
    const guildOrgMock = require(path.join(ROOT, 'src/denizen-guild-org.js'));
    const discordAuthMock = require(path.join(ROOT, 'src/denizen-discord-auth.js'));
    const membershipMock = require(path.join(ROOT, 'src/denizen-discord-membership.js'));
    const origDbReady = guildOrgMock.dbReady;
    const origGetLinkStatus = discordAuthMock.getLinkStatusForSession;
    const origIsMember = membershipMock.isMemberOfGuild;
    guildOrgMock.dbReady = () => true;
    let sawToken;
    discordAuthMock.getLinkStatusForSession = async (sid, tok) => {
      sawToken = tok;
      return { linked: true, discord_user_id: 'u1' };
    };
    membershipMock.isMemberOfGuild = async (uid, gid) => uid === 'u1' && gid === 'g1';
    try {
      const mapAccess = require(path.join(ROOT, 'src/denizen-map-access.js'));
      // Note: session_id present, NO session_token (tokenless demo session).
      const gate = await mapAccess.assertMapAccess(
        { url: '/api/discord/map/presence?guildId=g1&session_id=s1', headers: {} },
        { guildId: 'g1' },
      );
      assert.equal(gate.ok, true);
      assert.equal(gate.reason, 'member');
      assert.equal(sawToken, ''); // called through with empty token, not skipped
    } finally {
      guildOrgMock.dbReady = origDbReady;
      discordAuthMock.getLinkStatusForSession = origGetLinkStatus;
      membershipMock.isMemberOfGuild = origIsMember;
    }
  });

  it('assertMapAccess: unlinked guild + session resolving to a tracked member → allow', async () => {
    delete require.cache[require.resolve(path.join(ROOT, 'src/denizen-map-access.js'))];
    const guildOrgMock = require(path.join(ROOT, 'src/denizen-guild-org.js'));
    const discordAuthMock = require(path.join(ROOT, 'src/denizen-discord-auth.js'));
    const membershipMock = require(path.join(ROOT, 'src/denizen-discord-membership.js'));
    const origDbReady = guildOrgMock.dbReady;
    const origGetLinkStatus = discordAuthMock.getLinkStatusForSession;
    const origIsMember = membershipMock.isMemberOfGuild;
    guildOrgMock.dbReady = () => true;
    discordAuthMock.getLinkStatusForSession = async () => ({ linked: true, discord_user_id: 'u1' });
    membershipMock.isMemberOfGuild = async (uid, gid) => uid === 'u1' && gid === 'g1';
    try {
      const mapAccess = require(path.join(ROOT, 'src/denizen-map-access.js'));
      const gate = await mapAccess.assertMapAccess(
        { url: '/api/discord/map/presence?guildId=g1&session_id=s1&session_token=t1', headers: {} },
        { guildId: 'g1' },
      );
      assert.equal(gate.ok, true);
      assert.equal(gate.reason, 'member');
    } finally {
      guildOrgMock.dbReady = origDbReady;
      discordAuthMock.getLinkStatusForSession = origGetLinkStatus;
      membershipMock.isMemberOfGuild = origIsMember;
    }
  });

  it('assertMapAccess: linked+gated guild + membership true → allow before grant/org checks', async () => {
    delete require.cache[require.resolve(path.join(ROOT, 'src/denizen-map-access.js'))];
    const guildOrgMock = require(path.join(ROOT, 'src/denizen-guild-org.js'));
    const discordAuthMock = require(path.join(ROOT, 'src/denizen-discord-auth.js'));
    const membershipMock = require(path.join(ROOT, 'src/denizen-discord-membership.js'));
    const origDbReady = guildOrgMock.dbReady;
    const origGetAccessStatus = guildOrgMock.getAccessStatus;
    const origGetLinkStatus = discordAuthMock.getLinkStatusForSession;
    const origIsMember = membershipMock.isMemberOfGuild;
    guildOrgMock.dbReady = () => true;
    guildOrgMock.getAccessStatus = async () => ({
      linked: true, gated: true, org_id: 'org1', org_slug: 'acme', guild_id: 'g1',
    });
    discordAuthMock.getLinkStatusForSession = async () => ({ linked: true, discord_user_id: 'u1' });
    membershipMock.isMemberOfGuild = async () => true;
    try {
      const mapAccess = require(path.join(ROOT, 'src/denizen-map-access.js'));
      const gate = await mapAccess.assertMapAccess(
        { url: '/api/discord/map/presence?guildId=g1&session_id=s1&session_token=t1', headers: {} },
        { guildId: 'g1' },
      );
      assert.equal(gate.ok, true);
      assert.equal(gate.reason, 'member');
    } finally {
      guildOrgMock.dbReady = origDbReady;
      guildOrgMock.getAccessStatus = origGetAccessStatus;
      discordAuthMock.getLinkStatusForSession = origGetLinkStatus;
      membershipMock.isMemberOfGuild = origIsMember;
    }
  });

  it('assertMapAccess: linked+gated guild + membership false + valid grant → allow (regression)', async () => {
    delete require.cache[require.resolve(path.join(ROOT, 'src/denizen-map-access.js'))];
    delete require.cache[require.resolve(path.join(ROOT, 'src/visitor-session-auth.js'))];
    const guildOrgMock = require(path.join(ROOT, 'src/denizen-guild-org.js'));
    const authMod = require(path.join(ROOT, 'src/visitor-session-auth.js'));
    const origDbReady = guildOrgMock.dbReady;
    const origGetAccessStatus = guildOrgMock.getAccessStatus;
    guildOrgMock.dbReady = () => true;
    guildOrgMock.getAccessStatus = async () => ({
      linked: true, gated: true, org_id: 'org1', org_slug: 'acme', guild_id: 'g1',
    });
    const grant = authMod.createMapGrant({ guildId: 'g1', orgId: 'org1', orgSlug: 'acme' });
    try {
      const mapAccess = require(path.join(ROOT, 'src/denizen-map-access.js'));
      const gate = await mapAccess.assertMapAccess(
        { url: '/api/discord/map/presence?guildId=g1', headers: { 'x-map-grant': grant } },
        { guildId: 'g1' },
      );
      assert.equal(gate.ok, true);
      assert.equal(gate.reason, 'map_grant');
    } finally {
      guildOrgMock.dbReady = origDbReady;
      guildOrgMock.getAccessStatus = origGetAccessStatus;
    }
  });

  it('filterAccessibleGuilds: drops unlinked non-member guilds, keeps member and team-session guilds', async () => {
    delete require.cache[require.resolve(path.join(ROOT, 'src/denizen-map-access.js'))];
    const guildOrgMock = require(path.join(ROOT, 'src/denizen-guild-org.js'));
    const discordAuthMock = require(path.join(ROOT, 'src/denizen-discord-auth.js'));
    const membershipMock = require(path.join(ROOT, 'src/denizen-discord-membership.js'));
    const origDbReady = guildOrgMock.dbReady;
    const origGetLinkForGuild = guildOrgMock.getLinkForGuild;
    const origGetLinkStatus = discordAuthMock.getLinkStatusForSession;
    const origGetMemberGuildIds = membershipMock.getMemberGuildIds;

    guildOrgMock.dbReady = () => true;
    // guild-member: caller is a tracked member. guild-teamsession: caller's
    // session org matches its linked org. guild-none: unlinked, not a
    // member — must be dropped.
    guildOrgMock.getLinkForGuild = async (gid) => {
      if (gid === 'guild-teamsession') return { org: { id: 'org1' } };
      return null;
    };
    discordAuthMock.getLinkStatusForSession = async () => ({ linked: true, discord_user_id: 'u1' });
    membershipMock.getMemberGuildIds = async () => new Set(['guild-member']);

    const denizenVisitor = require(path.join(ROOT, 'src/denizen-visitor.js'));
    const origGetSession = denizenVisitor.getSession;
    denizenVisitor.getSession = async () => ({ org_id: 'org1' });

    try {
      const mapAccess = require(path.join(ROOT, 'src/denizen-map-access.js'));
      const req = {
        url: '/api/discord/map/guilds?session_id=s1&session_token=t1',
        headers: {},
      };
      const result = await mapAccess.filterAccessibleGuilds(req, [
        { guildId: 'guild-member', name: 'A' },
        { guildId: 'guild-teamsession', name: 'B' },
        { guildId: 'guild-none', name: 'C' },
      ]);
      const ids = result.map((g) => g.guildId).sort();
      assert.deepEqual(ids, ['guild-member', 'guild-teamsession']);
    } finally {
      guildOrgMock.dbReady = origDbReady;
      guildOrgMock.getLinkForGuild = origGetLinkForGuild;
      discordAuthMock.getLinkStatusForSession = origGetLinkStatus;
      membershipMock.getMemberGuildIds = origGetMemberGuildIds;
      denizenVisitor.getSession = origGetSession;
    }
  });
});
