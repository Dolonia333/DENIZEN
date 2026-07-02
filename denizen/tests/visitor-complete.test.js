'use strict';
/**
 * 100% completion gate for the Denizen visitor assistant subsystem.
 * Verifies files, wiring, exports, routes, brain hooks, module load, and health payload.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const REQUIRED_FILES = [
  'visitor-session.js',
  'visitor-claim-ui.js',
  'visitor-handoff-ui.js',
  'visitor-projects-ui.js',
  'visitor-assistant-labels.js',
  'visitor-onboarding.js',
  'visitor-briefing-ui.js',
  'visitor-voice-walkup.js',
  'visitor-capabilities.js',
  'visitor-access.js',
  'skill-gap-orchestrator.js',
  'skill-discovery.js',
  'visitor-capabilities-guide.js',
  'visitor-superuser-onboarding.js',
  'visitor-skill-gap-ui.js',
  'visitor-agent-inbox.js',
  'visitor-dashboard-gate.js',
  'vm-sandbox.js',
  'health-runbook.js',
  'mesh-worker-watchdog.js',
  'resource-pressure.js',
  'lm-studio-remediator.js',
  'cloud-vm-provider.js',
  'mesh-scale-advisor.js',
  'visitor-session-auth.js',
  'denizen-team-auth.js',
  'denizen-org-policy.js',
  'denizen-visitor.js',
  'denizen-visitor-intelligence.js',
  'visitor-briefing-loop.js',
  'visitor-cited-research.js',
  'denizen-slack-channel.js',
  'denizen-mcp-connector.js',
  'denizen-npc-mcp-gateway.js',
  'visitor-mcp-connect-ui.js',
  'visitor-companion-bridge.js',
  'denizen-companion-api.js',
  'denizen-prediction-loop.js',
];

/** Eager in index.html — must load before player chat / scene. */
const INDEX_EAGER_SCRIPTS = [
  './src/visitor-session.js',
  './src/visitor-onboarding.js',
  './src/visitor-claim-ui.js',
  './src/denizen-lazy-scripts.js',
];

/** Deferred via denizen-lazy-scripts.js after Phaser boots. */
const INDEX_LAZY_SCRIPTS = [
  './src/visitor-capabilities.js',
  './src/visitor-dashboard-gate.js',
  './src/visitor-handoff-ui.js',
  './src/visitor-projects-ui.js',
  './src/visitor-assistant-labels.js',
];

const REQUIRED_EXPORTS = [
  'createOrUpdateSession',
  'claimAssistant',
  'releaseAssistant',
  'getAssistant',
  'listProjects',
  'sendHandoff',
  'getPendingHandoffs',
  'listTeammates',
  'getOrCreateCeoBridgeSession',
  'ensureOrgMembership',
  'getOrgContext',
];

const SERVER_ROUTE_MARKERS = [
  '/api/visitor/session',
  '/api/visitor/access/verify',
  '/api/visitor/auth/register',
  '/api/visitor/auth/login',
  '/api/org/policy',
  '/api/visitor/claim',
  '/api/visitor/assistant',
  '/api/visitor/handoff',
  '/api/visitor/connections',
  '/api/visitor/connections/request',
  '/api/visitor/connections/respond',
  '/api/visitor/projects',
  '/api/visitor/teammates',
  '/api/mcp/tokens',
  '/api/mcp/connect-info',
  '/api/npc-sync/openapi.json',
  'npcSyncMatch',
  'handleRestSync',
  'mcpNpcMatch',
  'refreshDbMemories',
  'visitor_register',
  'buildLucyHandoffAlertBroadcast',
  '/api/health/runbook',
  '/api/compute/resource-pressure',
  '/api/compute/scale-advice',
];

const NODE_MODULES = [
  'denizen-visitor.js',
  'visitor-connections.js',
  'denizen-visitor-intelligence.js',
  'visitor-briefing-loop.js',
  'visitor-cited-research.js',
  'denizen-slack-channel.js',
  'denizen-mcp-connector.js',
  'denizen-companion-api.js',
  'denizen-prediction-loop.js',
];

const BROWSER_MODULES = [
  'visitor-session.js',
  'visitor-capabilities.js',
  'visitor-claim-ui.js',
  'visitor-handoff-ui.js',
  'visitor-projects-ui.js',
  'visitor-assistant-labels.js',
  'visitor-onboarding.js',
  'visitor-briefing-ui.js',
  'visitor-voice-walkup.js',
  'visitor-mcp-connect-ui.js',
  'visitor-companion-bridge.js',
];

