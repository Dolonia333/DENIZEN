'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const agentSouls = require('../src/agent-souls');

describe('org template sanitization', () => {
  it('defaults template pack loader to generic-office souls', () => {
    const souls = agentSouls.loadSoulsForTemplatePack();
    assert.ok(Array.isArray(souls));
    assert.ok(souls.length > 0);
    // Generic pack must not embed operator company UEI / 1921 narrative markers.
    const blob = souls.map((s) => s.soul_content || '').join('\n');
    assert.ok(!/YMP7Z9T1WVX5/.test(blob), 'generic souls must not embed operator UEI');
  });

  it('rejects 1921-govcon clone onto non-operator orgs', async () => {
    const fakeDb = {
      enabled: true,
      orgId: 'operator-org',
      upsertAgentSoul: async () => {},
      upsertOrgBusinessModel: async () => {},
    };
    await assert.rejects(
      () => agentSouls.cloneTemplatePackToOrg(fakeDb, 'other-team-org', '1921-govcon'),
      /Operator template pack/,
    );
  });
});
