'use strict';

const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

describe('denizen-discord-auth', () => {
  let auth;
  const prev = {};

  before(() => {
    for (const k of [
      'DISCORD_CLIENT_ID',
      'DISCORD_APPLICATION_ID',
      'DISCORD_CLIENT_SECRET',
      'DENIZEN_PUBLIC_URL',
      'DENIZEN_SESSION_SIGNING_KEY',
    ]) {
      prev[k] = process.env[k];
    }
    process.env.DISCORD_CLIENT_ID = 'test-client-id';
    process.env.DISCORD_CLIENT_SECRET = 'test-client-secret';
    process.env.DENIZEN_PUBLIC_URL = 'https://denizen.test';
    process.env.DENIZEN_SESSION_SIGNING_KEY = 'test-signing-key-for-oauth';
    // Fresh require after env set
    delete require.cache[require.resolve('../src/denizen-discord-auth.js')];
    auth = require('../src/denizen-discord-auth.js');
  });

  after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete require.cache[require.resolve('../src/denizen-discord-auth.js')];
  });

  it('buildConnectUrl produces Discord authorize URL with state', () => {
    const url = auth.buildConnectUrl({ mode: 'signup', returnTo: '/discord-map/' });
    assert.match(url, /^https:\/\/discord\.com\/api\/oauth2\/authorize\?/);
    const u = new URL(url);
    assert.equal(u.searchParams.get('client_id'), 'test-client-id');
    assert.equal(u.searchParams.get('response_type'), 'code');
    assert.equal(
      u.searchParams.get('redirect_uri'),
      'https://denizen.test/api/visitor/auth/discord/callback',
    );
    assert.match(u.searchParams.get('scope'), /identify/);
    const state = u.searchParams.get('state');
    assert.ok(state && state.includes('.'));
    const payload = auth._verifyState(state);
    assert.equal(payload.mode, 'signup');
    assert.equal(payload.returnTo, '/discord-map/');
  });

  it('link without session falls back to signup mode in state', () => {
    const url = auth.buildConnectUrl({ mode: 'link', returnTo: '/discord-map/' });
    const state = new URL(url).searchParams.get('state');
    const payload = auth._verifyState(state);
    assert.equal(payload.mode, 'signup');
  });

  it('link with sessionId keeps link mode', () => {
    const url = auth.buildConnectUrl({
      mode: 'link',
      sessionId: '00000000-0000-4000-8000-000000000001',
      returnTo: '/discord-map/',
    });
    const state = new URL(url).searchParams.get('state');
    const payload = auth._verifyState(state);
    assert.equal(payload.mode, 'link');
    assert.equal(payload.sessionId, '00000000-0000-4000-8000-000000000001');
  });

  it('rejects open redirects in returnTo', () => {
    const url = auth.buildConnectUrl({
      mode: 'signup',
      returnTo: 'https://evil.example/phish',
    });
    const state = new URL(url).searchParams.get('state');
    assert.equal(auth._verifyState(state).returnTo, '/discord-map/');
  });

  it('rejects invalid state', () => {
    assert.equal(auth._verifyState('not.valid'), null);
    assert.equal(auth._verifyState(''), null);
  });

  it('expired state fails verification', () => {
    const token = auth._signState({
      typ: 'discord_oauth',
      mode: 'signup',
      returnTo: '/discord-map/',
      exp: Date.now() - 1000,
      jti: 'x',
    });
    assert.equal(auth._verifyState(token), null);
  });

  it('discordProfile maps Discord user payload', () => {
    const p = auth._discordProfile({
      id: '123456789012345678',
      username: 'naya',
      global_name: 'Naya',
      email: 'naya@example.com',
      avatar: 'abcdef',
    });
    assert.equal(p.discord_user_id, '123456789012345678');
    assert.equal(p.display_name, 'Naya');
    assert.equal(p.email, 'naya@example.com');
    assert.match(p.discord_avatar_url, /cdn\.discordapp\.com\/avatars\//);
  });

  it('syntheticEmail is stable per user id', () => {
    assert.equal(
      auth._syntheticEmail('99'),
      'discord_99@discord.users.denizen.local',
    );
  });

  it('successHtml writes localStorage patch and redirects with access_grant', () => {
    const html = auth.successHtml({
      profile: {
        discord_user_id: '111',
        discord_username: 'bob',
        display_name: 'Bob',
        discord_avatar_url: 'https://cdn.example/a.png',
      },
      access_grant: 'grant.token.here',
      returnTo: '/discord-map/',
    });
    assert.match(html, /discordUserId/);
    assert.match(html, /localStorage\.setItem/);
    assert.match(html, /access_grant=grant\.token\.here/);
    assert.match(html, /discord_linked=1/);
  });

  it('errorHtml escapes message', () => {
    const html = auth.errorHtml('<script>alert(1)</script>');
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
  });

  it('discordAuthErrorStatus maps codes', () => {
    assert.equal(
      auth.discordAuthErrorStatus(new auth.DiscordAuthError('x', 'NOT_CONFIGURED')),
      503,
    );
    assert.equal(
      auth.discordAuthErrorStatus(new auth.DiscordAuthError('x', 'STATE_INVALID')),
      403,
    );
    assert.equal(auth.discordAuthErrorStatus(new Error('x')), 500);
  });

  it('completeOAuth exchanges code and returns grant (mocked Discord)', async () => {
    const state = auth._signState({
      typ: 'discord_oauth',
      mode: 'signup',
      returnTo: '/discord-map/',
      exp: Date.now() + 60_000,
      jti: 't1',
    });

    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('/oauth2/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'at_test', token_type: 'Bearer' }),
        };
      }
      if (u.includes('/users/@me')) {
        return {
          ok: true,
          json: async () => ({
            id: '999888777666555444',
            username: 'maptester',
            global_name: 'Map Tester',
            email: 'maptester@example.com',
            avatar: null,
          }),
        };
      }
      throw new Error(`unexpected fetch ${u}`);
    };

    try {
      const result = await auth.completeOAuth({ code: 'authcode', stateToken: state });
      assert.equal(result.profile.discord_user_id, '999888777666555444');
      assert.equal(result.profile.display_name, 'Map Tester');
      assert.ok(result.access_grant && result.access_grant.includes('.'));
      assert.equal(result.returnTo, '/discord-map/');
      assert.equal(result.mode, 'signup');
      // identity may be null when DB disabled — still OK for map localStorage path
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('completeOAuth rejects bad state', async () => {
    await assert.rejects(
      () => auth.completeOAuth({ code: 'x', stateToken: 'bad' }),
      (err) => err.code === 'STATE_INVALID',
    );
  });
});
