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
    assert.ok(tools.STUDIO_BOARD_TOOL_DEFINITIONS.length >= 20);
    assert.ok(tools.isStudioBoardTool('studio_board_working_set'));
    assert.ok(tools.isStudioBoardTool('studio_board_upsert_event'));
    assert.ok(tools.isStudioBoardTool('studio_board_my_day'));
    assert.ok(tools.isStudioBoardTool('studio_board_standup'));
    assert.ok(tools.toolsForNpc('_team').length >= 20);
    assert.ok(tools.toolsForNpc('josh').length >= 20);
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
    assert.equal(scopes.requiredScope('studio_board_list_events'), 'read');
    assert.equal(scopes.requiredScope('studio_board_my_day'), 'read');
    assert.equal(scopes.requiredScope('studio_board_standup'), 'read');
    assert.equal(scopes.requiredScope('studio_board_upsert_task'), 'crm_write');
    assert.equal(scopes.requiredScope('studio_board_delete_task'), 'crm_write');
    assert.equal(scopes.requiredScope('studio_board_upsert_event'), 'crm_write');
    assert.equal(scopes.requiredScope('studio_board_add_subtask'), 'crm_write');
    assert.equal(scopes.requiredScope('studio_board_send_note'), 'crm_write');
    assert.equal(scopes.requiredScope('studio_board_update_config'), 'crm_write');
  });
});

describe('studio-board standup + events helpers', () => {
  it('builds standup text and upcoming events', () => {
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
      people: [{ id: 'p1', name: 'Kaiser', email: 'info@example.com' }],
      tasks: [
        { id: '1', title: 'Late', status: 'todo', due: yesterday, assignee: 'p1' },
        { id: '2', title: 'Today', status: 'todo', due: today, assignee: 'p1' },
        { id: '3', title: 'Blocked', status: 'blocked', assignee: 'p1', blockReason: 'waiting' },
      ],
      events: [
        { id: 'e1', kind: 'meeting', title: 'Kickoff', date: today, time: '10:00' },
      ],
      notes: [],
      templates: [],
    };
    const text = mutations.standupText(state);
    assert.match(text, /OVERDUE/);
    assert.match(text, /Late/);
    assert.match(text, /Kickoff/);
    const ws = mutations.buildWorkingSet(state);
    assert.ok(Array.isArray(ws.upcoming_events));
    assert.ok(ws.upcoming_events.some((e) => e.title === 'Kickoff'));
  });
});