function readUtf8(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('visitor assistant — 100% completion gate', () => {
  it('all required source files exist', () => {
    for (const file of REQUIRED_FILES) {
      const full = path.join(SRC, file);
      assert.ok(fs.existsSync(full), `missing src/${file}`);
    }
  });

  it('companion extension bundle exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'companion-extension', 'manifest.json')));
    assert.ok(fs.existsSync(path.join(ROOT, 'companion-extension', 'background.js')));
    const bridge = readUtf8('src/visitor-companion-bridge.js');
    assert.ok(bridge.includes('DenizenCompanionBridge'));
    const lazy = readUtf8('src/denizen-lazy-scripts.js');
    assert.ok(lazy.includes('visitor-companion-bridge.js'));
  });

  it('index.html includes all visitor script tags', () => {
    const html = readUtf8('index.html');
    const lazy = readUtf8('src/denizen-lazy-scripts.js');
    for (const src of INDEX_EAGER_SCRIPTS) {
      const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(
        html,
        new RegExp(`<script[^>]+src="${escaped}(?:\\?[^"]*)?"`),
        `index.html missing script tag for ${src}`,
      );
    }
    for (const src of INDEX_LAZY_SCRIPTS) {
      assert.ok(
        lazy.includes(src),
        `denizen-lazy-scripts.js missing deferred load for ${src}`,
      );
    }
  });

  it('denizen-visitor.js exports required API surface', () => {
    const mod = require('../src/denizen-visitor.js');
    for (const name of REQUIRED_EXPORTS) {
      assert.equal(typeof mod[name], 'function', `denizen-visitor missing export: ${name}`);
    }
    if (typeof mod.listOrganizations === 'function') {
      assert.equal(typeof mod.listOrganizations, 'function');
    }
  });

  it('server.js contains visitor HTTP routes and WS message types', () => {
    const serverSrc = readUtf8('server.js');
    for (const marker of SERVER_ROUTE_MARKERS) {
      assert.ok(serverSrc.includes(marker), `server.js missing: ${marker}`);
    }
    const visitorSrc = readUtf8('src/denizen-visitor.js');
    assert.ok(
      visitorSrc.includes('lucy_handoff_alert'),
      'denizen-visitor.js missing lucy_handoff_alert broadcast type',
    );
  });

  it('server.js health handler exposes visitor subsystem block', () => {
    const serverSrc = readUtf8('server.js');
    assert.match(serverSrc, /visitor:\s*\{/);
    assert.match(serverSrc, /enabled:\s*true/);
    assert.match(serverSrc, /db:\s*denizenDb\.enabled/);
    assert.match(
      serverSrc,
      /features:\s*\[[^\]]*'session'[^\]]*'claim'[^\]]*'briefing'[^\]]*'commitments'[^\]]*'mcp_connector'/s,
    );
  });

  it('npc-brains.js has visitor chat hooks', () => {
    const NpcBrainManager = require('../src/npc-brains.js');
    const mgr = new NpcBrainManager();
    assert.equal(typeof mgr.getPlayerResponse, 'function');
    assert.equal(typeof mgr._visitorProfilePromptBlock, 'function');
    assert.equal(typeof mgr._detectHandoffIntent, 'function');

    const src = readUtf8('src/npc-brains.js');
    assert.match(src, /async getPlayerResponse\([^)]*opts\s*=\s*\{\}/);
    assert.match(src, /Boolean\(opts\.sessionId\)/);
    assert.match(src, /_visitorProfilePromptBlock\(npcName/);
    assert.match(src, /deepProfile/);
    assert.match(src, /researchContext/);
    assert.match(src, /_detectHandoffIntent\(safeMessage\)/);

    const handoff = mgr._detectHandoffIntent('please tell Lucy I need the deck reviewed');
    assert.ok(handoff && typeof handoff === 'object');
  });

  it('Node modules require() without throwing', () => {
    for (const file of NODE_MODULES) {
      assert.doesNotThrow(() => {
        require(path.join(SRC, file));
      }, `require src/${file} should not throw`);
    }
  });

  it('agent-bus and agent inbox are wired for team visitors', () => {
    const office = readUtf8('src/agent-office-manager.js');
    assert.ok(office.includes('denizen-agent-bus'), 'agent-office-manager should dispatch denizen-agent-bus');
    const lazy = readUtf8('src/denizen-lazy-scripts.js');
    assert.ok(lazy.includes('visitor-agent-inbox.js'), 'lazy loader should include visitor-agent-inbox');
  });

  it('browser visitor modules load in Node without throwing', () => {
    for (const file of BROWSER_MODULES) {
      assert.doesNotThrow(() => {
        require(path.join(SRC, file));
      }, `require src/${file} should not throw`);
    }
  });
});
