'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const worldState = require('../src/world-state');
const officeRegistry = require('../src/visitors/visitor-office-registry');

describe('world-state org isolation', () => {
  it('forOrg returns isolated buckets', () => {
    const a = worldState.forOrg('org-a');
    const b = worldState.forOrg('org-b');
    assert.notEqual(a, b);
    a.updateNpc('Alex', { state: 'working', room: 'open_office' });
    assert.equal(a.npcs.Alex?.state, 'working');
    assert.equal(b.npcs.Alex, undefined);
  });

  it('registry change events include orgId', () => {
    let seen = null;
    const handler = (evt) => { seen = evt; };
    worldState.on('change', handler);
    worldState.forOrg('org-events').updateNpc('Bob', { state: 'idle' });
    worldState.off('change', handler);
    assert.equal(seen?.orgId, 'org-events');
    assert.equal(seen?.kind, 'npc');
  });

  it('shouldDeliverToSocket filters world_state_batch by org_id', () => {
    const msg = { type: 'world_state_batch', org_id: 'org-a', changes: [] };
    const match = { _denizenOrgId: 'org-a', _denizenOfficeId: 'ceo-operator' };
    const leak = { _denizenOrgId: 'org-b', _denizenOfficeId: 'ceo-operator' };
    assert.equal(officeRegistry.shouldDeliverToSocket(msg, match), true);
    assert.equal(officeRegistry.shouldDeliverToSocket(msg, leak), false);
  });

  it('threat broadcasts remain global', () => {
    const msg = { type: 'threat', category: 'intrusion' };
    const any = { _denizenOrgId: 'org-b' };
    assert.equal(officeRegistry.shouldDeliverToSocket(msg, any), true);
  });
});
