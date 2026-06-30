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
});
