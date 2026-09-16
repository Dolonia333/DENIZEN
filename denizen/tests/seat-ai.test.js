'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const catalog = require('../src/seat-ai-catalog');
const contextDrop = require('../src/context-drop');

describe('seat-ai catalog', () => {
  it('lists Cursor, Claude, ChatGPT, Grok, and LM Studio desks', () => {
    const ids = catalog.PROVIDERS.map((p) => p.id);
    assert.ok(ids.includes('cursor'));
    assert.ok(ids.includes('claude'));
    assert.ok(ids.includes('chatgpt'));
    assert.ok(ids.includes('grok'));
    assert.ok(ids.includes('lmstudio'));
  });

  it('marks seated desks from MCP tokens', () => {
    const rows = catalog.providersWithStatus({
      tokens: [{ npc_key: 'claude' }, { npc_key: '_team', client_type: 'cursor' }],
    });
    const claude = rows.find((p) => p.id === 'claude');
    const cursor = rows.find((p) => p.id === 'cursor');
    assert.equal(claude.seated, true);
    assert.equal(cursor.seated, true);
  });

  it('builds crew seated vs empty from MCP presence', () => {
    const crew = catalog.buildCrewRows({
      roster: {
        entries: [
          { folder: 'claude', display: 'Claude' },
          { folder: 'lucy', display: 'Lucy' },
        ],
      },
      directives: [{ npc: 'Lucy', status: 'queued', task: 'Greet the visitor' }],
      presenceAtNpc: (key) => (key === 'claude' ? '2026-09-15T00:00:00.000Z' : null),
    });
    assert.equal(crew.find((c) => c.name === 'Claude').seated, true);
    assert.equal(crew.find((c) => c.name === 'Lucy').seated, false);
    assert.equal(crew.find((c) => c.name === 'Lucy').status, 'queued');
  });

  it('escalates the leash from circuit-breaker telemetry', () => {
    const stop = catalog.leashFromStats({
      errorRate: 0.5,
      topErrors: [{ category: 'circuit_breaker', count: 3 }],
      byNpc: {},
    });
    assert.equal(stop.state, 'stop');
    const ok = catalog.leashFromStats({ errorRate: 0, byNpc: {}, calls: 2 });
    assert.equal(ok.state, 'ok');
    assert.match(ok.note, /wait for you/i);
  });
});

describe('context-drop local capture path', () => {
  it('accepts a buzz-captures file and rejects paths outside that folder', () => {
    const dir = path.join(os.tmpdir(), 'buzz-captures');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'shot.png');
    fs.writeFileSync(file, Buffer.from('89504e470d0a1a0a', 'hex'));
    assert.equal(contextDrop.isAllowedBuzzCapturePath(file), true);
    assert.equal(contextDrop.isAllowedBuzzCapturePath('/etc/passwd'), false);
    const read = contextDrop.readLocalCapture(file);
    assert.equal(read.ok, true);
    assert.ok(read.attachment?.data);
  });

  it('keeps a missing local path on the directive instead of failing', async () => {
    const missing = path.join(os.tmpdir(), 'buzz-captures', `gone-${Date.now()}.png`);
    const assigned = [];
    const result = await contextDrop.handleContextDrop(
      { note: 'Look', kind: 'screenshot', localPath: missing },
      { assignDirective: (to, from, task) => { assigned.push(task); return { id: 'dir_path' }; } },
    );
    assert.equal(result.ok, true);
    assert.match(assigned[0], /sender's disk/);
  });
});
