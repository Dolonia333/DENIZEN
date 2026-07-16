'use strict';

/**
 * MCP / BYO-AI surface health summary (A-grade P3.2 ops visibility).
 *
 * Safe for public /api/health — never returns tokens, auth headers, or secrets.
 * Only presence flags, path shapes, and non-secret config counts.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MCP_SERVERS_FILE = path.join(ROOT, 'data', 'mcp-servers.json');
const MCP_SERVERS_EXAMPLE = path.join(ROOT, 'data', 'mcp-servers.json.example');

const PATHS = Object.freeze({
  npc: '/mcp/npc/:npcKey',
  team: '/mcp/team',
  oauthAuthorize: '/mcp/oauth/authorize',
  oauthToken: '/mcp/oauth/token',
  oauthRegister: '/mcp/oauth/register',
  oauthWellKnownResource: '/.well-known/oauth-protected-resource',
  oauthWellKnownServer: '/.well-known/oauth-authorization-server',
  tokens: '/api/mcp/tokens',
  teamTokens: '/api/mcp/team-tokens',
  connectInfo: '/api/mcp/connect-info',
  test: '/api/mcp/test',
});

/**
 * Light env probe — booleans and public URLs only (no secret values).
 * @returns {object}
 */
function probeMcpEnv() {
  const publicUrl = String(process.env.DENIZEN_PUBLIC_URL || '').trim();
  const denizenUrl = String(process.env.DENIZEN_URL || '').trim();
  const mcpUrl = String(process.env.DENIZEN_MCP_URL || '').trim();
  const rateRaw = process.env.DENIZEN_MCP_RATE_LIMIT;
  let rateLimit = null;
  if (rateRaw != null && String(rateRaw).trim() !== '') {
    const n = Number(rateRaw);
    if (Number.isFinite(n)) rateLimit = n;
  }

  const isLocal = (u) => !u || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(u);

  return {
    /** True when DENIZEN_PUBLIC_URL or DENIZEN_URL is a non-local base (OAuth-friendly). */
    publicUrlConfigured: !!(publicUrl || denizenUrl) && !isLocal(publicUrl || denizenUrl),
    publicBaseHint: (() => {
      const base = (publicUrl || denizenUrl || '').replace(/\/$/, '');
      if (!base) return null;
      if (isLocal(base)) return 'localhost';
      try {
        return new URL(base).host || null;
      } catch (_) {
        return null;
      }
    })(),
    /** Process has a local MCP token env (never return the value). */
    mcpTokenEnvPresent: !!(
      String(process.env.DENIZEN_MCP_TOKEN || '').trim()
      || String(process.env.DENIZEN_MCP_AUTH || '').trim()
    ),
    mcpUrlEnvPresent: !!mcpUrl,
    rateLimit,
  };
}

/**
 * Read data/mcp-servers.json (or note example) without leaking tokens in config.
 * @param {string} [root]
 * @returns {{ present: boolean, path: string, count: number, enabled: number, ids: string[], exampleOnly: boolean }}
 */
function readServersFromFile(root) {
  const base = root || ROOT;
  const file = path.join(base, 'data', 'mcp-servers.json');
  const example = path.join(base, 'data', 'mcp-servers.json.example');

  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const servers = Array.isArray(parsed?.servers) ? parsed.servers : [];
      return {
        present: true,
        path: 'data/mcp-servers.json',
        count: servers.length,
        enabled: servers.filter((s) => s && s.enabled !== false).length,
        ids: servers.map((s) => String(s?.id || '').trim()).filter(Boolean).slice(0, 32),
        exampleOnly: false,
      };
    }
  } catch (_) {
    return {
      present: false,
      path: 'data/mcp-servers.json',
      count: 0,
      enabled: 0,
      ids: [],
      exampleOnly: false,
      parseError: true,
    };
  }

  const hasExample = fs.existsSync(example);
  return {
    present: false,
    path: hasExample ? 'data/mcp-servers.json.example' : 'data/mcp-servers.json',
    count: 0,
    enabled: 0,
    ids: [],
    exampleOnly: hasExample,
  };
}

