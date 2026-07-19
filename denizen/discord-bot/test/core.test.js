'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ConfigStore } = require('../src/core/config-store');
const { CommandRegistry, bindPrefixOptionGetters } = require('../src/core/command-registry');
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

  it('prefix getString maps action to first token (not full remainder)', () => {
    const fp = {
      options: [
        { name: 'action', type: 3, required: true },
        { name: 'role', type: 8, required: false },
        { name: 'permission', type: 3, required: false },
      ],
    };
    const g = bindPrefixOptionGetters(fp, ['harden', '<@&99>'], {});
    assert.equal(g.getString('action'), 'harden');
    assert.equal(g.getString('permission'), null);

    const add = bindPrefixOptionGetters(fp, ['add', '<@&99>', 'ban_members'], {});
    assert.equal(add.getString('action'), 'add');
    assert.equal(add.getString('permission'), 'ban_members');
  });

  it('prefix getString keeps freeform query / reason tails', () => {
    const play = { options: [{ name: 'query', type: 3, required: true }] };
    const g = bindPrefixOptionGetters(play, ['never', 'gonna', 'give'], {});
    assert.equal(g.getString('query'), 'never gonna give');

    const tickets = {
      options: [
        { name: 'action', type: 3, required: true },
        { name: 'reason', type: 3, required: false },
      ],
    };
    const t = bindPrefixOptionGetters(tickets, ['form', 'Label', '|', 'desc', '|', 'Q1?'], {});
    assert.equal(t.getString('action'), 'form');
    assert.equal(t.getString('reason'), 'Label | desc | Q1?');
  });

  it('prefix getString drops mention tokens from last-string tails', () => {
    const levels = {
      options: [
        { name: 'action', type: 3, required: false },
        { name: 'value', type: 3, required: false },
      ],
    };
    const g = bindPrefixOptionGetters(levels, ['reward', '5', '<@&42>'], {});
    assert.equal(g.getString('action'), 'reward');
    assert.equal(g.getString('value'), '5');
  });

  it('prefix getInteger respects named amount option', () => {
    const purge = {
      options: [
        { name: 'amount', type: 4, required: true },
        { name: 'user', type: 6, required: false },
      ],
    };
    const g = bindPrefixOptionGetters(purge, ['25', '<@1>'], {});
    assert.equal(g.getInteger('amount'), 25);
  });

  it('private replies default on; public commands and explicit ephemeral win', () => {
    const { resolvePrivateReply } = require('../src/core/command-registry');
    const prev = process.env.DISCORD_PRIVATE_REPLIES;
    process.env.DISCORD_PRIVATE_REPLIES = '1';
    try {
      assert.equal(resolvePrivateReply({ public: false }, 'Pong'), true);
      assert.equal(resolvePrivateReply({ public: true }, 'Now playing'), false);
      assert.equal(resolvePrivateReply({ public: true }, { content: 'x', ephemeral: true }), true);
      assert.equal(resolvePrivateReply({}, { content: 'x', ephemeral: false }), false);
    } finally {
      if (prev === undefined) delete process.env.DISCORD_PRIVATE_REPLIES;
      else process.env.DISCORD_PRIVATE_REPLIES = prev;
    }
  });
});
