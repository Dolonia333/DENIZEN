'use strict';

const crypto = require('node:crypto');
const denizenDb = require('./denizen-db.js');

const NODE_TABLE = 'denizen_compute_nodes';
const PROFILE_TABLE = 'denizen_node_profiles';

/** Fallback when compute node tables are not migrated yet. */
const memoryNodesById = new Map();

function getMemoryNode(nodeId) {
  return memoryNodesById.get(String(nodeId)) || null;
}

function saveMemoryNode(node) {
  const id = String(node.id);
  const next = { ...node, id };
  memoryNodesById.set(id, next);
  return next;
}

function listMemoryNodesByIdentity(identityId) {
  const id = String(identityId);
  return [...memoryNodesById.values()]
    .filter((node) => String(node.identity_id) === id)
    .sort((a, b) => String(b.last_heartbeat || '').localeCompare(String(a.last_heartbeat || '')));
}

function isEnabled() {
  return Boolean(denizenDb?.enabled);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function issueEndpointToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function safeEqual(left, right) {
  if (!left || !right) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(String(left)), Buffer.from(String(right)));
  } catch (_) {
    return false;
  }
}

function stripHash(node) {
  if (!node) return null;
  const { endpoint_token_hash: _ignored, ...safeNode } = node;
  return safeNode;
}

function memoryProfileId(identityId) {
  return `mem-profile-${String(identityId)}`;
}

async function ensureNodeProfile(identityId) {
  if (!identityId) return null;
  if (!isEnabled()) return memoryProfileId(identityId);
  try {
    const rows = await denizenDb._getSoft(
      `${PROFILE_TABLE}?select=id&identity_id=eq.${encodeURIComponent(identityId)}&limit=1`,
    );
    if (rows?.[0]?.id) return rows[0].id;

    const now = new Date().toISOString();
    const created = await denizenDb._postSoft(
      PROFILE_TABLE,
      {
        identity_id: identityId,
        hardware_score: 0,
        tier: 'player',
        opt_in: false,
        contribution_level: 'off',
        created_at: now,
        updated_at: now,
      },
      { prefer: 'return=representation' },
    );
    return created?.[0]?.id || memoryProfileId(identityId);
  } catch (_) {
    return memoryProfileId(identityId);
  }
}

async function registerNode({ identityId = null, nodeProfileId = null, endpointToken = null } = {}) {
  if (!identityId) throw new Error('identityId is required');

  const profileId = nodeProfileId || await ensureNodeProfile(identityId);
  if (!profileId) throw new Error('node profile unavailable');

  const issuedToken = String(endpointToken || issueEndpointToken()).trim();
  if (!issuedToken) throw new Error('endpointToken is required');

  const now = new Date().toISOString();

  if (!isEnabled()) {
    const node = saveMemoryNode({
      id: crypto.randomUUID(),
      identity_id: identityId,
      node_profile_id: profileId,
      endpoint_token_hash: hashToken(issuedToken),
      status: 'online',
      last_heartbeat: now,
      jobs_completed: 0,
      reputation_score: 0,
    });
    return {
      ...stripHash(node),
      endpoint_token: issuedToken,
    };
  }

  try {
    const rows = await denizenDb._postSoft(
      NODE_TABLE,
      {
        identity_id: identityId,
        node_profile_id: profileId,
        endpoint_token_hash: hashToken(issuedToken),
        status: 'online',
        last_heartbeat: now,
        jobs_completed: 0,
        reputation_score: 0,
      },
      { prefer: 'return=representation' },
    );

    const node = rows?.[0] || null;
    if (!node) throw new Error('node insert returned empty');
    return {
      ...stripHash(node),
      endpoint_token: issuedToken,
    };
  } catch (_) {
    const node = saveMemoryNode({
      id: crypto.randomUUID(),
      identity_id: identityId,
      node_profile_id: profileId,
      endpoint_token_hash: hashToken(issuedToken),
      status: 'online',
      last_heartbeat: now,
      jobs_completed: 0,
      reputation_score: 0,
    });
    return {
      ...stripHash(node),
      endpoint_token: issuedToken,
    };
  }
}

function verifyMemoryNode(node, token) {
  if (!node?.endpoint_token_hash) return null;
  if (!safeEqual(hashToken(token), node.endpoint_token_hash)) return null;
  return stripHash(node);
}

async function verifyNodeToken(nodeId, token) {
  if (!nodeId || !token) return null;

  const memoryMatch = verifyMemoryNode(getMemoryNode(nodeId), token);
  if (memoryMatch) return memoryMatch;
  if (!isEnabled()) return null;

  try {
    const rows = await denizenDb._getSoft(
      `${NODE_TABLE}?select=id,identity_id,node_profile_id,status,last_heartbeat,jobs_completed,reputation_score,endpoint_token_hash&limit=1&id=eq.${encodeURIComponent(nodeId)}`,
    );
    const node = rows?.[0] || null;
    return verifyMemoryNode(node, token);
  } catch (_) {
    return verifyMemoryNode(getMemoryNode(nodeId), token);
  }
}

