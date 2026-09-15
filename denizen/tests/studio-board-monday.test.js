'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('studio-board store v2', () => {
  it('keeps activity and migrates config defaults', () => {
    const store = require('../src/denizen-studio-board-store');
    const clean = store.sanitizeState({
      tasks: [{ id: 'a', title: 'T' }],
      people: [],
      events: [],
      notes: [],
      templates: [],
      activity: [{ id: '1', ts: 1, who: 'A', text: 'hi' }],
      config: { categories: [{ id: 'x' }], stages: [{ id: 's' }] },
    });
    assert.equal(clean.activity.length, 1);
    assert.ok(Array.isArray(clean.config.columns));
    assert.ok(Array.isArray(clean.config.groups));
    assert.ok(Array.isArray(clean.config.automations));
    assert.ok(clean.config.acl);
    assert.equal(store.SCHEMA_VERSION, 2);
  });
});

describe('studio-board acl', () => {
  it('seeds owner and gates admin', () => {
    const acl = require('../src/denizen-studio-board-acl');
    const cfg = { acl: { owners: [], admins: [] } };
    acl.seedOwnerIfEmpty(cfg, { identityId: 'id-1' });
    assert.deepEqual(cfg.acl.owners, ['id-1']);
    assert.equal(acl.isAdmin(cfg, { identityId: 'id-1' }), true);
    assert.equal(acl.isAdmin(cfg, { identityId: 'other' }), false);
    const err = acl.requireAdmin(cfg, { identityId: 'other' });
    assert.ok(err);
    assert.equal(err.code, 'FORBIDDEN');
  });
});

describe('studio-board activity', () => {
  it('appends and caps activity', () => {
    const activity = require('../src/denizen-studio-board-activity');
    const state = { activity: [] };
    for (let i = 0; i < 210; i += 1) {
      activity.appendActivity(state, { who: 'X', text: `e${i}`, taskId: 't' });
    }
    assert.equal(state.activity.length, 200);
    assert.equal(state.activity[0].text, 'e209');
  });
});

describe('studio-board presence', () => {
  it('heartbeats and lists presence', () => {
    const presence = require('../src/denizen-studio-board-presence');
    const list = presence.heartbeat('org1', {
      displayName: 'Kaiser',
      identityId: 'k1',
      editingTaskId: 't1',
      editingTitle: 'Brief',
    });
    assert.ok(list.some((p) => p.display_name === 'Kaiser'));
    assert.equal(presence.list('org1')[0].editing_title, 'Brief');
  });
});

describe('studio-board automations', () => {
  it('fires notify on status_changed', () => {
    const automations = require('../src/denizen-studio-board-automations');
    const state = {
      config: {
        stages: [{ id: 'todo' }, { id: 'done', final: true }],
        automations: [{
          id: 'a1',
          name: 'Notify done',
          enabled: true,
          when: { type: 'status_changed', to: 'done' },
          then: [{ type: 'notify_assignee', text: 'Shipped' }],
        }],
      },
      people: [{ id: 'p1', name: 'Pat' }],
      tasks: [],
      notes: [],
      activity: [],
    };
    const task = {
      id: 't1',
      title: 'Job',
      assignee: 'p1',
      status: 'done',
      comments: [],
      fields: {},
    };
    state.tasks.push(task);
    const fired = automations.runRules(state, {
      kind: 'status_changed',
      task,
      from: 'todo',
      to: 'done',
      who: 'Test',
    });
    assert.ok(fired.length >= 1);
    assert.equal(state.notes.length, 1);
    assert.equal(state.notes[0].to, 'p1');
  });
});

describe('studio-board blockers cycle check', () => {
  it('detects cycles', () => {
    const mutations = require('../src/denizen-studio-board-mutations');
    const tasks = [
      { id: 'a', blockedBy: ['b'] },
      { id: 'b', blockedBy: [] },
    ];
    assert.equal(mutations.wouldCycle(tasks, 'b', ['a']), true);
    assert.equal(mutations.wouldCycle(tasks, 'b', ['c']), false);
  });
});

describe('studio-board MCP monday tools', () => {
  it('exposes columns timeline automations tools', () => {
    const tools = require('../src/denizen-mcp-studio-board-tools');
    assert.ok(tools.STUDIO_BOARD_TOOL_DEFINITIONS.length >= 30);
    assert.ok(tools.isStudioBoardTool('studio_board_list_columns'));
    assert.ok(tools.isStudioBoardTool('studio_board_timeline'));
    assert.ok(tools.isStudioBoardTool('studio_board_upsert_automation'));
    assert.ok(tools.isStudioBoardTool('studio_board_set_blockers'));
  });
});

describe('studio-board monday scopes', () => {
  it('maps new tools to scopes', () => {
    const scopes = require('../src/denizen-mcp-scopes');
    assert.equal(scopes.requiredScope('studio_board_timeline'), 'read');
    assert.equal(scopes.requiredScope('studio_board_list_columns'), 'read');
    assert.equal(scopes.requiredScope('studio_board_list_automations'), 'read');
    assert.equal(scopes.requiredScope('studio_board_upsert_column'), 'crm_write');
    assert.equal(scopes.requiredScope('studio_board_set_field'), 'crm_write');
    assert.equal(scopes.requiredScope('studio_board_upsert_automation'), 'crm_write');
  });
});
