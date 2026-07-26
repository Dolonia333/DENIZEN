'use strict';

const { resolveRole } = require('./denizen-world-pubsub');

/** Client → server WS types that mutate sim state (blocked on followers). */
const MUTATING_CLIENT_TYPES = new Set([
  'player_chat',
  'player_chat_cancel',
  'npc_conversation',
  'npc_think',
  'npc_assign_directive',
  'agent_command',
  'spawn_agent',
  'assign_task',
  'place_furniture',
  'remove_furniture',
  // Bouncer WS triggers reach real WSL command execution — a read-only
  // spectate follower must never be able to fire them.
  'bouncer_run_tool',
  'bouncer_run_linux',
]);

function isFollowerRole(env = process.env) {
  return resolveRole(env) === 'follower';
}

function isStandbyRole(env = process.env) {
  return resolveRole(env) === 'standby';
}

function isRelayOnlyRole(env = process.env) {
  const role = resolveRole(env);
  return role === 'follower' || role === 'standby';
}

function isMutatingClientMessage(msg) {
  const type = msg && typeof msg === 'object' ? String(msg.type || '') : '';
  return MUTATING_CLIENT_TYPES.has(type);
}

function resolvePrimaryBaseUrl(env = process.env) {
  const explicit = String(env.DENIZEN_PRIMARY_URL || '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const port = String(env.DENIZEN_PRIMARY_PORT || '8888').trim();
  return `http://127.0.0.1:${port}`;
}

function resolveSpectateWsUrl(env = process.env) {
  const pool = String(env.DENIZEN_SPECTATE_WS_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (pool.length > 1) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const explicit = String(env.DENIZEN_SPECTATE_WS_URL || '').trim();
  if (explicit) return explicit;
  const publicBase = String(env.DENIZEN_SPECTATE_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (publicBase) {
    const wsBase = publicBase.replace(/^http/i, 'ws');
    return `${wsBase}/agent-ws`;
  }
  return null;
}

function resolveSpectateWsPool(env = process.env) {
  const pool = String(env.DENIZEN_SPECTATE_WS_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (pool.length) return pool.filter(isPublicSpectateWsUrl);
  const single = resolveSpectateWsUrl(env);
  return single && isPublicSpectateWsUrl(single) ? [single] : [];
}

function isPublicSpectateWsUrl(url) {
  if (!url) return false;
  if (/^wss:\/\//i.test(url)) return true;
  return !/^(ws:\/\/)?(127\.|192\.168\.|10\.|localhost)/i.test(url);
}

function buildRuntimePublicConfig(env = process.env) {
  const spectateWsUrl = resolveSpectateWsUrl(env);
  const spectatePool = resolveSpectateWsPool(env);
  const spectateLanUrl = spectateWsUrl && !isPublicSpectateWsUrl(spectateWsUrl) ? spectateWsUrl : null;
  const publicSpectateUrl = spectatePool[0] || (spectateWsUrl && isPublicSpectateWsUrl(spectateWsUrl) ? spectateWsUrl : null);
  const role = resolveRole(env);
  return {
    ok: true,
    serverRole: role,
    spectateWsUrl: publicSpectateUrl,
    spectateWsUrls: spectatePool.length ? spectatePool : (publicSpectateUrl ? [publicSpectateUrl] : []),
    spectateLanUrl,
    spectateEnabled: spectatePool.length > 0 || !!publicSpectateUrl,
    publicDemo: env.DENIZEN_PUBLIC_DEMO === 'true',
    readOnlyDemo: env.DENIZEN_PUBLIC_DEMO === 'true',
    maxWsClients: Number(env.DENIZEN_MAX_WS_CLIENTS) || null,
  };
}

async function fetchPrimaryWorldSnapshot(env = process.env) {
  const base = resolvePrimaryBaseUrl(env);
  const res = await fetch(`${base}/api/world-state`, {
    method: 'GET',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`primary world-state HTTP ${res.status}`);
  }
  return res.json();
}

function relayReadonlyError(message = 'Spectator node is read-only — use the main site to chat.') {
  return {
    type: 'spectate_readonly',
    ok: false,
    message,
  };
}

module.exports = {
  MUTATING_CLIENT_TYPES,
  isFollowerRole,
  isStandbyRole,
  isRelayOnlyRole,
  isMutatingClientMessage,
  resolvePrimaryBaseUrl,
  resolveSpectateWsUrl,
  buildRuntimePublicConfig,
  fetchPrimaryWorldSnapshot,
  relayReadonlyError,
};
