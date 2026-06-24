'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const router = require('../src/lm-studio-router');

describe('lm-studio-router', () => {
  beforeEach(() => {
    router.clearRegistryForTests();
    delete process.env.LM_STUDIO_ROUTER;
    delete process.env.LM_STUDIO_REMOTE_URLS;
  });

  it('remote-only mode skips localhost host bootstrap', () => {
    delete process.env.LM_STUDIO_URL;
    process.env.LM_STUDIO_REMOTE_URLS = 'http://100.71.54.109:1234';
    router.registerBootstrap();
    const nodes = router.listNodes();
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].url, 'http://100.71.54.109:1234');
    assert.equal(router.isRemoteOnlyMode(), true);
    assert.equal(router.defaultHostUrl(), 'http://100.71.54.109:1234');
  });

  it('remote-only mode excludes loopback nodes from selection', () => {
    delete process.env.LM_STUDIO_URL;
    process.env.LM_STUDIO_REMOTE_URLS = 'http://100.71.54.109:1234';
    router.upsertNode({
      node_id: 'ghost-host',
      url: 'http://127.0.0.1:1234',
      role: 'host',
      reachable: true,
      last_probe_at: new Date().toISOString(),
    });
    router.upsertNode({
      node_id: 'remote',
      url: 'http://100.71.54.109:1234',
      role: 'remote',
      reachable: true,
      last_probe_at: new Date().toISOString(),
    });
    const pick = router.selectEndpoint({ tier: 'main' });
    assert.equal(pick.url, 'http://100.71.54.109:1234');
  });

  it('unprobed nodes are not selected', () => {
    router.upsertNode({
      node_id: 'fresh',
      url: 'http://10.0.0.7:1234',
      role: 'remote',
      reachable: true,
    });
    router.upsertNode({
      node_id: 'ready',
      url: 'http://10.0.0.8:1234',
      role: 'remote',
      reachable: true,
      last_probe_at: new Date().toISOString(),
    });
    const pick = router.selectEndpoint({ tier: 'main' });
    assert.equal(pick.url, 'http://10.0.0.8:1234');
  });

  it('registers bootstrap host and env remotes', () => {
    process.env.LM_STUDIO_URL = 'http://127.0.0.1:1234';
    process.env.LM_STUDIO_REMOTE_URLS = 'http://192.168.1.50:1234';
    router.registerBootstrap();
    const nodes = router.listNodes();
    assert.ok(nodes.length >= 2);
    assert.ok(nodes.some((n) => n.role === 'host'));
    assert.ok(nodes.some((n) => n.url === 'http://192.168.1.50:1234'));
  });

  it('selectEndpoint prefers low inflight remote when queue is deep', () => {
    router.upsertNode({
      node_id: 'host',
      url: 'http://127.0.0.1:1234',
      role: 'host',
      reachable: true,
      inflight: 3,
      vram_mb: 12000,
      last_probe_at: new Date().toISOString(),
    });
    router.upsertNode({
      node_id: 'pc2',
      url: 'http://192.168.1.50:1234',
      role: 'remote',
      reachable: true,
      inflight: 0,
      vram_mb: 12000,
      last_probe_at: new Date().toISOString(),
    });

    const pick = router.selectEndpoint({ tier: 'main', queueDepth: 8 });
    assert.equal(pick.url, 'http://192.168.1.50:1234');
  });

  it('resolveProviderConfig rewrites baseUrl and tracks node id', () => {
    router.upsertNode({
      node_id: 'pc2',
      url: 'http://192.168.1.50:1234',
      role: 'remote',
      reachable: true,
      main_model: 'test/main',
      last_probe_at: new Date().toISOString(),
    });

    const cfg = router.resolveProviderConfig({
      type: 'lmstudio',
      baseUrl: 'http://127.0.0.1:1234',
      model: 'old/model',
      apiKey: 'lm-studio',
    }, { tier: 'main', queueDepth: 0 });

    assert.equal(cfg.baseUrl, 'http://192.168.1.50:1234');
    assert.equal(cfg._routerNodeId, 'pc2');
    assert.equal(cfg.model, 'test/main');
  });

  it('markFailure excludes node until cooldown', () => {
    router.upsertNode({
      node_id: 'bad',
      url: 'http://10.0.0.9:1234',
      role: 'remote',
      reachable: true,
      last_probe_at: new Date().toISOString(),
    });
    router.upsertNode({
      node_id: 'good',
      url: 'http://10.0.0.8:1234',
      role: 'remote',
      reachable: true,
      last_probe_at: new Date().toISOString(),
    });

    router.markFailure('bad', new Error('down'));
    const pick = router.selectEndpoint({ tier: 'main', excludeNodeIds: [] });
    assert.equal(pick.url, 'http://10.0.0.8:1234');
  });

  it('ingestFromMachine reads lm_studio block from fleet metrics', () => {
    const node = router.ingestFromMachine({
      machine_id: 'desktop-abc',
      role: 'desktop',
      label: 'Gaming PC',
      gpu: { vram_total_mb: 16000 },
      lm_studio: {
        url: 'http://192.168.1.88:1234',
        reachable: true,
        models: ['mistral/main'],
        main_model: 'mistral/main',
      },
    });
    assert.equal(node.url, 'http://192.168.1.88:1234');
    assert.equal(node.main_model, 'mistral/main');
  });
});
