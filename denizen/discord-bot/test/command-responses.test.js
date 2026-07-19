'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { ConfigStore } = require('../src/core/config-store');
const { CommandRegistry } = require('../src/core/command-registry');
const { EventHub } = require('../src/core/event-hub');
const { createMisc } = require('../src/modules/misc');
const { createModeration } = require('../src/modules/moderation');
const { createCanvasBridge } = require('../src/modules/canvas');

function tmpConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-cmd-'));
  return new ConfigStore({ dir });
}

function makePrefixCtx({ config, guildId, userId, args, replies, channel, message }) {
  const guild = { id: guildId, ownerId: 'owner', name: 'Test' };
  const user = { id: userId, tag: 'User#0001' };
  return {
    source: 'prefix',
    guild,
    member: {
      id: userId,
      permissions: { has: () => true },
      roles: { cache: new Map() },
    },
    user,
    channel,
    message,
    args,
    config,
    getString: () => args.join(' ') || null,
    getInteger: () => {
      const n = Number(args[0]);
      return Number.isFinite(n) ? n : null;
    },
    getUser: () => message?.mentions?.users?.first?.() || null,
    reply: async (content) => {
      const text = typeof content === 'string' ? content : content?.content;
      replies.push(text);
      return { content: text };
    },
  };
}