/**
 * Probe whether core MCP modules load (gateway surface is in-process).
 * @returns {{ npc: boolean, team: boolean, oauth: boolean, scopesCount: number }}
 */
function probeModules() {
  let npc = false;
  let team = false;
  let oauth = false;
  let scopesCount = 0;

  try {
    const g = require('./denizen-npc-mcp-gateway.js');
    npc = typeof g.handleHttpRequest === 'function' && typeof g.getPublicBaseUrl === 'function';
  } catch (_) {
    npc = false;
  }

  try {
    const t = require('./denizen-mcp-team-gateway.js');
    team = typeof t.handleHttpRequest === 'function';
  } catch (_) {
    team = false;
  }

  try {
    const o = require('./denizen-mcp-oauth.js');
    oauth = typeof o.handleOAuthRoute === 'function';
  } catch (_) {
    oauth = false;
  }

  try {
    const scopes = require('./denizen-mcp-scopes.js');
    scopesCount = Array.isArray(scopes.ALL_SCOPES) ? scopes.ALL_SCOPES.length : 0;
  } catch (_) {
    scopesCount = 0;
  }

  return { npc, team, oauth, scopesCount };
}

/**
 * Summarize MCP / BYO-AI surface for /api/health and harness status.
 *
 * @param {object} [opts]
 * @param {string} [opts.denizenRoot] — override repo root (tests)
 * @returns {{
 *   npcGateway: boolean,
 *   teamGateway: boolean,
 *   oauthConfigured: boolean,
 *   paths: object,
 *   scopesCount: number,
 *   serversFromFile: object,
 *   env: object,
 *   notes: string[],
 * }}
 */
function summarizeMcpSurface(opts = {}) {
  const root = opts.denizenRoot || ROOT;
  const modules = probeModules();
  const env = probeMcpEnv();
  const serversFromFile = readServersFromFile(root);

  const npcGateway = modules.npc === true;
  const teamGateway = modules.team === true;
  // OAuth is "configured" when the module is loadable and a non-local public base is set
  // (external Claude/Cursor OAuth needs a reachable redirect host).
  const oauthConfigured = modules.oauth === true && env.publicUrlConfigured === true;

  const notes = [];
  if (!npcGateway) notes.push('npc_gateway_module_missing');
  if (!teamGateway) notes.push('team_gateway_module_missing');
  if (!modules.oauth) notes.push('oauth_module_missing');
  else if (!env.publicUrlConfigured) {
    notes.push('oauth_needs_public_url'); // module ok; set DENIZEN_PUBLIC_URL for external clients
  }
  if (!serversFromFile.present) {
    if (serversFromFile.exampleOnly) notes.push('mcp_servers_json_missing_use_example');
    else if (serversFromFile.parseError) notes.push('mcp_servers_json_parse_error');
    else notes.push('mcp_servers_json_absent');
  } else if (serversFromFile.count === 0) {
    notes.push('mcp_servers_json_empty');
  } else if (serversFromFile.enabled === 0) {
    notes.push('mcp_servers_all_disabled');
  }
  if (modules.scopesCount === 0) notes.push('scopes_unavailable');
  if (!env.mcpTokenEnvPresent) {
    notes.push('no_local_mcp_token_env'); // fine on server; operators use office Connect AI
  }

  return {
    npcGateway,
    teamGateway,
    oauthConfigured,
    paths: { ...PATHS },
    scopesCount: modules.scopesCount,
    serversFromFile: {
      present: serversFromFile.present,
      path: serversFromFile.path,
      count: serversFromFile.count,
      enabled: serversFromFile.enabled,
      ids: serversFromFile.ids,
      exampleOnly: !!serversFromFile.exampleOnly,
    },
    env: {
      publicUrlConfigured: env.publicUrlConfigured,
      publicBaseHint: env.publicBaseHint,
      mcpTokenEnvPresent: env.mcpTokenEnvPresent,
      mcpUrlEnvPresent: env.mcpUrlEnvPresent,
      rateLimit: env.rateLimit,
    },
    notes,
  };
}

module.exports = {
  summarizeMcpSurface,
  probeMcpEnv,
  readServersFromFile,
  PATHS,
};
