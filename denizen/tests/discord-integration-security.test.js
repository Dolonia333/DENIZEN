'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

describe('Discord integration security boundaries', () => {
  it('authenticates the Denizen session before starting link-mode OAuth', () => {
    const server = read('server.js');
    const start = server.indexOf("urlPath === '/api/visitor/auth/discord/connect'");
    const end = server.indexOf("urlPath.startsWith('/api/visitor/auth/discord/callback')", start);
    const route = server.slice(start, end);
    assert.match(route, /visitorAccess\.assertSessionToken\(sessionId, sessionToken\)/);
    assert.doesNotMatch(route, /searchParams\.get\('identity_id'\)/);
  });

  it('requires the linked session owner for public avatar writes', () => {
    const server = read('server.js');
    const start = server.indexOf("urlPath.startsWith('/api/discord/avatar/')");
    const end = server.indexOf('// Discord pixel map', start);
    const route = server.slice(start, end);
    assert.match(route, /getLinkStatusForSession\(sessionId, sessionToken\)/);
    assert.match(route, /String\(linked\.discord_user_id\) !== userId/);
    assert.match(route, /!store\.hasCustom\(userId\)/);
  });

  it('sends session credentials when the map closet saves', () => {
    const page = read('discord-map/index.html');
    assert.match(page, /'X-Session-Id': session\.session_id/);
    assert.match(page, /'X-Session-Token': session\.session_token/);
  });

  it('keeps the localhost presence avatar API read-only', () => {
    const presence = read('discord-bot/src/presence-server.js');
    const handler = presence.slice(presence.indexOf('async function handleAvatar'));
    assert.match(presence, /Access-Control-Allow-Methods', 'GET, OPTIONS'/);
    assert.doesNotMatch(handler, /req\.method === 'PUT'/);
    assert.match(handler, /!store\.hasCustom\(userId\)/);
  });
});
