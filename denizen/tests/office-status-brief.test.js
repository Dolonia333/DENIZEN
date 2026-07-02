'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const officeStatus = require('../src/office-status-brief');

describe('office-status-brief', () => {
  it('detects office-wide status questions', () => {
    assert.equal(officeStatus.isOfficeStatusQuery('can you give a summary of what everyone is doing?'), true);
    assert.equal(officeStatus.isOfficeStatusQuery('what is the team working on'), true);
    assert.equal(officeStatus.isOfficeStatusQuery('hello'), false);
  });

  it('builds a brief from live npc state', () => {
    const ws = {
      npcs: {
        Alex: { state: 'working', currentTask: 'Wire auth endpoints', room: 'open_office' },
        Josh: { state: 'idle', room: 'open_office' },
      },
      environment: {},
      backgroundTasks: [],
      recentEvents: [],
    };
    const brief = officeStatus.buildBrief(ws);
    assert.match(brief, /Alex/);
    assert.match(brief, /Wire auth endpoints/);
  });

  it('detects find-abby queries and builds visit action', () => {
    const ws = {
      npcs: {
        Abby: { state: 'working', currentTask: 'Sprint review', room: 'manager_office', position: { x: 1000, y: 120 } },
      },
    };
    assert.equal(officeStatus.isNpcFindQuery('go check on abby the cto'), true);
    const find = officeStatus.buildNpcFindReply(ws, 'where is Abby');
    assert.ok(find);
    assert.match(find.text, /Abby/);
    assert.match(find.text, /manager office/i);
    assert.equal(find.actions[0].action, 'visitCoworker');
  });
});
