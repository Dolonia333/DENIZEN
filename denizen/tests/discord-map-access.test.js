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
});
