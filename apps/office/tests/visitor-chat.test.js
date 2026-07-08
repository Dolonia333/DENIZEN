'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const origHome = process.env.HOME;
const origUser = process.env.USERPROFILE;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-visitor-test-'));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const NpcBrainManager = require('../src/npc-brains.js');

let mgr;

before(() => {
  mgr = new NpcBrainManager();
});

after(() => {
  if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
  if (origUser === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origUser;
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
});

describe('visitor chat context', () => {
  const visitorOpts = {
    sessionId: 'sess-aaa',
    displayName: 'Jordan',
    assistant: {
      npc_key: 'pier',
      assistant_name: 'Pier',
      focus: 'data pipelines',
      role_overlay: 'analytics lead',
    },
  };

  it('_greetingReply uses visitor assistant greeting when assistant matches NPC', () => {
    const reply = mgr._greetingReply('Pier', mgr._hierarchy.Pier, visitorOpts);
    assert.match(reply, /Hey Jordan/);
    assert.match(reply, /your assistant/i);
  });

  it('_greetingReply keeps CEO Lucy greeting when no opts', () => {
    const reply = mgr._greetingReply('Lucy', mgr._hierarchy.Lucy);
    assert.match(reply, /search|browser|dig/i);
    assert.doesNotMatch(reply, /Jordan/);
  });

  it('_visitorProfilePromptBlock includes visitor name, focus, and role overlay', () => {
    const block = mgr._visitorProfilePromptBlock('Pier', visitorOpts);
    assert.match(block, /Jordan/);
    assert.match(block, /not the CEO/i);
    assert.match(block, /data pipelines/);
    assert.match(block, /analytics lead/);
    assert.match(block, /THEIR personal assistant/i);
  });

  it('_visitorProfilePromptBlock includes projects', () => {
    const block = mgr._visitorProfilePromptBlock('Pier', {
      ...visitorOpts,
      projects: [
        { name: 'RFP Tracker', status: 'active', notes: 'Due Friday' },
        { name: 'Pipeline Audit', status: 'blocked', notes: 'Waiting on Edward' },
      ],
    });
    assert.match(block, /Their active projects/i);
    assert.match(block, /RFP Tracker \[active\] Due Friday/);
    assert.match(block, /Pipeline Audit \[blocked\] Waiting on Edward/);
  });

  it('_detectHandoffIntent parses "tell Lucy about the RFP"', () => {
    const handoff = mgr._detectHandoffIntent('tell Lucy about the RFP');
    assert.ok(handoff);
    assert.equal(handoff.toCeo, true);
    assert.equal(handoff.toDisplayName, 'Lucy');
    assert.match(handoff.message, /RFP/i);
  });

  it('_detectHandoffIntent returns null for normal chat', () => {
    assert.equal(mgr._detectHandoffIntent('can you summarize the sprint board?'), null);
  });

  it('visitor memories are isolated per sessionId', () => {
    mgr._pushVisitorMemory('sess-aaa', 'Pier', 'Jordan', 'hello pier');
    mgr._pushVisitorMemory('sess-bbb', 'Pier', 'Sam', 'hey pier');

    const memA = mgr._getVisitorMemories('sess-aaa', 'Pier');
    const memB = mgr._getVisitorMemories('sess-bbb', 'Pier');

    assert.equal(memA.length, 1);
    assert.equal(memB.length, 1);
    assert.equal(memA[0].from, 'Jordan');
    assert.equal(memB[0].from, 'Sam');
    assert.notEqual(memA[0].text, memB[0].text);
  });

  it('getPlayerResponse greeting stores visitor memory, not global CEO memory', async () => {
    const beforeGlobal = (mgr.memories.Pier || []).length;
    const result = await mgr.getPlayerResponse('Pier', 'hi', visitorOpts);

    assert.match(result.text, /Hey Jordan/);
    const visitorMem = mgr._getVisitorMemories('sess-aaa', 'Pier');
    assert.ok(visitorMem.length >= 2);
    assert.equal(visitorMem[0].from, 'Jordan');
    assert.equal((mgr.memories.Pier || []).length, beforeGlobal);
  });

  it('_recordAssistantDecision skips global profile for visitor session', () => {
    const before = (mgr._assistantProfile.recentDecisions || []).length;
    mgr._recordAssistantDecision('Pier', {
      action: 'chat',
      summary: 'visitor test',
      outcome: 'ok',
    }, { sessionId: 'sess-aaa' });
    const after = (mgr._assistantProfile.recentDecisions || []).length;
    assert.equal(before, after);
  });

  it('_isVisitorAssistantForNpc matches folder npc_key and display name', () => {
    assert.equal(mgr._isVisitorAssistantForNpc('Pier', { npc_key: 'pier' }), true);
    assert.equal(mgr._isVisitorAssistantForNpc('Pier', { npc_key: 'Pier' }), true);
    assert.equal(mgr._isVisitorAssistantForNpc('Lucy', { npc_key: 'pier' }), false);
  });
});
