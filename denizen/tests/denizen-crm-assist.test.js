'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeWorkspace, crmAssist } = require('../src/denizen-crm-assist');

describe('denizen-crm-assist', () => {
  it('summarizeWorkspace counts pipeline metrics', () => {
    const summary = summarizeWorkspace({
      contacts: [{ id: 1 }],
      deals: [
        { id: 1, title: 'A', stage: 'Proposal', value: 1000, probability: 50, health: 'good' },
        { id: 2, title: 'B', stage: 'Closed Won', value: 500, probability: 100 },
      ],
      tasks: [{ id: 1, done: false }, { id: 2, done: true }],
    });
    assert.equal(summary.contactCount, 1);
    assert.equal(summary.openDealCount, 1);
    assert.equal(summary.pendingTaskCount, 1);
    assert.equal(summary.pipelineValue, 1000);
  });

  it('falls back to rules when no LLM provider', async () => {
    const result = await crmAssist(null, 'summarize my pipeline', {
      deals: [{ id: 1, title: 'X', stage: 'Lead', value: 2000, probability: 20 }],
      tasks: [],
      contacts: [],
    });
    assert.equal(result.source, 'rules');
    assert.match(result.reply, /open deal/i);
  });

  it('uses NPC persona in rules fallback', async () => {
    const result = await crmAssist(null, 'summarize my pipeline', {
      deals: [{ id: 1, title: 'X', stage: 'Lead', value: 2000, probability: 20 }],
      tasks: [],
      contacts: [],
    }, { npcKey: 'lucy' });
    assert.equal(result.source, 'rules');
    assert.match(result.reply, /Lucy/i);
    assert.equal(result.persona, 'lucy');
  });
});
