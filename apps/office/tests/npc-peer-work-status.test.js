'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const peerStatus = require('../src/npc/npc-peer-work-status');

describe('npc-peer-work-status', () => {
  it('detects work-status queries', () => {
    assert.equal(peerStatus.isWorkStatusQuery('Did you finish the API?'), true);
    assert.equal(peerStatus.isWorkStatusQuery('Hey'), false);
    assert.equal(peerStatus.isWorkStatusQuery('Status on the homepage fix?'), true);
  });

  it('returns live task state instead of canned lines', () => {
    const brains = {
      _taskProgress: {
        Alex: { task: 'Wire auth endpoints', phase: 'in-progress', startedAt: '9:15' },
      },
      _officeRuntime() {
        return { lastDecisions: {} };
      },
      getDirective() { return null; },
      _directives: new Map(),
      _pendingSkillResults: new Map(),
    };
    const reply = peerStatus.buildWorkStatusReply(
      brains,
      'Alex',
      'Josh',
      'Did you finish the API endpoints?',
    );
    assert.match(reply, /Wire auth endpoints/);
    assert.match(reply, /Alex/);
  });

  it('reports another coworker when named in the question', () => {
    const brains = {
      _taskProgress: {
        Bob: { task: 'LLM memory research', phase: 'continuing' },
      },
      _officeRuntime() { return { lastDecisions: {} }; },
      getDirective() { return null; },
      _directives: new Map(),
      _pendingSkillResults: new Map(),
    };
    const reply = peerStatus.buildWorkStatusReply(
      brains,
      'Josh',
      'Abby',
      'How is Bob coming on the memory research?',
    );
    assert.match(reply, /LLM memory research/);
    assert.match(reply, /Bob/);
  });
});
