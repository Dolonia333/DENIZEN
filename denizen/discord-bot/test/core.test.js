'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ConfigStore } = require('../src/core/config-store');
const { CommandRegistry } = require('../src/core/command-registry');
const { canRunCommand, addFakePerm, hasFakePerm } = require('../src/core/permissions');

describe('core foundation', () => {
  it('config store persists guild settings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-cfg-'));
    const store = new ConfigStore({ dir });
    store.update('g1', (c) => { c.security.enabled = true; return c; });
    const store2 = new ConfigStore({ dir });
    assert.equal(store2.get('g1').security.enabled, true);
  });

  it('command registry lists unique commands', () => {
    const r = new CommandRegistry();
    r.register({ name: 'ping', aliases: ['p'], run: async () => {} });
    assert.equal(r.list().length, 1);
    assert.ok(r.get('p'));
  });

  it('fake permissions gate commands', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-fp-'));
    const store = new ConfigStore({ dir });
    addFakePerm(store, 'g1', 'role1', 'ban_members');
    const member = { roles: { cache: new Map([['role1', true]]) } };
    const cfg = store.get('g1');
    assert.equal(hasFakePerm(cfg, member, 'ban_members'), true);
    assert.equal(hasFakePerm(cfg, member, 'kick_members'), false);
    const ok = canRunCommand(
      { guild: { id: 'g1', ownerId: 'owner' }, member, user: { id: 'u1' }, config: store },
      { fakePerm: 'ban_members' },
    );
    assert.equal(ok.ok, true);
  });
});
