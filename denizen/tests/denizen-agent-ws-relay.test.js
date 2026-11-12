'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const relay = require('../src/denizen-agent-ws-relay');

describe('denizen-agent-ws-relay', () => {
  it('isMutatingClientMessage detects player_chat', () => {
    assert.equal(relay.isMutatingClientMessage({ type: 'player_chat' }), true);
    assert.equal(relay.isMutatingClientMessage({ type: 'world_state_batch' }), false);
  });

  it('isRelayOnlyRole for follower', () => {
    process.env.DENIZEN_SERVER_ROLE = 'follower';
    assert.equal(relay.isRelayOnlyRole(), true);
    process.env.DENIZEN_SERVER_ROLE = 'primary';
    assert.equal(relay.isRelayOnlyRole(), false);
  });

  it('buildRuntimePublicConfig exposes spectate WS when set', () => {
    process.env.DENIZEN_SPECTATE_WS_URL = 'wss://spectate.example/agent-ws';
    const cfg = relay.buildRuntimePublicConfig();
    assert.equal(cfg.spectateWsUrl, 'wss://spectate.example/agent-ws');
    assert.equal(cfg.spectateEnabled, true);
    delete process.env.DENIZEN_SPECTATE_WS_URL;
  });

  it('buildRuntimePublicConfig keeps LAN spectate off public auto-route', () => {
    process.env.DENIZEN_SPECTATE_WS_URL = 'ws://192.168.50.10:8889/agent-ws';
    const cfg = relay.buildRuntimePublicConfig();
    assert.equal(cfg.spectateEnabled, false);
    assert.equal(cfg.spectateLanUrl, 'ws://192.168.50.10:8889/agent-ws');
    delete process.env.DENIZEN_SPECTATE_WS_URL;
  });

  it('resolvePrimaryBaseUrl defaults to primary port', () => {
    delete process.env.DENIZEN_PRIMARY_URL;
    process.env.DENIZEN_PRIMARY_PORT = '8888';
    assert.equal(relay.resolvePrimaryBaseUrl(), 'http://127.0.0.1:8888');
  });
});
