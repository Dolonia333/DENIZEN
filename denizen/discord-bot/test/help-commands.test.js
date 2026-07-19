'use strict';

/**
 * Smoke: every command advertised in /help hubs must resolve and reply.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { ConfigStore } = require('../src/core/config-store');
const { CommandRegistry } = require('../src/core/command-registry');
const { EventHub } = require('../src/core/event-hub');
const { loadModules } = require('../src/modules/load-modules');
const { createFakePerms } = require('../src/modules/security');
const { createTickets } = require('../src/modules/tickets');

function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-help-'));
  const config = new ConfigStore({ dir });
  const registry = new CommandRegistry({ prefix: ',' });
  const hub = new EventHub();
  const client = { on() {}, once() {}, guilds: { cache: new Map() }, ws: { ping: 12 } };
  const tracker = {
    snapshot: () => ({ rooms: [], members: [], people: [] }),
    _canvasEvents: [],
    isOnMap: () => true,
    setMapAction() {},
  };
  loadModules({ config, registry, hub, tracker, audit: {}, client });
  return { config, registry, hub, client, tracker };
}

function ownerCtx(registry, config, { name, args = [], replies, extra = {} }) {
  const cmd = registry.get(name);
  assert.ok(cmd, `missing command ${name}`);
  const guild = {
    id: 'g1',
    ownerId: 'owner',
    name: 'Test',
    channels: {
      create: async ({ name: n }) => ({ id: `ch-${n}`, name: n, toString: () => `#${n}` }),
    },
    members: {
      me: {
        permissions: { has: () => true },
        roles: { highest: { name: 'Denizen', position: 10, id: 'botrole' } },
      },
      fetch: async () => null,
      fetchMe: async () => null,
    },
    roles: {
      cache: {
        filter: () => [],
      },
    },
  };
  const getters = require('../src/core/command-registry').bindPrefixOptionGetters(cmd, args, {
    mentions: {
      users: { first: () => extra.user || null },
      roles: { first: () => extra.role || null },
      members: { first: () => null },
      channels: { first: () => extra.channel || null },
    },
  });
  return {
    cmd,
    ctx: {
      source: 'prefix',
      guild,
      member: { id: 'owner', permissions: { has: () => true }, roles: { cache: new Map() } },
      user: { id: 'owner', tag: 'Owner#0001' },
      channel: {
        id: 'ch1',
        name: 'general',
        toString: () => '#general',
        messages: { fetch: async () => new Map() },
        bulkDelete: async () => ({ size: 0 }),
        permissionOverwrites: { edit: async () => {} },
        setName: async () => {},
        send: async () => {},
      },
      client: { ws: { ping: 12 } },
      message: {
        id: 'm1',
        mentions: {
          users: { first: () => extra.user || null },
          roles: { first: () => extra.role || null },
          channels: { first: () => extra.channel || null },
        },
        content: `,${name} ${args.join(' ')}`.trim(),
      },
      args,
      config,
      ...getters,
      reply: async (content) => {
        const text = typeof content === 'string'
          ? content
          : (content?.content || content?.embeds?.[0]?.data?.title || content?.embeds?.[0]?.title || JSON.stringify(content));
        replies.push(text);
        return {};
      },
      ...extra.ctx,
    },
  };
}

describe('help-advertised commands reply correctly', () => {
  it('core help hub aliases resolve', () => {
    const { registry } = boot();
    for (const n of ['help', 'start', 'spaces', 'maphelp', 'ping', 'avatar', 'hangout', 'play', 'player', 'tickets', 'vm', 'fp', 'purge', 'afk', 'canvasevents', 'rooms', 'chat', 'eat', 'pet']) {
      assert.ok(registry.get(n), `help advertises missing command/alias: ${n}`);
    }
    assert.equal(registry.get('vm').name, 'voicemaster');
    assert.equal(registry.get('fp').name, 'fakepermissions');
    assert.equal(registry.get('vanity').name, 'vanityrole');
    assert.equal(registry.get('rooms').name, 'roomsnapshot');
  });

  it('/help topics return embeds', async () => {
    const { registry, config } = boot();
    for (const topic of ['hub', 'spaces', 'music', 'tickets', 'mods', 'security', 'community', 'all']) {
      const replies = [];
      const { cmd, ctx } = ownerCtx(registry, config, { name: 'help', args: [topic], replies });
      await cmd.run(ctx);
      assert.ok(replies.length >= 1, `help ${topic} should reply`);
    }
  });

  it(',tickets form … parses action form (not full remainder)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-tix-'));
    const config = new ConfigStore({ dir });
    const registry = new CommandRegistry({ prefix: ',' });
    const hub = new EventHub();
    createTickets({ config, hub, client: {} }).register(registry);
    config.update('g1', (c) => {
      c.tickets.enabled = true;
      return c;
    });
    const replies = [];
    const { cmd, ctx } = ownerCtx(registry, config, {
      name: 'tickets',
      args: ['form', 'Bug', '|', 'Report', 'a', 'bug', '|', 'Steps?'],
      replies,
    });
    // ManageGuild for form
    ctx.member.permissions.has = (p) => p === 'ManageGuild' || p === 'Administrator' || true;
    await cmd.run(ctx);
    assert.ok(replies[0]);
    assert.match(replies[0], /form|Form|Bug|saved|Usage/i);
    assert.doesNotMatch(replies[0], /^Open tickets|^No open/i);
  });

  it('single-token staff commands from help reply', async () => {
    const { registry, config } = boot();
    const cases = [
      ['security', ['full'], /Full security|enabled|Owner only/i],
      ['automod', ['on'], /Automod|on|Need|Denied/i],
      ['log', ['on'], /log|Log|on|Need|Denied|enabled/i],
      ['chat', ['status'], /Discord chat|open chat|@mention/i],
      ['vm', ['status'], /vm=/i],
      ['ping', [], /Pong/i],
      ['canvasevents', [], /No canvas events|• /],
      ['roomsnapshot', [], /Rooms/],
      ['afk', ['brb', 'soon'], /AFK set: brb soon/],
    ];
    for (const [name, args, re] of cases) {
      const replies = [];
      const { cmd, ctx } = ownerCtx(registry, config, { name, args, replies });
      await cmd.run(ctx);
      assert.ok(replies.length, `${name} should reply`);
      assert.match(String(replies[0]), re, `${name} reply mismatch: ${replies[0]}`);
    }
  });

  it(',fp harden @role parses action and replies Hardened', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-fp-h-'));
    const config = new ConfigStore({ dir });
    const registry = new CommandRegistry({ prefix: ',' });
    createFakePerms({ config }).register(registry);
    const role = {
      id: 'role1',
      toString: () => '@Mod',
      permissions: {
        bitfield: 8n,
        has: () => true,
        remove() { return this; },
      },
      setPermissions: async () => {},
    };
    const replies = [];
    const { cmd, ctx } = ownerCtx(registry, config, {
      name: 'fp',
      args: ['harden', '<@&role1>'],
      replies,
      extra: { role },
    });
    await cmd.run(ctx);
    assert.ok(replies[0], 'fp harden must reply');
    assert.match(replies[0], /Hardened/);
    assert.doesNotMatch(replies[0], /^Actions:/);
  });
});
