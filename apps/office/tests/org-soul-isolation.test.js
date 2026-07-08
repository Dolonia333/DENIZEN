'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const genericSoulPack = require('../src/npc/generic-soul-pack');
const agentSouls = require('../src/npc/agent-souls');

describe('generic soul pack', () => {
  it('loads 18 generic souls without 1921 pursuit terms', () => {
    const souls = genericSoulPack.loadAllGenericSouls();
    assert.equal(souls.length, 18);
    for (const s of souls) {
      assert.ok(genericSoulPack.isGenericSoulContent(s.soul_content), s.npc_key);
      assert.doesNotMatch(s.soul_content, /OMES|RM Cyber|1921 Holding|YMP7Z9T1WVX5/i);
    }
  });

  it('generic business model has no active opportunities', () => {
    const model = genericSoulPack.loadGenericBusinessModel();
    assert.equal(model.template_pack, 'generic-office');
    assert.deepEqual(model.active_opportunities, []);
  });
});

describe('org soul isolation', () => {
  it('loadSoulsForTemplatePack returns generic for generic-office', () => {
    const souls = agentSouls.loadSoulsForTemplatePack('generic-office');
    assert.ok(genericSoulPack.isGenericSoulContent(souls[0].soul_content));
  });

  it('loadSoulForOrg uses generic fallback for non-operator org without DB row', async () => {
    const mockDb = {
      enabled: true,
      orgId: 'zion-operator-uuid',
      async getAgentSoul() {
        return null;
      },
    };
    const soul = await agentSouls.loadSoulForOrg(mockDb, 'acme-demo-uuid', 'Abby');
    assert.equal(soul.source, 'generic_template');
    assert.match(soul.soul_content, /generic Denizen office/i);
    assert.doesNotMatch(soul.soul_content, /OMES/i);
  });

  it('loadSoulForOrg uses DB row when present', async () => {
    const mockDb = {
      enabled: true,
      orgId: 'zion-operator-uuid',
      async getAgentSoul(orgId, npcKey) {
        if (orgId === 'acme-demo-uuid' && npcKey === 'abby') {
          return {
            soul_content: '# Abby\n## Role\nCTO\nOMES EV00000919 test row',
            memory_content: '',
            display_name: 'Abby',
            template_pack: 'generic-office',
          };
        }
        return null;
      },
    };
    const soul = await agentSouls.loadSoulForOrg(mockDb, 'acme-demo-uuid', 'abby');
    assert.equal(soul.source, 'database');
    assert.match(soul.soul_content, /OMES/);
  });

  it('loadSoulForOrg uses file fallback for operator org without DB row', async () => {
    const mockDb = {
      enabled: true,
      orgId: 'zion-operator-uuid',
      async getAgentSoul() {
        return null;
      },
    };
    const soul = await agentSouls.loadSoulForOrg(mockDb, 'zion-operator-uuid', 'abby');
    assert.equal(soul.source, 'file');
    assert.match(soul.soul_content, /Abby/i);
  });
});
