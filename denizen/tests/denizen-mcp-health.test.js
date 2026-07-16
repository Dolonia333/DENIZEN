'use strict';

/**
 * MCP / BYO-AI health surface (A-grade P3.2).
 * Pure unit tests — no network, no secrets asserted.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const mcpHealth = require('../src/denizen-mcp-health');
const { createDenizenHarness } = require('../src/denizen-harness');

const ROOT = path.join(__dirname, '..');

describe('summarizeMcpSurface()', () => {
  let prevPublic;
  let prevUrl;
  let prevToken;
  let prevAuth;
  let prevMcpUrl;
  let prevRate;

  before(() => {
    prevPublic = process.env.DENIZEN_PUBLIC_URL;
    prevUrl = process.env.DENIZEN_URL;
    prevToken = process.env.DENIZEN_MCP_TOKEN;
    prevAuth = process.env.DENIZEN_MCP_AUTH;
    prevMcpUrl = process.env.DENIZEN_MCP_URL;
    prevRate = process.env.DENIZEN_MCP_RATE_LIMIT;
  });

  after(() => {
    if (prevPublic === undefined) delete process.env.DENIZEN_PUBLIC_URL;
    else process.env.DENIZEN_PUBLIC_URL = prevPublic;
    if (prevUrl === undefined) delete process.env.DENIZEN_URL;
    else process.env.DENIZEN_URL = prevUrl;
    if (prevToken === undefined) delete process.env.DENIZEN_MCP_TOKEN;
    else process.env.DENIZEN_MCP_TOKEN = prevToken;
    if (prevAuth === undefined) delete process.env.DENIZEN_MCP_AUTH;
    else process.env.DENIZEN_MCP_AUTH = prevAuth;
    if (prevMcpUrl === undefined) delete process.env.DENIZEN_MCP_URL;
    else process.env.DENIZEN_MCP_URL = prevMcpUrl;
    if (prevRate === undefined) delete process.env.DENIZEN_MCP_RATE_LIMIT;
    else process.env.DENIZEN_MCP_RATE_LIMIT = prevRate;
  });

  it('returns expected shape with gateway flags and paths', () => {
    const s = mcpHealth.summarizeMcpSurface({ denizenRoot: ROOT });

    assert.equal(typeof s.npcGateway, 'boolean');
    assert.equal(typeof s.teamGateway, 'boolean');
    assert.equal(typeof s.oauthConfigured, 'boolean');
    assert.equal(s.npcGateway, true, 'npc gateway module should load');
    assert.equal(s.teamGateway, true, 'team gateway module should load');

    assert.ok(s.paths && typeof s.paths === 'object');
    assert.equal(s.paths.npc, '/mcp/npc/:npcKey');
    assert.equal(s.paths.team, '/mcp/team');
    assert.ok(s.paths.oauthAuthorize);
    assert.ok(s.paths.tokens);

    assert.equal(typeof s.scopesCount, 'number');
    assert.ok(s.scopesCount >= 1, 'ALL_SCOPES should be non-empty');

    assert.ok(s.serversFromFile && typeof s.serversFromFile === 'object');
    assert.equal(typeof s.serversFromFile.present, 'boolean');
    assert.equal(typeof s.serversFromFile.count, 'number');
    assert.equal(typeof s.serversFromFile.enabled, 'number');
    assert.ok(Array.isArray(s.serversFromFile.ids));

    assert.ok(s.env && typeof s.env === 'object');
    assert.equal(typeof s.env.publicUrlConfigured, 'boolean');
    assert.equal(typeof s.env.mcpTokenEnvPresent, 'boolean');
    assert.ok(Array.isArray(s.notes));
  });

  it('never leaks token or auth secret values', () => {
    process.env.DENIZEN_MCP_TOKEN = 'super-secret-token-xyz';
    process.env.DENIZEN_MCP_AUTH = 'Bearer super-secret-token-xyz';
    const s = mcpHealth.summarizeMcpSurface({ denizenRoot: ROOT });
    const json = JSON.stringify(s);
    assert.equal(json.includes('super-secret-token-xyz'), false);
    assert.equal(json.includes('Bearer '), false);
    assert.equal(s.env.mcpTokenEnvPresent, true);
  });

  it('oauthConfigured is false on localhost-only public URL', () => {
    process.env.DENIZEN_PUBLIC_URL = 'http://localhost:8080';
    delete process.env.DENIZEN_URL;
    const s = mcpHealth.summarizeMcpSurface({ denizenRoot: ROOT });
    assert.equal(s.env.publicUrlConfigured, false);
    assert.equal(s.oauthConfigured, false);
    assert.ok(s.notes.includes('oauth_needs_public_url'));
  });

  it('oauthConfigured is true when non-local public URL is set', () => {
    process.env.DENIZEN_PUBLIC_URL = 'https://denizen.dolonia.cloud';
    const s = mcpHealth.summarizeMcpSurface({ denizenRoot: ROOT });
    assert.equal(s.env.publicUrlConfigured, true);
    assert.equal(s.oauthConfigured, true);
    assert.equal(s.env.publicBaseHint, 'denizen.dolonia.cloud');
    assert.equal(s.notes.includes('oauth_needs_public_url'), false);
  });

  it('reads mcp-servers.json when present under denizenRoot', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-mcp-health-'));
    try {
      fs.mkdirSync(path.join(tmp, 'data'));
      fs.writeFileSync(
        path.join(tmp, 'data', 'mcp-servers.json'),
        JSON.stringify({
          servers: [
            { id: 'alpha', name: 'A', enabled: true },
            { id: 'beta', name: 'B', enabled: false },
          ],
        }),
        'utf8',
      );
      const s = mcpHealth.summarizeMcpSurface({ denizenRoot: tmp });
      assert.equal(s.serversFromFile.present, true);
      assert.equal(s.serversFromFile.count, 2);
      assert.equal(s.serversFromFile.enabled, 1);
      assert.deepEqual(s.serversFromFile.ids, ['alpha', 'beta']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('notes absent servers file when missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-mcp-health-'));
    try {
      fs.mkdirSync(path.join(tmp, 'data'));
      const s = mcpHealth.summarizeMcpSurface({ denizenRoot: tmp });
      assert.equal(s.serversFromFile.present, false);
      assert.ok(
        s.notes.includes('mcp_servers_json_absent')
          || s.notes.includes('mcp_servers_json_missing_use_example'),
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('exposes rateLimit from env as number only', () => {
    process.env.DENIZEN_MCP_RATE_LIMIT = '99';
    const s = mcpHealth.summarizeMcpSurface({ denizenRoot: ROOT });
    assert.equal(s.env.rateLimit, 99);
  });
});

describe('harness status includes optional mcp', () => {
  it('status().mcp mirrors summarizeMcpSurface fields', async () => {
    const h = createDenizenHarness({ denizenRoot: ROOT });
    const s = await h.status();
    assert.ok(s.mcp, 'mcp optional field should be present when module loads');
    assert.equal(typeof s.mcp.npcGateway, 'boolean');
    assert.equal(typeof s.mcp.teamGateway, 'boolean');
    assert.equal(typeof s.mcp.oauthConfigured, 'boolean');
    assert.equal(typeof s.mcp.scopesCount, 'number');
    assert.ok(s.mcp.paths);
    assert.ok(s.mcp.serversFromFile);
    assert.ok(Array.isArray(s.mcp.notes));
  });
});
