'use strict';

const lmStudioRouter = require('./lm-studio-router');

function parseFederationPeers(env = process.env) {
  const raw = String(env.DENIZEN_FEDERATION_PEERS || '').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

function federationToken(env = process.env) {
  return String(
    env.DENIZEN_FEDERATION_TOKEN
    || env.DENIZEN_FLEET_AGENT_TOKEN
    || '',
  ).trim() || null;
}

function verifyFederationRequest(req, body = {}, env = process.env) {
  const expected = federationToken(env);
  if (!expected) {
    return { ok: false, error: 'federation not configured', statusCode: 503 };
  }
  const headers = req?.headers || {};
  const got = String(
    body.federation_token
    || body.token
    || headers['x-federation-token']
    || headers['x-fleet-agent-token']
    || '',
  ).trim();
  if (!got || got !== expected) {
    return { ok: false, error: 'invalid federation token', statusCode: 401 };
  }
  return { ok: true };
}

/**
 * Ingest inference nodes advertised by a peer Denizen city.
 * Body: { peer_url, city_label, nodes: [{ machine_id, url, label, models, main_model }] }
 */
function ingestPeerReport(body = {}) {
  const peerUrl = String(body.peer_url || body.peerUrl || '').trim().replace(/\/+$/, '');
  const cityLabel = String(body.city_label || body.cityLabel || peerUrl || 'peer').trim();
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  const ingested = [];

  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const url = String(n.url || n.inference_url || '').trim();
    if (!url) continue;
    const machineId = String(n.machine_id || n.node_id || `${peerUrl}-${url}`);
    const row = lmStudioRouter.ingestFromMachine({
      machine_id: machineId,
      label: n.label || `${cityLabel} · ${machineId}`,
      role: 'federation',
      contributing: true,
      inference: {
        backend: n.backend || 'lmstudio',
        url,
        advertise_url: url,
        reachable: n.reachable !== false,
        reachable_local: false,
        rpc_capable: false,
        network_reachable: true,
        models: Array.isArray(n.models) ? n.models : [],
        main_model: n.main_model || n.mainModel || null,
        probed_at: new Date().toISOString(),
      },
      lm_studio: {
        url,
        reachable: n.reachable !== false,
        models: Array.isArray(n.models) ? n.models : [],
        main_model: n.main_model || null,
      },
      sampled_at: new Date().toISOString(),
    });
    if (row) ingested.push(row.node_id);
  }

  return {
    ok: true,
    peer_url: peerUrl,
    city_label: cityLabel,
    ingested_count: ingested.length,
    ingested_node_ids: ingested,
  };
}

function buildStatus() {
  const peers = parseFederationPeers();
  const nodes = lmStudioRouter.listNodes().filter((n) => n.role === 'federation');
  return {
    enabled: peers.length > 0 && !!federationToken(),
    peers,
    federation_nodes: nodes.length,
    nodes: nodes.map((n) => ({
      node_id: n.node_id,
      label: n.label,
      url: n.url,
      reachable: n.reachable,
      main_model: n.main_model,
    })),
  };
}

module.exports = {
  parseFederationPeers,
  federationToken,
  verifyFederationRequest,
  ingestPeerReport,
  buildStatus,
};
