'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const CofounderAgent = require('../src/cofounder-agent');

/** Agent parked in the scripted demo loop, with start/stop stubbed out. */
function demoLoopAgent(callLmStudio) {
  const agent = new CofounderAgent();
  agent._usingDemoLoop = true;
  agent._consecutiveErrors = 5;
  agent._callLmStudio = callLmStudio;
  agent._broadcast = () => {};
  agent.started = 0;
  agent.start = () => { agent.started += 1; agent._usingDemoLoop = false; };
  agent.stop = () => {};
  return agent;
}

describe('cofounder demo-loop recovery', () => {
  it('recovers when the model answers with director JSON instead of "OK"', async () => {
    // Real 2026-09-15 reply: llama-3.1-8b follows the director system prompt.
    const agent = demoLoopAgent(async () => '{"name": "speakTo", "parameters": {"target": "Alex", "text": "Hi"}}');
    assert.equal(await agent._tryRecoverFromDemoLoop(), true);
    assert.equal(agent._usingDemoLoop, false);
    assert.equal(agent._consecutiveErrors, 0);
    assert.equal(agent.started, 1);
    assert.equal(agent.buildDirectorHealth().offline, false);
  });

  it('recovers on a plain OK', async () => {
    const agent = demoLoopAgent(async () => 'OK');
    assert.equal(await agent._tryRecoverFromDemoLoop(), true);
  });

  it('stays in the demo loop on an empty reply', async () => {
    const agent = demoLoopAgent(async () => '   ');
    assert.equal(await agent._tryRecoverFromDemoLoop(), false);
    assert.equal(agent._usingDemoLoop, true);
    assert.equal(agent.started, 0);
  });

  it('stays in the demo loop while LM Studio is unreachable', async () => {
    const agent = demoLoopAgent(async () => { throw new Error('fetch failed'); });
    assert.equal(await agent._tryRecoverFromDemoLoop(), false);
    assert.equal(agent._usingDemoLoop, true);
    assert.equal(agent.buildDirectorHealth().offline, true);
  });
});

/** Parse a director reply and return the dispatched [action, agentId, params]. */
function dispatched(reply) {
  const agent = new CofounderAgent();
  const sent = [];
  agent._broadcast = (msg) => sent.push(msg);
  agent._parseAndDispatch(reply);
  return sent.map((m) => [m.action, m.agentId, m.params]);
}

describe('cofounder reply parsing', () => {
  it('keeps the requested array format working', () => {
    assert.deepEqual(
      dispatched('[{"action":"speakTo","agentId":"Abby","params":{"target":"Marcus","text":"Hi"}},'
        + '{"action":"callMeeting","agentId":"Abby","params":{"attendees":["Alex","Bob"]}}]'),
      [['speakTo', 'Abby', { target: 'Marcus', text: 'Hi' }],
        ['callMeeting', 'Abby', { attendees: ['Alex', 'Bob'] }]],
    );
  });

  it('keeps a single command object that contains an array', () => {
    assert.deepEqual(
      dispatched('{"name": "callMeeting", "parameters": {"attendees": ["Abby", "Marcus"]}}'),
      [['callMeeting', 'Abby', { attendees: ['Abby', 'Marcus'] }]],
    );
  });

  it("keeps a single command whose text contains '['", () => {
    assert.deepEqual(
      dispatched('{"name": "speakTo", "parameters": {"target": "Alex", "text": "Check the [auth] PR"}}'),
      [['speakTo', 'Abby', { target: 'Alex', text: 'Check the [auth] PR' }]],
    );
  });

  it("salvages back-to-back objects even when one contains '['", () => {
    assert.deepEqual(
      dispatched('{"name": "speakTo", "parameters": {"target": "Alex", "text": "Hi"}}\n'
        + '{"name": "callMeeting", "parameters": {"attendees": ["Alex"]}}'),
      [['speakTo', 'Abby', { target: 'Alex', text: 'Hi' }],
        ['callMeeting', 'Abby', { attendees: ['Alex'] }]],
    );
  });

  it('unwraps Llama tool-call nesting (parameters.agentId + parameters.params)', () => {
    assert.deepEqual(
      dispatched('{"name": "speakTo", "parameters": {"agentId": "Roki", "params": {"target": "Alex", "text": "Hey"}}}'),
      [['speakTo', 'Roki', { target: 'Alex', text: 'Hey' }]],
    );
  });

  it('maps speaker/listener to agentId/target', () => {
    assert.deepEqual(
      dispatched('{"name": "speakTo", "parameters": {"speaker": "Abby", "listener": "Roki", "text": "Status?"}}'),
      [['speakTo', 'Abby', { target: 'Roki', text: 'Status?' }]],
    );
  });

  it('still reads prose-wrapped arrays', () => {
    assert.deepEqual(
      dispatched('Sure, here you go:\n```json\n[{"action":"standUp","agentId":"Alex","params":{}}]\n```'),
      [['standUp', 'Alex', {}]],
    );
  });
});