describe('command responses — purge / afk / canvas', () => {
  it('purge deletes the requested amount (excludes invoke message before slice)', async () => {
    const config = tmpConfig();
    config.update('g1', (c) => {
      c.security.fakePermissions.forceBotMod = false;
      return c;
    });
    const registry = new CommandRegistry({ prefix: ',' });
    createModeration({ config, hub: new EventHub() }).register(registry);
    const cmd = registry.get('purge');
    assert.ok(cmd);

    const now = Date.now();
    const messages = new Map();
    // Newest first (discord.js Collection iteration order)
    messages.set('cmd', {
      id: 'cmd',
      createdTimestamp: now,
      author: { id: 'mod1' },
    });
    for (let i = 1; i <= 15; i += 1) {
      messages.set(`m${i}`, {
        id: `m${i}`,
        createdTimestamp: now - i * 1000,
        author: { id: 'u1' },
      });
    }

    let bulkArgs = null;
    const channel = {
      id: 'ch1',
      name: 'general',
      messages: {
        fetch: async () => messages,
      },
      bulkDelete: async (list) => {
        bulkArgs = [...list];
        return { size: list.length || list.size || 0 };
      },
    };

    const replies = [];
    const ctx = makePrefixCtx({
      config,
      guildId: 'g1',
      userId: 'mod1',
      args: ['10'],
      replies,
      channel,
      message: { id: 'cmd', mentions: { users: { first: () => null } } },
    });
    // Admin path: canRunCommand needs permissions
    ctx.member.permissions.has = () => true;

    await cmd.run(ctx);

    assert.equal(bulkArgs.length, 10, 'should delete exactly 10 (not 9)');
    assert.ok(!bulkArgs.some((m) => m.id === 'cmd'), 'must not include invoke message');
    assert.match(replies[0], /Purged \*\*10\*\* messages/);
  });

  it('purge rejects out-of-range amounts with a clear reply', async () => {
    const config = tmpConfig();
    const registry = new CommandRegistry({ prefix: ',' });
    createModeration({ config, hub: new EventHub() }).register(registry);
    const cmd = registry.get('purge');
    const replies = [];
    const ctx = makePrefixCtx({
      config,
      guildId: 'g1',
      userId: 'mod1',
      args: ['0'],
      replies,
      channel: { id: 'ch1', name: 'general' },
      message: { id: 'cmd', mentions: { users: { first: () => null } } },
    });
    ctx.member.permissions.has = () => true;
    await cmd.run(ctx);
    assert.equal(replies[0], 'Amount 1–100.');
  });

  it('afk set persists through the same messageCreate hook that would clear it', async () => {
    const config = tmpConfig();
    const misc = createMisc({ config, tracker: null });
    const registry = new CommandRegistry({ prefix: ',' });
    misc.register(registry);
    const cmd = registry.get('afk');

    const replies = [];
    const args = ['grabbing', 'coffee'];
    const getters = require('../src/core/command-registry').bindPrefixOptionGetters(cmd, args, {});
    const ctx = {
      source: 'prefix',
      guild: { id: 'g1' },
      user: { id: 'u1', tag: 'User#0001' },
      args,
      ...getters,
      reply: async (content) => { replies.push(content); },
    };
    await cmd.run(ctx);
    assert.equal(replies[0], 'AFK set: grabbing coffee');
    assert.equal(config.get('g1').misc.afk.u1.reason, 'grabbing coffee');

    // Simulate gateway: hooks.onMessage runs on the same ,afk message
    const sent = [];
    await misc.onMessage({
      guild: { id: 'g1' },
      author: { id: 'u1', bot: false },
      content: ',afk grabbing coffee',
      mentions: { users: new Map() },
      channel: { send: async (t) => { sent.push(t); } },
    });
    assert.ok(config.get('g1').misc.afk.u1, 'AFK must survive the set-command message');
    assert.equal(config.get('g1').misc.afk.u1.reason, 'grabbing coffee');

    // A later normal message clears AFK + private notice (DM preferred)
    const dms = [];
    const channelReplies = [];
    await misc.onMessage({
      guild: { id: 'g1' },
      author: {
        id: 'u1',
        bot: false,
        send: async (payload) => {
          dms.push(typeof payload === 'string' ? payload : payload.content);
          return {};
        },
      },
      content: 'back',
      mentions: { users: new Map() },
      channel: { send: async () => {} },
      reply: async (payload) => {
        channelReplies.push(typeof payload === 'string' ? payload : payload.content);
        return { delete: async () => {} };
      },
    });
    assert.equal(config.get('g1').misc.afk.u1, undefined);
    assert.equal(dms.length, 1);
    assert.match(dms[0], /AFK removed/);
    assert.match(dms[0], /grabbing coffee/);
    assert.equal(channelReplies.length, 0, 'should not fall back to channel when DM works');
  });

  it('afk clear falls back to short channel reply when DMs are closed', async () => {
    const config = tmpConfig();
    const misc = createMisc({ config, tracker: null });
    config.update('g1', (c) => {
      c.misc = { afk: { u1: { reason: 'brb', ts: Date.now() } } };
      return c;
    });
    const replies = [];
    await misc.onMessage({
      guild: { id: 'g1' },
      author: {
        id: 'u1',
        bot: false,
        send: async () => { throw new Error('DMs closed'); },
      },
      content: 'hello',
      mentions: { users: new Map() },
      channel: { send: async () => {} },
      reply: async (payload) => {
        replies.push(typeof payload === 'string' ? payload : payload.content);
        return { delete: async () => {} };
      },
    });
    assert.equal(config.get('g1').misc.afk.u1, undefined);
    assert.equal(replies.length, 1);
    assert.match(replies[0], /AFK removed/);
  });

  it('afk slash stores the reason option text for mentions', async () => {
    const config = tmpConfig();
    const misc = createMisc({ config, tracker: null });
    const registry = new CommandRegistry({ prefix: ',' });
    misc.register(registry);
    const cmd = registry.get('afk');
    const replies = [];
    await cmd.run({
      source: 'slash',
      guild: { id: 'g1' },
      user: { id: 'u9' },
      args: [],
      getString: (n) => (n === 'reason' ? 'in a meeting — back soon' : null),
      reply: async (c) => { replies.push(c); },
    });
    assert.equal(replies[0], 'AFK set: in a meeting — back soon');
    assert.equal(config.get('g1').misc.afk.u9.reason, 'in a meeting — back soon');

    const sent = [];
    await misc.onMessage({
      guild: { id: 'g1' },
      author: { id: 'u1', bot: false },
      content: 'hey',
      mentions: { users: new Map([['u9', { id: 'u9' }]]) },
      channel: { send: async (t) => { sent.push(t); } },
    });
    assert.match(sent[0], /is AFK: in a meeting — back soon/);
  });

  it('afk mention replies with reason and relative timestamp', async () => {
    const config = tmpConfig();
    const misc = createMisc({ config, tracker: null });
    const ts = Date.now() - 60_000;
    config.update('g1', (c) => {
      c.misc = { afk: { u2: { reason: 'in a meeting', ts } } };
      return c;
    });
    const sent = [];
    await misc.onMessage({
      guild: { id: 'g1' },
      author: { id: 'u1', bot: false },
      content: 'hey <@u2>',
      mentions: { users: new Map([['u2', { id: 'u2' }]]) },
      channel: { send: async (t) => { sent.push(t); } },
    });
    assert.equal(sent.length, 1);
    assert.match(sent[0], /💤 <@u2> is AFK: in a meeting/);
    assert.match(sent[0], /<t:\d+:R>/);
  });

  it('canvasevents replies with recent hub events for the guild', async () => {
    const tracker = { _canvasEvents: [], snapshot: () => ({ rooms: [] }) };
    const hub = new EventHub();
    const canvas = createCanvasBridge({ tracker, hub });
    canvas.attach();
    const registry = new CommandRegistry({ prefix: ',' });
    canvas.register(registry);

    hub.emit('security.raid', { guildId: 'g1', state: true });
    hub.emit('security.antinuke', { guildId: 'g2', kind: 'ban' });
    hub.emit('tickets.open', { guildId: 'g1', channelId: 'c1' });

    const cmd = registry.get('canvasevents');
    const replies = [];
    await cmd.run({
      guild: { id: 'g1' },
      reply: async (t) => { replies.push(t); },
    });
    assert.equal(replies.length, 1);
    assert.match(replies[0], /security\.raid/);
    assert.match(replies[0], /tickets\.open/);
    assert.doesNotMatch(replies[0], /security\.antinuke/);
  });

  it('canvasevents and roomsnapshot reply cleanly when empty', async () => {
    const tracker = {
      _canvasEvents: [],
      snapshot: () => ({ rooms: [{ name: 'Lounge', type: 'voice', occupantCount: 0 }] }),
    };
    const canvas = createCanvasBridge({ tracker, hub: new EventHub() });
    const registry = new CommandRegistry({ prefix: ',' });
    canvas.register(registry);

    const empty = [];
    await registry.get('canvasevents').run({
      guild: { id: 'g1' },
      reply: async (t) => { empty.push(t); },
    });
    assert.equal(empty[0], 'No canvas events yet.');

    const snap = [];
    await registry.get('roomsnapshot').run({
      guild: { id: 'g1' },
      reply: async (t) => { snap.push(t); },
    });
    assert.match(snap[0], /\*\*Rooms\*\*/);
    assert.match(snap[0], /\(empty\)/);
    assert.match(snap[0], /\(none\)/);
  });

  it('rooms alias is registered for roomsnapshot', () => {
    const canvas = createCanvasBridge({
      tracker: { _canvasEvents: [], snapshot: () => ({ rooms: [] }) },
      hub: new EventHub(),
    });
    const registry = new CommandRegistry({ prefix: ',' });
    canvas.register(registry);
    assert.equal(registry.get('rooms').name, 'roomsnapshot');
  });

  it('prefix command views, sets, and resets guild prefix', async () => {
    const { loadModules } = require('../src/modules/load-modules');
    const config = tmpConfig();
    const registry = new CommandRegistry({ prefix: ',' });
    const hub = new EventHub();
    const client = { on() {}, once() {}, guilds: { cache: new Map() }, ws: { ping: 0 } };
    loadModules({
      config,
      registry,
      hub,
      tracker: { snapshot: () => ({ rooms: [], members: [], people: [] }), isOnMap: () => false, setMapAction() {} },
      audit: {},
      client,
    });

    const cmd = registry.get('prefix');
    assert.ok(cmd);

    const view = [];
    await cmd.run({
      guild: { id: 'g1', ownerId: 'owner' },
      member: { permissions: { has: () => true }, roles: { cache: new Map() } },
      user: { id: 'u1' },
      args: [],
      config,
      getString: () => null,
      reply: async (t) => { view.push(t); },
    });
    assert.match(view[0], /Server prefix is `,`/);

    const set = [];
    await cmd.run({
      guild: { id: 'g1', ownerId: 'owner' },
      member: { permissions: { has: () => true }, roles: { cache: new Map() } },
      user: { id: 'u1' },
      args: ['set', '!'],
      config,
      getString: (name) => (name === 'action' ? 'set' : name === 'prefix' ? '!' : null),
      reply: async (t) => { set.push(t); },
    });
    assert.match(set[0], /Prefix set to `!`/);
    assert.equal(config.get('g1').prefix, '!');

    const reset = [];
    await cmd.run({
      guild: { id: 'g1', ownerId: 'owner' },
      member: { permissions: { has: () => true }, roles: { cache: new Map() } },
      user: { id: 'u1' },
      args: ['remove'],
      config,
      getString: (name) => (name === 'action' ? 'remove' : null),
      reply: async (t) => { reset.push(t); },
    });
    assert.match(reset[0], /Prefix reset to `,`/);
    assert.equal(config.get('g1').prefix, ',');
  });
});
