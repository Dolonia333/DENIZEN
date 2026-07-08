'use strict';

/**
 * Fan-out security monitor WebSocket events across world-pubsub so
 * spectate followers relay threats to local /security-ws clients.
 */

const RELAY_TYPES = new Set(['threat', 'threat-resolved', 'heartbeat']);

function isSecurityRelayFrame(frame) {
  if (!frame || typeof frame !== 'object') return false;
  return RELAY_TYPES.has(String(frame.type || ''));
}

function relayToSecurityClients(securityWss, msg) {
  if (!securityWss?.clients?.size) return 0;
  const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
  let sent = 0;
  securityWss.clients.forEach((ws) => {
    if (ws.readyState !== 1) return;
    try {
      ws.send(data);
      sent += 1;
    } catch (_) { /* drop */ }
  });
  return sent;
}

/**
 * @param {{
 *   securityMonitor: import('../security-monitor-server'),
 *   worldPubsub: ReturnType<typeof import('./denizen-world-pubsub').createWorldPubsub>,
 *   securityWss: import('ws').WebSocketServer,
 *   isRelayOnly?: boolean,
 * }} opts
 */
function wireSecurityRelay(opts = {}) {
  const { securityMonitor, worldPubsub, securityWss, isRelayOnly = false } = opts;
  if (!securityMonitor || !worldPubsub) {
    return { wired: false, reason: 'missing deps' };
  }

  const role = worldPubsub.role || 'primary';
  const pubsubEnabled = !!worldPubsub.enabled;

  if (role === 'primary' && pubsubEnabled && !isRelayOnly) {
    securityMonitor.setOnBroadcast((msg) => {
      if (!isSecurityRelayFrame(msg)) return;
      worldPubsub.publish(msg).catch(() => null);
    });
  }

  if (role === 'follower' && pubsubEnabled) {
    worldPubsub.subscribe((frame) => {
      if (!isSecurityRelayFrame(frame)) return;
      relayToSecurityClients(securityWss, frame);
    }).catch((err) => {
      console.warn('[security-relay] follower subscribe failed:', err?.message || err);
    });
  }

  return {
    wired: true,
    role,
    pubsubEnabled,
    relayOnly: isRelayOnly,
  };
}

module.exports = {
  RELAY_TYPES,
  isSecurityRelayFrame,
  relayToSecurityClients,
  wireSecurityRelay,
};
