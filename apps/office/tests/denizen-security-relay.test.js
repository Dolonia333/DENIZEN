'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const relay = require('../src/integrations/denizen-security-relay');

describe('denizen-security-relay', () => {
  it('isSecurityRelayFrame matches threat types', () => {
    assert.equal(relay.isSecurityRelayFrame({ type: 'threat', category: 'scan_probe' }), true);
    assert.equal(relay.isSecurityRelayFrame({ type: 'threat-resolved', threatId: 't1' }), true);
    assert.equal(relay.isSecurityRelayFrame({ type: 'heartbeat' }), true);
    assert.equal(relay.isSecurityRelayFrame({ type: 'npc_decision' }), false);
  });

  it('relayToSecurityClients sends open sockets only', () => {
    const sent = [];
    const securityWss = {
      clients: new Set([
        { readyState: 1, send: (d) => sent.push(d) },
        { readyState: 0, send: () => sent.push('closed') },
      ]),
    };
    const n = relay.relayToSecurityClients(securityWss, { type: 'threat', threatId: 'x' });
    assert.equal(n, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /"type":"threat"/);
  });

  it('wireSecurityRelay hooks primary broadcast', () => {
    const published = [];
    const hooks = [];
    const securityMonitor = {
      setOnBroadcast(fn) { hooks.push(fn); },
    };
    const worldPubsub = {
      role: 'primary',
      enabled: true,
      publish(frame) { published.push(frame); return Promise.resolve(); },
      subscribe() { return Promise.resolve(() => {}); },
    };
    const status = relay.wireSecurityRelay({
      securityMonitor,
      worldPubsub,
      securityWss: { clients: new Set() },
      isRelayOnly: false,
    });
    assert.equal(status.wired, true);
    assert.equal(hooks.length, 1);
    hooks[0]({ type: 'threat', threatId: 't1', category: 'scan_probe' });
    assert.equal(published.length, 1);
    hooks[0]({ type: 'npc_chat', text: 'hi' });
    assert.equal(published.length, 1);
  });

  it('wireSecurityRelay relays on follower subscribe', async () => {
    let handler = null;
    const sent = [];
    const securityWss = {
      clients: new Set([{ readyState: 1, send: (d) => sent.push(d) }]),
    };
    const worldPubsub = {
      role: 'follower',
      enabled: true,
      publish() { return Promise.resolve(); },
      subscribe(fn) {
        handler = fn;
        return Promise.resolve(() => { handler = null; });
      },
    };
    const status = relay.wireSecurityRelay({
      securityMonitor: { setOnBroadcast() {} },
      worldPubsub,
      securityWss,
      isRelayOnly: true,
    });
    assert.equal(status.wired, true);
    assert.equal(typeof handler, 'function');
    handler({ type: 'threat', threatId: 'relay-1', category: 'network_scan' });
    assert.equal(sent.length, 1);
  });
});
