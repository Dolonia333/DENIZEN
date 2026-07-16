'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  diffWorkspaceAudit,
  applyAuditToState,
  applyGovconPreset,
  govconIndustryConfig,
} = require('../src/denizen-crm-audit-diff');

describe('denizen-crm-audit-diff', () => {
  it('attributes create/update/delete to actor', () => {
    const prev = {
      contacts: [{ id: 1, name: 'Raj', email: 'r@x.com' }],
      deals: [{ id: 10, title: 'OMES', stage: 'Lead', value: 100 }],
    };
    const next = {
      contacts: [
        { id: 1, name: 'Raj Patel', email: 'r@x.com' },
        { id: 2, name: 'Angela CO', email: 'co@agency.gov' },
      ],
      deals: [{ id: 10, title: 'OMES', stage: 'Capture', value: 100 }],
    };
    const entries = diffWorkspaceAudit(prev, next, {
      user: 'ANGELA VAN ZANDT',
      email: 'vzion253@gmail.com',
      role: 'admin',
    });
    assert.ok(entries.some((e) => e.action === 'created' && e.entity === 'contacts'));
    assert.ok(entries.some((e) => e.action === 'updated' && e.field === 'name'));
    assert.ok(entries.some((e) => e.action === 'updated' && e.field === 'stage'));
    assert.ok(entries.every((e) => e.user === 'ANGELA VAN ZANDT'));
    assert.ok(entries.every((e) => e.email === 'vzion253@gmail.com'));
  });

  it('applyAuditToState prepends saved summary', () => {
    const prev = { contacts: [], auditLog: [] };
    const next = { contacts: [{ id: 1, name: 'A', email: 'a@b.com' }], auditLog: [] };
    const { state, changeCount } = applyAuditToState(prev, next, {
      user: 'Angela',
      email: 'a@x.com',
      role: 'admin',
    });
    assert.ok(changeCount >= 1);
    assert.equal(state.auditLog[0].action, 'saved');
    assert.equal(state.auditLog[0].user, 'Angela');
    assert.ok(state.usageLog?.length >= 1);
  });

  it('govcon preset sets capture industry', () => {
    const prev = {
      industryConfig: { id: 'travel', name: 'Travel' },
      deals: [{ id: 1, title: 'OMES', stage: 'Inquiry', value: 1 }],
    };
    const out = applyGovconPreset(prev, { user: 'System', role: 'system' });
    assert.equal(out.industryConfig.id, 'govcon');
    assert.ok(out.industryConfig.customFields.some((f) => f.id === 'solicitation'));
    assert.equal(out.deals[0].stage, 'Market Research');
    assert.equal(govconIndustryConfig().pipelineStages[0], 'Market Research');
  });
});
