'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('operating loop fixes', () => {
  it('rejects an empty CRM automation and accepts a template', () => {
    const skills = require('../src/denizen-crm-skills');
    const empty = skills.validateCrmAutomation({});
    assert.equal(empty.ok, false);
    const follow = skills.validateCrmAutomation({ template: 'follow-up' });
    assert.equal(follow.ok, true);
    assert.equal(follow.trigger, 'deal_stale');
    assert.ok(follow.actionDetail);
  });

  it('rejects an empty Studio Board automation', () => {
    const autos = require('../src/denizen-studio-board-automations');
    assert.equal(autos.validateAutomation({}).ok, false);
    const rule = autos.validateAutomation({ template: 'overdue' });
    assert.equal(rule.ok, true);
    assert.equal(rule.rule.when.type, 'due_passed');
    assert.ok(rule.rule.then.length);
  });

  it('counts a qualifying interview and refuses an unvalidated one', () => {
    const chain = require('../src/denizen-business-studio-chain');
    const ledger = require('../src/denizen-business-studio-evidence');
    const state = { evidence: [], experiments: [], programs: [], relations: [], assumptions: [], milestones: [], goals: [], metrics: [] };
    assert.throws(() => chain.linkValidatedInterview(state, { title: 'Chat', contactId: 1 }), /qualifying/);
    const linked = chain.linkValidatedInterview(state, {
      title: 'Qualifying interview with a buyer',
      contactId: 9,
      qualifying: true,
    });
    assert.equal(linked.evidence.qualifying, true);
    assert.equal(linked.evidence.contactId, 9);
    assert.match(linked.nextTask.title, /Qualifying interview/);
    state.evidence.push({ id: 'noise', type: 'interview', title: 'Not qualifying', qualifying: false, revoked: false });
    const count = ledger.qualifyingEvidence(state, { type: 'interview' }).count;
    assert.equal(count, 1);
  });

  it('requires confirm and explicit ids before deleting or merging', async () => {
    const operate = require('../src/denizen-crm-operate');
    const missing = await operate.operateCrm('org', { action: 'delete-deal', deal_id: 1 });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /confirm/);
    const merge = await operate.operateCrm('org', { action: 'merge-contacts', keep_id: 1 });
    assert.equal(merge.ok, false);
    assert.match(merge.error, /confirm|keep_id/);
  });
});
