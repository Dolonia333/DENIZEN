'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { ConfigStore } = require('../src/core/config-store');
const { CommandRegistry } = require('../src/core/command-registry');
const { EventHub } = require('../src/core/event-hub');
const { canRunCommand, addFakePerm } = require('../src/core/permissions');
const { createVoiceMaster } = require('../src/modules/voicemaster');
const { createHangoutModule } = require('../src/modules/hangout');
const { createTickets } = require('../src/modules/tickets');
const { createMusic } = require('../src/modules/music');

function tmpConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-perm-'));
  return new ConfigStore({ dir });
}

function memberWith(perms = [], roleIds = []) {
  const set = new Set(perms);
  const roles = new Map(roleIds.map((id) => [id, true]));
  return {
    id: 'u1',
    permissions: { has: (p) => set.has(p) },
    roles: { cache: { has: (id) => roles.has(id), keys: () => roles.keys() } },
    voice: { channel: null },
  };
}

describe('permission gates fixes', () => {
  it('avatar is not a premium module; security and community are', () => {
    const { PREMIUM_MODULES, isPremiumModule, isHomeGuild, DEFAULT_HOME_GUILD_ID } = require('../../src/denizen-guild-plans.js');
    assert.equal(isPremiumModule('avatar'), false);
    assert.equal(isPremiumModule('security'), true);
    assert.equal(isPremiumModule('community'), true);
    assert.ok(!PREMIUM_MODULES.has('avatar'));
    assert.equal(isHomeGuild(DEFAULT_HOME_GUILD_ID), true);
  });

  it('voicemaster has no blanket ManageChannels registry gate', () => {
    const config = tmpConfig();
    const registry = new CommandRegistry({ prefix: ',' });
    createVoiceMaster({ config, hub: new EventHub() }).register(registry);
    const cmd = registry.get('vm');
    assert.ok(cmd);
    assert.equal(cmd.permission, null);
  });

  it('voicemaster owner can lock without ManageChannels', async () => {
    const config = tmpConfig();
    const registry = new CommandRegistry({ prefix: ',' });
    createVoiceMaster({ config, hub: new EventHub() }).register(registry);
    const guildId = 'g1';
    const channelId = 'vc1';
    config.update(guildId, (c) => {
      c.voicemaster.tempChannels[channelId] = { ownerId: 'owner1', createdAt: Date.now() };
      return c;
    });
    const edits = [];
    const replies = [];
    await registry.get('vm').run({
      guild: { id: guildId, ownerId: 'owner' },
      user: { id: 'owner1' },
      member: {
        ...memberWith([]),
        id: 'owner1',
        voice: {
          channel: {
            id: channelId,
            name: 'Temp',
            members: { has: () => true },
            permissionOverwrites: {
              edit: async (id, perms) => { edits.push({ id, perms }); },
            },
          },
        },
      },
      args: ['lock'],
      getString: (n) => (n === 'action' ? 'lock' : null),
      config,
      reply: async (t) => { replies.push(t); },
    });
    assert.match(String(replies[0]), /locked/i);
    assert.equal(edits.length, 1);
  });

  it('hangout setup requires ManageGuild', async () => {
    const config = tmpConfig();
    const registry = new CommandRegistry({ prefix: ',' });
    createHangoutModule({
      config,
      tracker: { hangoutLeaderboard: () => ({ week: '2026-W1', rows: [] }) },
      client: { guilds: { cache: new Map() } },
    }).register(registry);
    const denied = [];
    await registry.get('hangout').run({
      guild: { id: 'g1', ownerId: 'owner', name: 'G' },
      user: { id: 'u1' },
      member: memberWith([]),
      args: ['setup'],
      config,
      getChannel: () => ({ id: 'ch1' }),
      reply: async (t) => { denied.push(t); },
    });
    assert.match(String(denied[0]?.content || denied[0]), /Manage Server/i);

    const ok = [];
    await registry.get('hangout').run({
      guild: { id: 'g1', ownerId: 'owner', name: 'G' },
      user: { id: 'u1' },
      member: memberWith(['ManageGuild']),
      args: ['setup'],
      config,
      getChannel: () => ({ id: 'ch1' }),
      reply: async (t) => { ok.push(t); },
    });
    assert.match(String(ok[0]?.content || ok[0]), /Hangout recaps/i);
    assert.equal(config.get('g1').hangout.channelId, 'ch1');
  });

  it('tickets claim/note require support role or ManageGuild', async () => {
    const config = tmpConfig();
    const registry = new CommandRegistry({ prefix: ',' });
    createTickets({ config, hub: new EventHub() }).register(registry);
    config.update('g1', (c) => {
      c.tickets.enabled = true;
      c.tickets.supportRoleId = 'support';
      c.tickets.open.ch1 = {
        userId: 'opener',
        reason: 'help',
        claimedBy: null,
        notes: [],
        ts: Date.now(),
        closed: false,
      };
      return c;
    });

    const denied = [];
    await registry.get('tickets').run({
      guild: { id: 'g1', ownerId: 'owner' },
      user: { id: 'rando', tag: 'R#1' },
      member: memberWith([]),
      channel: { id: 'ch1' },
      args: ['claim'],
      getString: (n) => (n === 'action' ? 'claim' : null),
      config,
      reply: async (t) => { denied.push(t); },
    });
    assert.match(String(denied[0]?.content || denied[0]), /Staff only/i);

    const claimed = [];
    await registry.get('tickets').run({
      guild: { id: 'g1', ownerId: 'owner' },
      user: { id: 'staff1', tag: 'S#1' },
      member: memberWith([], ['support']),
      channel: { id: 'ch1' },
      args: ['claim'],
      getString: (n) => (n === 'action' ? 'claim' : null),
      config,
      reply: async (t) => { claimed.push(t); },
    });
    assert.match(String(claimed[0]), /claimed/i);
    assert.equal(config.get('g1').tickets.open.ch1.claimedBy, 'staff1');
  });

  it('ticket opener can close their own ticket without staff role', async () => {
    const config = tmpConfig();
    const registry = new CommandRegistry({ prefix: ',' });
    const tickets = createTickets({ config, hub: new EventHub() });
    tickets.register(registry);
    config.update('g1', (c) => {
      c.tickets.enabled = true;
      c.tickets.open.ch1 = {
        userId: 'opener',
        reason: 'help',
        claimedBy: null,
        notes: [],
        ts: Date.now(),
        closed: false,
      };
      return c;
    });
    // closeTicket deletes the channel — stub delete
    const replies = [];
    await registry.get('tickets').run({
      guild: {
        id: 'g1',
        ownerId: 'owner',
        channels: { fetch: async () => null },
      },
      user: { id: 'opener', tag: 'O#1' },
      member: memberWith([]),
      channel: {
        id: 'ch1',
        name: 'ticket-opener',
        isTextBased: () => true,
        messages: { fetch: async () => ({ size: 0, values: () => [] }) },
        delete: async () => {},
        permissionOverwrites: { edit: async () => {} },
      },
      args: ['close'],
      getString: (n) => (n === 'action' ? 'close' : null),
      config,
      reply: async (t) => { replies.push(t); },
    });
    // Either closed successfully or attempted close flow
    assert.ok(replies.length >= 1);
    assert.doesNotMatch(String(replies[0]?.content || replies[0]), /Staff only/i);
  });

  it('fake ManageWebhooks satisfies permission: ManageWebhooks', () => {
    const config = tmpConfig();
    addFakePerm(config, 'g1', 'role1', 'manage_webhooks');
    const member = {
      roles: { cache: new Map([['role1', true]]) },
      permissions: { has: () => false },
    };
    const gate = canRunCommand(
      { guild: { id: 'g1', ownerId: 'owner' }, member, user: { id: 'u1' }, config },
      { permission: 'ManageWebhooks' },
    );
    assert.equal(gate.ok, true);
  });

  it('music skip denied outside bot VC without DJ/ManageGuild', async () => {
    const config = tmpConfig();
    const registry = new CommandRegistry({ prefix: ',' });
    const music = createMusic({ config, hub: new EventHub(), client: { user: { id: 'bot' } } });
    music.register(registry);
    music.queues.set('g1', {
      tracks: [],
      playing: { title: 'Song', uri: 'x' },
      textChannelId: null,
      volume: 80,
      loop: 'off',
      filter: 'none',
      voiceChannelId: 'vc-bot',
    });

    const denied = [];
    await registry.get('skip').run({
      guild: { id: 'g1', ownerId: 'owner' },
      user: { id: 'u1' },
      member: { ...memberWith([]), voice: { channel: { id: 'other-vc' } } },
      config,
      reply: async (t) => { denied.push(t); },
    });
    assert.match(String(denied[0]?.content || denied[0]), /Join the listening/i);

    const ok = [];
    await registry.get('skip').run({
      guild: { id: 'g1', ownerId: 'owner' },
      user: { id: 'u1' },
      member: { ...memberWith([]), voice: { channel: { id: 'vc-bot' } } },
      config,
      reply: async (t) => { ok.push(t); },
    });
    assert.match(String(ok[0]?.embeds?.[0]?.data?.description || ok[0]?.embeds?.[0]?.description || JSON.stringify(ok[0])), /Song|Skipped|empty/i);
  });
});
