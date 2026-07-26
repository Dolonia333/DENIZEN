#!/usr/bin/env node
'use strict';

/**
 * Dry-run every registered command with a mocked owner context.
 * Classifies: ok | needs_args | needs_live | error
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const { ConfigStore } = require('../src/core/config-store');
const { CommandRegistry } = require('../src/core/command-registry');
const { EventHub } = require('../src/core/event-hub');
const { loadModules } = require('../src/modules/load-modules');
const { bindPrefixOptionGetters } = require('../src/core/command-registry');

function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-probe-'));
  const config = new ConfigStore({ dir });
  const registry = new CommandRegistry({ prefix: ',' });
  const hub = new EventHub();
  const client = {
    on() {},
    once() {},
    user: { id: 'bot1', username: 'DENIZEN' },
    guilds: { cache: new Map() },
    ws: { ping: 12 },
  };
  const tracker = {
    snapshot: () => ({ rooms: [], members: [], people: [], guildId: 'g1' }),
    _canvasEvents: [],
    isOnMap: () => false,
    setMapAction() {},
    hangoutTop: () => [],
  };
  loadModules({ config, registry, hub, tracker, audit: {}, client });
  return { config, registry, client, tracker };
}

function makeCtx(cmd, config, args = []) {
  const replies = [];
  const guild = {
    id: 'g1',
    ownerId: 'owner',
    name: 'Probe Guild',
    channels: {
      cache: new Map(),
      create: async ({ name }) => ({ id: `ch-${name}`, name, toString: () => `#${name}` }),
      fetch: async () => null,
    },
    members: {
      me: {
        permissions: { has: () => true },
        voice: { channel: null },
        roles: { highest: { name: 'Denizen', position: 10, id: 'botrole' } },
      },
      cache: new Map(),
      fetch: async () => null,
      fetchMe: async () => null,
    },
    roles: {
      cache: { filter: () => [], find: () => null, get: () => null },
      create: async ({ name }) => ({ id: `r-${name}`, name }),
    },
    bans: { create: async () => {}, remove: async () => {}, fetch: async () => new Map() },
  };
  const getters = bindPrefixOptionGetters(cmd, args, {
    mentions: {
      users: { first: () => null },
      roles: { first: () => null },
      members: { first: () => null },
      channels: { first: () => null },
    },
  });
  return {
    source: 'prefix',
    guild,
    member: {
      id: 'owner',
      permissions: { has: () => true },
      roles: { cache: new Map(), highest: { position: 5 } },
      voice: { channel: null },
    },
    user: { id: 'owner', tag: 'Owner#0001', username: 'Owner' },
    channel: {
      id: 'ch1',
      name: 'general',
      toString: () => '#general',
      messages: { fetch: async () => new Map() },
      bulkDelete: async () => ({ size: 0 }),
      permissionOverwrites: { edit: async () => {}, set: async () => {} },
      send: async (p) => { replies.push(p); return { id: 'm1', edit: async () => {} }; },
    },
    client: { user: { id: 'bot1' }, ws: { ping: 12 } },
    config,
    options: getters,
    reply: async (p) => { replies.push(p); },
    deferReply: async () => {},
    editReply: async (p) => { replies.push(p); },
    followUp: async (p) => { replies.push(p); },
    _replies: replies,
  };
}

function classify(err, replies) {
  const blob = JSON.stringify(replies || []).toLowerCase()
    + ' '
    + String(err?.message || err || '').toLowerCase();
  if (/missing|required|usage|provide|specify|need |invalid|choose|who |mention|amount|duration/.test(blob)
      && !/internal|cannot read|undefined|is not a function|econn|fetch failed/.test(blob)) {
    return 'needs_args';
  }
  if (/lavalink|voice channel|not in a|join a|no node|token|api key|premium|upgrade|plan|not linked|denizen url|http/.test(blob)) {
    return 'needs_live';
  }
  if (err) return 'error';
  if (!replies?.length) return 'silent_ok';
  return 'ok';
}

async function main() {
  const { config, registry } = boot();
  const cmds = registry.list().sort((a, b) => a.name.localeCompare(b.name));
  const rows = [];

  for (const cmd of cmds) {
    const ctx = makeCtx(cmd, config, []);
    let err = null;
    try {
      await Promise.race([
        cmd.run(ctx),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout_3s')), 3000)),
      ]);
    } catch (e) {
      err = e;
    }
    const status = classify(err, ctx._replies);
    const preview = ctx._replies[0]
      ? (typeof ctx._replies[0] === 'string'
        ? ctx._replies[0]
        : (ctx._replies[0].content || ctx._replies[0].embeds?.[0]?.title || ctx._replies[0].embeds?.[0]?.description || JSON.stringify(ctx._replies[0])).slice(0, 120))
      : (err ? String(err.message || err).slice(0, 120) : '');
    rows.push({
      name: cmd.name,
      slash: cmd.slash !== false,
      module: cmd.module || cmd.category || '',
      status,
      preview: String(preview).replace(/\s+/g, ' ').trim(),
    });
  }

  const by = {};
  for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;

  console.log(JSON.stringify({
    total: rows.length,
    summary: by,
    errors: rows.filter((r) => r.status === 'error'),
    needs_live: rows.filter((r) => r.status === 'needs_live').map((r) => r.name),
    needs_args: rows.filter((r) => r.status === 'needs_args').map((r) => r.name),
    ok: rows.filter((r) => r.status === 'ok' || r.status === 'silent_ok').map((r) => r.name),
    all: rows,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