async function verifyNodeTokenByIdentity(identityId, token) {
  if (!identityId || !token) return null;

  for (const node of listMemoryNodesByIdentity(identityId)) {
    const match = verifyMemoryNode(node, token);
    if (match) return match;
  }
  if (!isEnabled()) return null;

  try {
    const rows = await denizenDb._getSoft(
      `${NODE_TABLE}?select=id,identity_id,node_profile_id,status,last_heartbeat,jobs_completed,reputation_score,endpoint_token_hash&identity_id=eq.${encodeURIComponent(identityId)}&order=last_heartbeat.desc&limit=5`,
    );
    for (const node of rows || []) {
      const match = verifyMemoryNode(node, token);
      if (match) return match;
    }
  } catch (_) {}
  return null;
}

async function resolveNodeAuth({ nodeId = null, identityId = null, token = null } = {}) {
  if (nodeId && token) return verifyNodeToken(nodeId, token);
  if (identityId && token) return verifyNodeTokenByIdentity(identityId, token);
  return null;
}

async function getNodeForIdentity(identityId) {
  if (!identityId) return null;
  const memoryNodes = listMemoryNodesByIdentity(identityId);
  if (memoryNodes[0]) return stripHash(memoryNodes[0]);
  if (!isEnabled()) return null;
  try {
    const rows = await denizenDb._getSoft(
      `${NODE_TABLE}?select=id,status,last_heartbeat,jobs_completed,reputation_score&identity_id=eq.${encodeURIComponent(identityId)}&order=last_heartbeat.desc&limit=1`,
    );
    return stripHash(rows?.[0] || null);
  } catch (_) {
    return null;
  }
}

async function heartbeat(nodeId, token) {
  const verified = await verifyNodeToken(nodeId, token);
  if (!verified) return null;
  const now = new Date().toISOString();

  if (!isEnabled()) {
    const node = getMemoryNode(nodeId);
    if (!node) return null;
    return stripHash(saveMemoryNode({
      ...node,
      status: 'online',
      last_heartbeat: now,
    }));
  }

  const rows = await denizenDb._patch(
    `${NODE_TABLE}?id=eq.${encodeURIComponent(nodeId)}`,
    {
      status: 'online',
      last_heartbeat: now,
    },
    { prefer: 'return=representation' },
  );
  return stripHash(rows?.[0] || null);
}

async function goOffline(nodeId) {
  if (!nodeId) return null;

  if (!isEnabled()) {
    const node = getMemoryNode(nodeId);
    if (!node) return null;
    return stripHash(saveMemoryNode({ ...node, status: 'offline' }));
  }

  const rows = await denizenDb._patch(
    `${NODE_TABLE}?id=eq.${encodeURIComponent(nodeId)}`,
    { status: 'offline' },
    { prefer: 'return=representation' },
  );
  return stripHash(rows?.[0] || null);
}

async function incrementJobsCompleted(nodeId) {
  if (!nodeId) return null;

  if (!isEnabled()) {
    const node = getMemoryNode(nodeId);
    if (!node) return null;
    const current = Number(node.jobs_completed) || 0;
    return stripHash(saveMemoryNode({
      ...node,
      jobs_completed: current + 1,
    }));
  }

  const rows = await denizenDb._get(
    `${NODE_TABLE}?select=jobs_completed&id=eq.${encodeURIComponent(nodeId)}&limit=1`,
  );
  const current = Number(rows?.[0]?.jobs_completed) || 0;
  const patched = await denizenDb._patch(
    `${NODE_TABLE}?id=eq.${encodeURIComponent(nodeId)}`,
    { jobs_completed: current + 1 },
    { prefer: 'return=representation' },
  );
  return stripHash(patched?.[0] || null);
}

async function processJobLocally(jobType, payload = {}) {
  const type = String(jobType || '').trim();
  const safePayload = payload && typeof payload === 'object' ? payload : {};

  if (type === 'npc_think_batch') {
    return {
      ok: true,
      jobType: type,
      mocked: true,
      thought_count: Array.isArray(safePayload.npc_ids) ? safePayload.npc_ids.length : 1,
      completed_at: new Date().toISOString(),
    };
  }

  if (type === 'embedding_index') {
    return {
      ok: true,
      jobType: type,
      mocked: true,
      indexed_documents: Array.isArray(safePayload.documents) ? safePayload.documents.length : 0,
      completed_at: new Date().toISOString(),
    };
  }

  if (type === 'sim_tick') {
    return {
      ok: true,
      jobType: type,
      mocked: true,
      tick_ms: Number(safePayload.tick_ms || 33),
      world_delta: { npc_updates: 0, events: 0 },
      completed_at: new Date().toISOString(),
    };
  }

  return {
    ok: false,
    jobType: type || 'unknown',
    mocked: true,
    error: `Unsupported local job type: ${type || 'unknown'}`,
    completed_at: new Date().toISOString(),
  };
}

