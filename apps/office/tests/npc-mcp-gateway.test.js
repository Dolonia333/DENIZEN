'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const gateway = require('../src/core/denizen-npc-mcp-gateway.js');
const mcpActions = require('../src/mcp/denizen-mcp-actions.js');
const denizenDb = require('../src/intelligence/denizen-db.js');

const SCOPE = {
  ok: true,
  token_id: 'tok-1',
  org_id: '11111111-1111-1111-1111-111111111111',
  org_slug: 'zion',
  npc_key: 'roki',
  member_id: null,
  session_id: 'sess-test-001',
};

describe('npc-mcp-gateway', () => {
  let origResolve;
  let origInsert;
  let origList;
  let origRecordFact;
  let origRecordWork;

  before(() => {
    origResolve = gateway.resolveToken;
    origInsert = denizenDb.insertNpcMemory;
    origList = denizenDb.listNpcMemories;
    origRecordFact = denizenDb.recordFact;
    origRecordWork = denizenDb.recordWorkOutput;

    gateway.configure({
      runNpcSkill: async (name, skill) => ({ ok: true, output: `${name} ran ${skill}`, npcName: name, skill }),
      npcBrains: {
        assignDirective: () => {},
        getDirective: () => null,
        getOpenCommitments: () => [],
      },
      broadcast: () => {},
      denizenVisitor: {
        listTeammatesWithPresence: async () => ([]),
        getPendingHandoffs: async () => ([]),
      },
      listOnlineSessionIds: () => new Set(),
    });

    gateway.resolveToken = async (token) => (token === 'good-token' ? SCOPE : null);
    denizenDb.enabled = true;
    denizenDb.insertNpcMemory = async (row) => ({
      id: 'mem-1',
      recorded_at: '2026-06-06T12:00:00Z',
      ...row,
    });
    denizenDb.listNpcMemories = async () => ([
      { body: 'Shipped MCP gateway', recorded_at: '2026-06-06T12:00:00Z', source: 'mcp' },
    ]);
    denizenDb._get = async (path) => {
      if (path.includes('denizen_npcs')) {
        return [{ npc_key: 'roki', display_name: 'Roki', protected: false }];
      }
      if (path.includes('denizen_work_output')) return [];
      return [];
    };
    denizenDb.recordFact = async () => 'fact-1';
    denizenDb.recordWorkOutput = () => {};
  });

  after(() => {
    gateway.resolveToken = origResolve;
    denizenDb.insertNpcMemory = origInsert;
    denizenDb.listNpcMemories = origList;
    denizenDb.recordFact = origRecordFact;
    denizenDb.recordWorkOutput = origRecordWork;
  });

  it('exports core MCP action tools', () => {
    assert.equal(gateway.TOOL_DEFINITIONS.length, 8);
    const names = gateway.TOOL_DEFINITIONS.map((t) => t.name);
    assert.ok(names.includes('run_skill'));
    assert.ok(names.includes('list_skills'));
    assert.ok(names.includes('assign_task'));
  });

  it('toolsForScope includes team tools for all NPCs', () => {
    const tools = gateway.toolsForScope(SCOPE);
    const names = tools.map((t) => t.name);
    assert.ok(names.includes('list_team'));
    assert.ok(names.includes('send_handoff'));
    assert.ok(names.includes('get_market_quote'));
  });

  it('toolsForScope includes CRM tools for Lucy', () => {
    const tools = gateway.toolsForScope({ ...SCOPE, npc_key: 'lucy' });
    const names = tools.map((t) => t.name);
    assert.ok(names.includes('crm_pipeline_brief'));
  });

  it('buildConnectInfo returns mcp url and tool list', () => {
    const info = gateway.buildConnectInfo('roki', 'http://localhost:8080');
    assert.equal(info.npc_key, 'roki');
    assert.equal(info.mcp_url, 'http://localhost:8080/mcp/npc/roki');
    assert.ok(info.tools.includes('update_memory'));
  });

  it('update_memory writes to DB and records fact', async () => {
    const result = await gateway.callTool(SCOPE, 'update_memory', { body: 'Test memory line' });
    assert.equal(result.ok, true);
    assert.equal(result.memory_id, 'mem-1');
  });

  it('get_status returns npc and enriched context', async () => {
    const result = await gateway.callTool(SCOPE, 'get_status', { limit: 5 });
    assert.equal(result.ok, true);
    assert.equal(result.npc.npc_key, 'roki');
    assert.equal(result.recent_mcp_memories.length, 1);
    assert.ok(Array.isArray(result.skills));
    assert.equal(result.session_linked, true);
  });

  it('log_activity records work output', async () => {
    let logged = false;
    denizenDb.recordWorkOutput = (row) => { logged = row.note === 'Reviewed PR'; };
    const result = await gateway.callTool(SCOPE, 'log_activity', { note: 'Reviewed PR' });
    assert.equal(result.ok, true);
    assert.equal(logged, true);
  });

  it('list_skills returns Rob design skills', async () => {
    const scope = { ...SCOPE, npc_key: 'rob' };
    const result = await gateway.callTool(scope, 'list_skills', {});
    assert.equal(result.ok, true);
    assert.ok(result.skills.includes('canvas-render'));
  });

  it('run_skill starts allowed skill', async () => {
    const scope = { ...SCOPE, npc_key: 'rob' };
    const result = await gateway.callTool(scope, 'run_skill', {
      skill: 'research',
      params: { query: 'mobile UX patterns' },
      wait: true,
    });
    assert.equal(result.ok, true);
    assert.match(result.output, /research/);
  });

  it('run_skill rejects disallowed skill', async () => {
    const scope = { ...SCOPE, npc_key: 'rob' };
    const result = await gateway.callTool(scope, 'run_skill', { skill: 'coding-agent' });
    assert.equal(result.ok, false);
    assert.ok(result.allowed);
  });

  it('assign_task queues directive', async () => {
    let assigned = false;
    gateway.configure({
      runNpcSkill: async (name, skill) => ({ ok: true, output: `${name} ran ${skill}`, npcName: name, skill }),
      npcBrains: {
        assignDirective: (to, from, task) => {
          if (to === 'Roki' && task.includes('mockup')) assigned = true;
        },
      },
      broadcast: () => {},
    });
    const result = await gateway.callTool(SCOPE, 'assign_task', { task: 'Review mockup' });
    assert.equal(result.ok, true);
    assert.equal(assigned, true);
  });

  it('rejects requests without bearer token', async () => {
    const server = http.createServer((req, res) => {
      gateway.handleHttpRequest(req, res, 'roki');
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/mcp/npc/roki`, { method: 'GET' });
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.match(body.error, /Bearer/i);

    await new Promise((resolve) => server.close(resolve));
  });

  it('GET with valid token returns tool manifest', async () => {
    const server = http.createServer((req, res) => {
      gateway.handleHttpRequest(req, res, 'roki');
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/mcp/npc/roki`, {
      method: 'GET',
      headers: { Authorization: 'Bearer good-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.tools.includes('get_status'));

    await new Promise((resolve) => server.close(resolve));
  });

  it('rejects token scoped to a different NPC', async () => {
    const server = http.createServer((req, res) => {
      gateway.handleHttpRequest(req, res, 'jenny');
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/mcp/npc/jenny`, {
      method: 'GET',
      headers: { Authorization: 'Bearer good-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 403);

    await new Promise((resolve) => server.close(resolve));
  });

  it('buildOpenApiSpec documents REST sync paths', () => {
    const spec = gateway.buildOpenApiSpec('http://localhost:8080');
    assert.equal(spec.openapi, '3.1.0');
    assert.ok(spec.paths['/api/npc-sync/status']);
    assert.ok(spec.paths['/api/npc-sync/memory']);
    assert.ok(spec.paths['/api/npc-sync/run-skill']);
    assert.ok(spec.paths['/api/npc-sync/assign-task']);
  });

  it('REST GET /status returns NPC status with bearer token', async () => {
    const server = http.createServer((req, res) => {
      gateway.handleRestSync(req, res, 'status');
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/api/npc-sync/status`, {
      headers: { Authorization: 'Bearer good-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.npc.npc_key, 'roki');

    await new Promise((resolve) => server.close(resolve));
  });

  it('REST POST /memory accepts note alias for ChatGPT', async () => {
    const server = http.createServer((req, res) => {
      gateway.handleRestSync(req, res, 'memory');
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/api/npc-sync/memory`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer good-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ note: 'ChatGPT-friendly memory line' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);

    await new Promise((resolve) => server.close(resolve));
  });

  it('REST POST /activity logs work', async () => {
    let logged = false;
    denizenDb.recordWorkOutput = (row) => { logged = row.note === 'Synced from REST'; };

    const server = http.createServer((req, res) => {
      gateway.handleRestSync(req, res, 'activity');
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/api/npc-sync/activity`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer good-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ note: 'Synced from REST' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(logged, true);

    await new Promise((resolve) => server.close(resolve));
  });

  it('read-only scope denies run_skill', async () => {
    const readScope = { ...SCOPE, scopes: ['read'] };
    const allowed = await gateway.callTool(readScope, 'get_status', { limit: 3 });
    assert.equal(allowed.ok, true);
    const denied = await gateway.callTool(readScope, 'run_skill', { skill: 'research' });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, 'scope_denied');
    assert.equal(denied.required_scope, 'skills');
  });

  it('toolsForScope hides tools outside granted scopes', () => {
    const readScope = { ...SCOPE, scopes: ['read'] };
    const names = gateway.toolsForScope(readScope).map((t) => t.name);
    assert.ok(names.includes('get_status'));
    assert.ok(!names.includes('run_skill'));
  });
});
