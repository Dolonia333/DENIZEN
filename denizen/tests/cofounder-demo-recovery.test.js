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
