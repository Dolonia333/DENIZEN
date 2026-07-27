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
    // The "no custom avatar → 404" guard used to be an inline
    // `!store.hasCustom(userId)` here; it now lives inside
    // ensurePngOnDemand (asserted below). The route must still 404 on a
    // falsy bake rather than serving something.
    assert.match(route, /await avatarApi\.ensurePngOnDemand\(store, userId\)/);
    assert.match(route, /custom avatar not found/);
  });

  // Guards the property the two route tests above delegate to. Without this,
  // the refactor that moved hasCustom out of the routes would have left the
  // check untested in every location.
  it('refuses to bake a PNG for a user with no custom avatar', () => {
    const bake = read('src/discord-avatar/bake.js');
    const fn = bake.slice(bake.indexOf('async function ensurePngOnDemand'));
    assert.match(fn, /if \(!store\.hasCustom\(userId\)\) return null;/);
  });

  it('requires session credentials on public avatar PUT (closet UI ships separately)', () => {
    // Map closet UI rewrite is intentionally deferred so office/map layout
    // stays stable; the server-side write path must still require session auth.
    const server = read('server.js');
    const start = server.indexOf("urlPath.startsWith('/api/discord/avatar/')");
    const end = server.indexOf('// Discord pixel map', start);
    const route = server.slice(start, end);
    assert.match(route, /sessionAuth\.extractSessionAuth/);
    assert.match(route, /getLinkStatusForSession\(sessionId, sessionToken\)/);
    assert.match(route, /req\.method === 'PUT'/);
  });

  it('keeps the localhost presence avatar API read-only', () => {
    const presence = read('discord-bot/src/presence-server.js');
    const handler = presence.slice(presence.indexOf('async function handleAvatar'));
    assert.match(presence, /path\.join\(__dirname, '\.\.\/\.\.\/src\/discord-avatar'\)/);
    assert.match(presence, /Access-Control-Allow-Methods', 'GET, OPTIONS'/);
    assert.doesNotMatch(handler, /req\.method === 'PUT'/);
    // Same refactor as the server route: the hasCustom guard is now inside
    // ensurePngOnDemand, so assert the delegation and the 404 branch.
    assert.match(handler, /await avatarApi\.ensurePngOnDemand\(store, userId\)/);
    assert.match(handler, /custom avatar not found/);
  });

  it('handles NAS inotify exhaustion and keeps the polling fallback alive', () => {
    const server = read('server.js');
    const monitor = read('security-monitor-server.js');
    const start = server.indexOf('function _startLucyMirrorFrameWatcher');
    const watcher = server.slice(start, server.indexOf('function closeLucyBrowser', start));
    assert.match(watcher, /mirrorWatcher\.on\('error', \(\) => \{\}\)/);
    assert.match(watcher, /setInterval\(_pushLucyBrowserFrame, 120\)/);
    assert.match(server, /recursiveFileWatch: process\.env\.NODE_ENV !== 'production'/);
    assert.match(monitor, /recursiveFileWatch: options\.recursiveFileWatch === true/);
    assert.match(monitor, /watcher\.on\('error'/);
  });
});
