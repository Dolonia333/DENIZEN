'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const federation = require('../src/denizen-federation');
const router = require('../src/lm-studio-router');

describe('denizen-federation', () => {
  beforeEach(() => {
    router.clearRegistryForTests();
    delete process.env.DENIZEN_FEDERATION_TOKEN;
    delete process.env.DENIZEN_FEDERATION_PEERS;
  });

  it('ingests peer inference nodes as federation role', () => {
    const result = federation.ingestPeerReport({
      peer_url: 'https://city-b.example',
      city_label: 'City B',
      nodes: [{
        machine_id: 'city-b-gpu',
        url: 'http://10.0.0.5:1234',
        label: 'City B GPU',
        models: ['llama3.2'],
        main_model: 'llama3.2',
      }],
    });
    assert.equal(result.ingested_count, 1);
    const nodes = router.listNodes().filter((n) => n.role === 'federation');
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].url, 'http://10.0.0.5:1234');
  });

  it('verifyFederationRequest rejects missing token', () => {
    process.env.DENIZEN_FEDERATION_TOKEN = 'secret';
    const bad = federation.verifyFederationRequest({ headers: {} }, {});
    assert.equal(bad.ok, false);
    const good = federation.verifyFederationRequest(
      { headers: { 'x-federation-token': 'secret' } },
      {},
    );
    assert.equal(good.ok, true);
  });
});
