#!/usr/bin/env node
'use strict';

const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const { ConfigStore } = require('../src/core/config-store');
const { CommandRegistry } = require('../src/core/command-registry');
const { EventHub } = require('../src/core/event-hub');
const { loadModules } = require('../src/modules/load-modules');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function api(token, p) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'discord.com',
      path: `/api/v10${p}`,
      headers: { Authorization: `Bot ${token}`, 'User-Agent': 'DenizenSlashCompare' },
    }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.end();
  });
}

function registrySlashNames() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-'));
  const config = new ConfigStore({ dir });
  const registry = new CommandRegistry({ prefix: ',' });
  loadModules({
    config,
    registry,
    hub: new EventHub(),
    tracker: {
      snapshot: () => ({ rooms: [], members: [], people: [] }),
      isOnMap: () => false,
      setMapAction() {},
    },
    audit: {},
    client: { on() {}, once() {}, guilds: { cache: new Map() }, ws: { ping: 1 } },
  });
  return registry.list()
    .filter((c) => c.slash !== false)
    .map((c) => c.name)
    .sort();
}

async function main() {
  const env = loadEnv();
  const token = env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.log(JSON.stringify({ ok: false, error: 'no DISCORD_BOT_TOKEN in denizen/.env' }));
    process.exit(1);
  }
  let appId = env.DISCORD_CLIENT_ID || env.DISCORD_APPLICATION_ID || '';
  const me = JSON.parse((await api(token, '/users/@me')).body);
  appId = appId || me.id;
  const guilds = JSON.parse((await api(token, '/users/@me/guilds')).body);
  const reg = registrySlashNames();
  const perGuild = [];
  for (const g of guilds.slice(0, 7)) {
    const r = await api(token, `/applications/${appId}/guilds/${g.id}/commands`);
    const cmds = r.status === 200 ? JSON.parse(r.body) : [];
    const names = Array.isArray(cmds) ? cmds.map((c) => c.name).sort() : [];
    const live = new Set(names);
    const missing = reg.filter((n) => !live.has(n));
    const extra = names.filter((n) => !reg.includes(n));
    perGuild.push({
      guild: g.name,
      id: g.id,
      liveCount: names.length,
      missingCount: missing.length,
      missing: missing.slice(0, 50),
      extra,
    });
  }
  console.log(JSON.stringify({
    bot: `${me.username}#${me.discriminator}`,
    slashTrimEnv: env.DISCORD_SLASH_TRIM || null,
    registrySlashCapable: reg.length,
    guilds: perGuild,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
