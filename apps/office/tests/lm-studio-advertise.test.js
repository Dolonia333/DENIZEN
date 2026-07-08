'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isLoopbackUrl,
  resolveRouterLmUrl,
  enrichLmStudioBlock,
  preferServerProbeUrl,
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

  it('preferServerProbeUrl remaps Tailscale to LAN remote when configured', () => {
    const prev = process.env.LM_STUDIO_REMOTE_URLS;
    process.env.LM_STUDIO_REMOTE_URLS = 'http://192.168.1.232:1234';
    try {
      const { preferServerProbeUrl } = require('../src/lm-studio-advertise.js');
      const url = preferServerProbeUrl('http://100.71.54.109:1234', { role: 'desktop' });
      assert.equal(url, 'http://192.168.1.232:1234');
    } finally {
      if (prev === undefined) delete process.env.LM_STUDIO_REMOTE_URLS;
      else process.env.LM_STUDIO_REMOTE_URLS = prev;
    }
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
