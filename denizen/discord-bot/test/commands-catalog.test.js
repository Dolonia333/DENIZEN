'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

describe('commands catalog export', () => {
  it('export:commands writes searchable catalog JSON', () => {
    const script = path.join(__dirname, '..', 'scripts', 'export-commands-catalog.js');
    const out = path.join(__dirname, '..', '..', 'discord-commands', 'commands.json');
    const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.ok(fs.existsSync(out));
    const data = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.ok(data.count >= 90);
    assert.ok(Array.isArray(data.commands));
    assert.ok(Array.isArray(data.modules));
    const purge = data.commands.find((c) => c.name === 'purge');
    assert.ok(purge);
    assert.equal(purge.access.kind, 'fakeperm');
    assert.ok(purge.slash);
    const security = data.modules.find((m) => m.id === 'security');
    assert.ok(security?.premium);
    assert.equal(security.badge, 'Premium');
    const avatar = data.modules.find((m) => m.id === 'avatar');
    assert.equal(avatar?.premium, false);
    assert.equal(avatar?.badge, 'Free + paid');
    assert.equal(avatar?.badgeKind, 'mixed');
    assert.ok(avatar?.planSplit?.free?.length);
    assert.ok(avatar?.planSplit?.paid?.length);
    const hair = data.commands.find((c) => c.name === 'hair');
    assert.equal(hair?.plan, 'paid');
    const skin = data.commands.find((c) => c.name === 'skin');
    assert.equal(skin?.plan, 'free');
    const prefixCmd = data.commands.find((c) => c.name === 'prefix');
    assert.ok(prefixCmd);
    assert.equal(prefixCmd.module, 'core');
  });

  it('commandsUrl points at discord-commands', () => {
    const { commandsUrl } = require('../src/help-copy');
    assert.match(commandsUrl(), /\/discord-commands\/?$/);
  });
});