const BUILTIN_SERVER_NODE_ID = 'f0000000-0000-4000-8000-000000000001';

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

async function resolveServerIdentityId(explicit = null) {
  const direct = String(explicit || process.env.DENIZEN_FLEET_IDENTITY_ID || '').trim();
  if (isUuid(direct)) return direct;

  if (!isEnabled()) return direct || 'server-builtin';

  const ceoEmail = String(process.env.DENIZEN_CEO_IDENTITY_EMAIL || '').trim();
  if (ceoEmail) {
    const byEmail = await denizenDb._get(
      `denizen_user_identities?select=id&email=eq.${encodeURIComponent(ceoEmail)}&limit=1`,
    ).catch(() => []);
    if (byEmail?.[0]?.id) return byEmail[0].id;
  }

  const onlineNodes = await denizenDb._get(
    `${NODE_TABLE}?select=identity_id&status=eq.online&order=last_heartbeat.desc&limit=1`,
  ).catch(() => []);
  if (onlineNodes?.[0]?.identity_id) return onlineNodes[0].identity_id;

  const anyIdentity = await denizenDb._get(
    'denizen_user_identities?select=id&order=created_at.desc&limit=1',
  ).catch(() => []);
  if (anyIdentity?.[0]?.id) return anyIdentity[0].id;

  throw new Error('no valid identity for server compute node');
}

/**
 * Ensure a fixed compute-node row exists for server-side job claiming (telemetry, etc.).
 * assigned_node_id on denizen_compute_jobs is a UUID FK — string labels like
 * "server-telemetry-primary" will fail PATCH with HTTP 400.
 */
async function ensureBuiltinServerNode({
  nodeId = BUILTIN_SERVER_NODE_ID,
  identityId = null,
} = {}) {
  const id = isUuid(nodeId) ? String(nodeId).trim() : BUILTIN_SERVER_NODE_ID;
  const now = new Date().toISOString();

  if (!isEnabled()) {
    const memIdentity = identityId || 'server-builtin';
    if (!getMemoryNode(id)) {
      saveMemoryNode({
        id,
        identity_id: memIdentity,
        node_profile_id: memoryProfileId(memIdentity),
        endpoint_token_hash: hashToken(`denizen-builtin-node:${id}`),
        status: 'online',
        last_heartbeat: now,
        jobs_completed: 0,
        reputation_score: 0,
      });
    }
    return id;
  }

  const existing = await denizenDb._get(
    `${NODE_TABLE}?select=id&limit=1&id=eq.${encodeURIComponent(id)}`,
  ).catch(() => []);
  if (existing?.[0]?.id) {
    await denizenDb._patch(
      `${NODE_TABLE}?id=eq.${encodeURIComponent(id)}`,
      { status: 'online', last_heartbeat: now },
      { prefer: 'return=minimal' },
    ).catch(() => {});
    return id;
  }

  const resolvedIdentity = await resolveServerIdentityId(identityId);
  if (!isUuid(resolvedIdentity)) {
    throw new Error('no valid identity for server compute node');
  }

  const profileId = await ensureNodeProfile(resolvedIdentity);
  let resolvedProfileId = profileId;
  if (!resolvedProfileId || String(resolvedProfileId).startsWith('mem-profile-')) {
    const sibling = await denizenDb._get(
      `${NODE_TABLE}?select=node_profile_id&identity_id=eq.${encodeURIComponent(resolvedIdentity)}&limit=1`,
    ).catch(() => []);
    resolvedProfileId = sibling?.[0]?.node_profile_id || null;
  }
  if (!resolvedProfileId || String(resolvedProfileId).startsWith('mem-profile-')) {
    throw new Error('node profile unavailable for server compute node');
  }

  const created = await denizenDb._post(
    NODE_TABLE,
    {
      id,
      identity_id: resolvedIdentity,
      node_profile_id: resolvedProfileId,
      endpoint_token_hash: hashToken(`denizen-builtin-node:${id}`),
      status: 'online',
      last_heartbeat: now,
      jobs_completed: 0,
      reputation_score: 0,
    },
    { prefer: 'return=representation' },
  );
  if (!created?.[0]?.id) throw new Error('server compute node insert returned empty');
  return created[0].id;
}

module.exports = {
  registerNode,
  heartbeat,
  goOffline,
  incrementJobsCompleted,
  processJobLocally,
  verifyNodeToken,
  verifyNodeTokenByIdentity,
  resolveNodeAuth,
  getNodeForIdentity,
  ensureBuiltinServerNode,
  resolveServerIdentityId,
  BUILTIN_SERVER_NODE_ID,
  isUuid,
  NODE_TABLE,
};
