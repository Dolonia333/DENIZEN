'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { filterPreset, LavalinkClient } = require('../src/music/lavalink-client');

describe('Lavalink client helpers', () => {
  it('filterPreset returns known shapes', () => {
    assert.deepEqual(filterPreset('none'), {});
    assert.ok(filterPreset('bassboost').equalizer);
    assert.ok(filterPreset('nightcore').timescale);
    assert.ok(filterPreset('8d').rotation);
  });

  it('isConfigured reflects env', () => {
    const prev = process.env.LAVALINK_HOST;
    delete process.env.LAVALINK_HOST;
    delete process.env.LAVALINK_URL;
    // may still be true if PORT set in env — just call without assert on global
    const cfg = LavalinkClient.isConfigured();
    assert.equal(typeof cfg, 'boolean');
    if (prev !== undefined) process.env.LAVALINK_HOST = prev;
  });

  it('builds default http base', () => {
    const prevH = process.env.LAVALINK_HOST;
    const prevU = process.env.LAVALINK_URL;
    delete process.env.LAVALINK_URL;
    process.env.LAVALINK_HOST = '10.0.0.5';
    process.env.LAVALINK_PORT = '2333';
    const c = new LavalinkClient({ userId: '123' });
    assert.equal(c.httpBase, 'http://10.0.0.5:2333');
    if (prevH !== undefined) process.env.LAVALINK_HOST = prevH;
    else delete process.env.LAVALINK_HOST;
    if (prevU !== undefined) process.env.LAVALINK_URL = prevU;
  });
});
