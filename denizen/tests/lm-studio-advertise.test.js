'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isLoopbackUrl,
  resolveRouterLmUrl,
  enrichLmStudioBlock,
} = require('../src/lm-studio-advertise.js');

describe('lm-studio-advertise', () => {
  it('detects loopback URLs', () => {
    assert.equal(isLoopbackUrl('http://127.0.0.1:1234'), true);
    assert.equal(isLoopbackUrl('http://192.168.1.5:1234'), false);
  });

  it('uses advertise_url from heartbeat when local is loopback', () => {
    const url = resolveRouterLmUrl(
      { machine_id: 'pc-1' },
      {
        reachable: true,
        url: 'http://127.0.0.1:1234',
        advertise_url: 'http://192.168.1.232:1234',
      },
    );
    assert.equal(url, 'http://192.168.1.232:1234');
  });

  it('enriches reachable probe with advertise_url', () => {
    const enriched = enrichLmStudioBlock({
      url: 'http://127.0.0.1:1234',
      reachable: true,
      models: ['a', 'b'],
    });
    assert.equal(enriched.reachable, true);
    assert.ok(enriched.advertise_url);
    assert.equal(enriched.models_count, 2);
    assert.match(enriched.advertise_url, /^http:\/\//);
  });
});
