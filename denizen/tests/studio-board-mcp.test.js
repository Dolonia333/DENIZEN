'use strict';

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

describe('studio-board store sanitize', () => {
  it('keeps known keys and drops junk', () => {
    const store = require('../src/denizen-studio-board-store');
    const clean = store.sanitizeState({
      tasks: [{ id: 'a', title: 'T' }],
      people: [{ id: 'p', name: 'Pat' }],
      events: [],
      notes: [],
      templates: [],
      config: { categories: [{ id: 'x', label: 'X' }], stages: [{ id: 's', label: 'S' }] },
      hacker: true,
      deals: [{ id: 1 }],
    });
    assert.equal(clean.tasks.length, 1);
    assert.equal(clean.people[0].name, 'Pat');
    assert.equal(clean.config.categories[0].id, 'x');
    assert.equal(clean.hacker, undefined);
    assert.equal(clean.deals, undefined);
  });
});

describe('studio-board mutations working set', () => {
  it('counts open / overdue / stuck', () => {
    const mutations = require('../src/denizen-studio-board-mutations');
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const state = {
      config: {
        stages: [
          { id: 'todo', label: 'To do' },
          { id: 'blocked', label: 'Blocked', blocked: true },
          { id: 'done', label: 'Done', final: true },
        ],
        categories: [{ id: 'gen', label: 'General' }],
      },
      people: [{ id: 'p1', name: 'Alex' }],
      tasks: [
        { id: '1', title: 'Open', status: 'todo', due: yesterday },
        { id: '2', title: 'Stuck', status: 'blocked' },
        { id: '3', title: 'Done', status: 'done', due: yesterday },
      ],
      events: [],
      notes: [],
      templates: [],
    };
    const ws = mutations.buildWorkingSet(state);
    assert.equal(ws.counts.open, 2);
    assert.equal(ws.counts.overdue, 1);
    assert.equal(ws.counts.stuck, 1);
    assert.equal(ws.overdue[0].title, 'Open');
    assert.ok(today);
  });
});

describe('studio-board MCP tools', () => {
  it('exposes tools for team and office NPCs', () => {
    const tools = require('../src/denizen-mcp-studio-board-tools');
    assert.ok(tools.STUDIO_BOARD_TOOL_DEFINITIONS.length >= 8);
    assert.ok(tools.isStudioBoardTool('studio_board_working_set'));
    assert.ok(tools.toolsForNpc('_team').length >= 8);
    assert.ok(tools.toolsForNpc('josh').length >= 8);
    assert.equal(tools.toolsForNpc('bouncer').length, 0);
  });

  it('callTool fails closed without org', async () => {
    const tools = require('../src/denizen-mcp-studio-board-tools');
    const res = await tools.callTool({ npc_key: 'josh' }, 'studio_board_working_set', {});
    assert.equal(res.ok, false);
    assert.match(String(res.error), /org_id/i);
  });
});

describe('studio-board scopes', () => {
  it('maps studio board tools into read / crm_write scopes', () => {
    const scopes = require('../src/denizen-mcp-scopes');
    assert.equal(scopes.requiredScope('studio_board_working_set'), 'read');
    assert.equal(scopes.requiredScope('studio_board_upsert_task'), 'crm_write');
    assert.equal(scopes.requiredScope('studio_board_advance_task'), 'crm_write');
  });
});
