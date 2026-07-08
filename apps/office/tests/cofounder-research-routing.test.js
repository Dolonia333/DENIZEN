'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const CofounderAgent = require('../src/compute/cofounder-agent');
const researchRouter = require('../src/intelligence/research-router');
const stationBridge = require('../src/station/denizen-station-skill-bridge');

describe('cofounder-agent prompt', () => {
  it('_getSystemPrompt does not throw with normal office state', () => {
    const agent = new CofounderAgent();
    agent.officeState = {
      agents: [{ name: 'Grok', role: 'Researcher', status: 'working', position: { x: 1, y: 2 } }],
      tasks: [{ id: 1, type: 'research', agent: 'Grok' }],
      time: '10:30',
    };
    const prompt = agent._getSystemPrompt();
    assert.match(prompt, /Grok/);
    assert.match(prompt, /JSON array ONLY/);
    assert.match(prompt, /output starts with '\['/);
  });
});

describe('research-router', () => {
  it('mesh backend when DENIZEN_RESEARCH_BACKEND=mesh', () => {
    const prev = process.env.DENIZEN_RESEARCH_BACKEND;
    try {
      process.env.DENIZEN_RESEARCH_BACKEND = 'mesh';
      assert.equal(researchRouter.researchBackend(), 'mesh');
    } finally {
      if (prev === undefined) delete process.env.DENIZEN_RESEARCH_BACKEND;
      else process.env.DENIZEN_RESEARCH_BACKEND = prev;
    }
  });
});

describe('station-skill-bridge', () => {
  it('routes research to web_search on desktop station', () => {
    const route = stationBridge.resolveStationRoute('research', { query: 'LM Studio network settings' });
    assert.equal(route.kind, 'web_search');
    assert.match(route.instruction, /LM Studio network settings/i);
  });
});
