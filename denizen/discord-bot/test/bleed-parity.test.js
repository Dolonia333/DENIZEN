'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { ConfigStore, defaultGuildConfig } = require('../src/core/config-store');
const { createAntinuke, MODULE_KEYS } = require('../src/modules/security/antinuke');
const { parseDurationMs } = require('../src/modules/security/antiraid');
const { renderTemplate } = require('../src/core/embed-vars');
const { CommandRegistry } = require('../src/core/command-registry');
const { EventHub } = require('../src/core/event-hub');
const { loadModules } = require('../src/modules/load-modules');

describe('Bleed-parity config + modules', () => {
  it('defaultGuildConfig includes full antinuke modules and tickets/vm/logging', () => {
    const d = defaultGuildConfig();
    for (const k of MODULE_KEYS) {
      assert.equal(typeof d.security.antinuke.modules[k], 'boolean');
    }
    assert.ok(d.tickets);
    assert.ok(d.voicemaster);
    assert.ok(d.logging);
    assert.ok(d.community.levels.rewards);
    assert.ok(d.automod.caps);
  });

  it('renderTemplate substitutes user and server', () => {
    const out = renderTemplate('Hi {user.name} @ {server}', {
      user: { id: '1', username: 'Ada' },
      guild: { name: 'HQ', memberCount: 9 },
    });
    assert.match(out, /Ada/);
    assert.match(out, /HQ/);
  });

  it('parseDurationMs handles 2h', () => {
    assert.equal(parseDurationMs('2h'), 2 * 3600 * 1000);
    assert.equal(parseDurationMs('30m'), 30 * 60 * 1000);
  });

  it('loadModules registers core Bleed command names', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-cfg-'));
    const config = new ConfigStore({ dir });
    const registry = new CommandRegistry({ prefix: ',' });
    const hub = new EventHub();
    const client = { on() {}, once() {}, guilds: { cache: new Map() } };
    const tracker = { snapshot: () => ({ rooms: [], people: [] }), _canvasEvents: [] };
    loadModules({ config, registry, hub, tracker, audit: {}, client });
    const names = new Set(registry.list().map((c) => c.name));
    for (const n of [
      'antinuke', 'antiraid', 'fakepermissions', 'ban', 'softban', 'purge',
      'automod', 'tickets', 'voicemaster', 'play', 'lastfm', 'reactionrole',
      'buttonrole', 'log', 'lockdown', 'setup', 'help', 'blacktea', 'image',
      'translate', 'urban', 'define', 'afk',
    ]) {
      assert.ok(names.has(n), `missing command ${n}`);
    }
  });

  it('forceBotMod blocks Discord Admin without fakeperm', () => {
    const { canRunCommand } = require('../src/core/permissions');
    const cfg = defaultGuildConfig();
    cfg.security.fakePermissions.forceBotMod = true;
    const member = {
      roles: { cache: new Map() },
      permissions: { has: (p) => p === 'Administrator' },
    };
    const r = canRunCommand({
      guild: { ownerId: 'owner' },
      member,
      user: { id: 'mod' },
      config: { get: () => cfg },
    }, { fakePerm: 'ban_members' });
    assert.equal(r.ok, false);
  });

  it('antinuke trips after threshold audit events', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-an-'));
    const config = new ConfigStore({ dir });
    const hub = new EventHub();
    const events = [];
    hub.on('security.antinuke', (e) => events.push(e.payload || e));
    const an = createAntinuke({ config, hub });
    const guildId = 'g1';
    config.update(guildId, (c) => {
      c.security.enabled = true;
      c.security.antinuke.enabled = true;
      c.security.antinuke.threshold = 2;
      c.security.antinuke.modules.ban = true;
      return c;
    });
    const guild = {
      id: guildId,
      ownerId: 'owner',
      client: { user: { id: 'bot' } },
      members: { fetch: async () => null },
      channels: { fetch: async () => null },
      fetchOwner: async () => ({ send: async () => {} }),
    };
    an.onAudit({ guild, guildId, executorId: 'rogue', kind: 'ban' });
    an.onAudit({ guild, guildId, executorId: 'rogue', kind: 'ban' });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'ban');
  });
});
