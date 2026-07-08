'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const agentSouls = require('../src/npc/agent-souls');

describe('agent-souls', () => {
  it('loads Abby soul from files', () => {
    const row = agentSouls.loadSoulFromFiles('abby');
    assert.match(row.soul_content, /Abby/i);
    assert.equal(row.display_name, 'Abby');
    assert.equal(row.source, 'file');
  });

  it('parses provider and role from soul', () => {
    const row = agentSouls.loadSoulFromFiles('abby');
    const meta = agentSouls.parseSoulMeta(row.soul_content);
    assert.equal(meta.role, 'CTO');
    assert.ok(meta.provider);
  });

  it('displayToFolder maps Marcus', () => {
    assert.equal(agentSouls.displayToFolder('Marcus'), 'conference_man');
    assert.equal(agentSouls.displayToFolder('conference_man'), 'conference_man');
  });

  it('loadAllSoulsFromFiles returns all NPC entries', () => {
    const all = agentSouls.loadAllSoulsFromFiles();
    assert.ok(all.length >= 16, `expected at least 16 souls, got ${all.length}`);
    assert.ok(all.every((r) => r.npc_key && r.display_name));
  });
});
