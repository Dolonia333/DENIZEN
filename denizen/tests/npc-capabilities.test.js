'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const roster = require('../src/npc-roster.js');
const caps = require('../src/npc-capabilities.js');

describe('npc-capabilities', () => {
  it('covers every roster NPC', () => {
    for (const { display } of roster.entries) {
      const cap = caps.getCapabilities(display);
      assert.ok(cap, `missing capabilities for ${display}`);
      assert.ok(cap.canDo?.length >= 3, `${display} needs canDo items`);
      assert.ok(cap.teaser, `${display} needs teaser`);
    }
  });

  it('detects capability questions', () => {
    assert.equal(caps.isCapabilitiesQuestion('what can you do'), true);
    assert.equal(caps.isCapabilitiesQuestion('What are your capabilities?'), true);
    assert.equal(caps.isCapabilitiesQuestion('help'), true);
    assert.equal(caps.isCapabilitiesQuestion('fix the bug'), false);
  });

  it('formats a concrete reply per NPC', () => {
    const reply = caps.formatCapabilitiesReply('Alex');
    assert.match(reply, /Alex/i);
    assert.match(reply, /coding-agent|GitHub|bug/i);
  });

  it('Lucy reply mentions PC and jobs', () => {
    const reply = caps.formatCapabilitiesReply('Lucy');
    assert.match(reply, /email|PC|job/i);
  });
});
