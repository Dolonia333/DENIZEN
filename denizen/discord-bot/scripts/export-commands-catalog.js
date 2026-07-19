'use strict';

/**
 * Dump CommandRegistry → discord-commands/commands.json for the public catalog.
 * Run: node scripts/export-commands-catalog.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { ConfigStore } = require('../src/core/config-store');
const { CommandRegistry } = require('../src/core/command-registry');
const { EventHub } = require('../src/core/event-hub');
const { loadModules } = require('../src/modules/load-modules');

const PREMIUM_MODULES = new Set(['security', 'community']);

/** Catalog badges — avatar is gated as a module but free users still get premade/skin. */
const MODULE_META = {
  core: { label: 'Getting started', order: 10 },
  denizen: { label: 'Account', order: 20 },
  avatar: {
    label: 'Avatar & pets',
    order: 30,
    // Not full "Premium" — free: premade + skin; paid: hair/clothes/hats
    badge: 'Free + paid',
    badgeKind: 'mixed',
  },
  hangout: { label: 'Hangout', order: 40 },
  canvas: { label: 'Spaces canvas', order: 50 },
  chat: { label: 'Chat', order: 60 },
  music: { label: 'Music', order: 70 },
  tickets: { label: 'Tickets', order: 80 },
  voicemaster: { label: 'VoiceMaster', order: 90 },
  moderation: { label: 'Moderation', order: 100 },
  automod: { label: 'Automod', order: 110 },
  logging: { label: 'Logging', order: 120 },
  security: { label: 'Security', order: 130, badge: 'Premium', badgeKind: 'premium' },
  community: { label: 'Community', order: 140, badge: 'Premium', badgeKind: 'premium' },
  integrations: { label: 'Integrations', order: 150 },
  misc: { label: 'Utility', order: 160 },
  sense: { label: 'Sense', order: 170 },
};

/** Per-command free vs paid for mixed modules (avatar). */
const COMMAND_PLAN = {
  avatar: {
    plan: 'mixed',
    planLabel: 'Free + paid',
    planDetail: 'Free: premade + skin · Paid: full closet',
  },
  skin: { plan: 'free', planLabel: 'Free', planDetail: 'Basic skin tones' },
  hair: { plan: 'paid', planLabel: 'Paid', planDetail: 'Needs Community / Pro plan' },
  clothes: { plan: 'paid', planLabel: 'Paid', planDetail: 'Needs Community / Pro plan' },
  pet: { plan: 'paid', planLabel: 'Paid', planDetail: 'One-time pet purchase or Pro grant' },
};

function accessLabel(cmd) {
  if (cmd.ownerOnly) return { kind: 'owner', label: 'Server owner' };
  if (cmd.fakePerm) {
    return { kind: 'fakeperm', label: String(cmd.fakePerm).replace(/_/g, ' ') };
  }
  if (cmd.permission) {
    return { kind: 'discord', label: String(cmd.permission).replace(/([a-z])([A-Z])/g, '$1 $2') };
  }
  return { kind: 'everyone', label: 'Everyone' };
}

function optionSummary(opt) {
  if (!opt || typeof opt !== 'object') return null;
  const name = opt.name || 'opt';
  const req = opt.required ? '' : '?';
  return `${name}${req}`;
}

function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-cmd-export-'));
  const config = new ConfigStore({ dir });
  const registry = new CommandRegistry({ prefix: ',' });
  const hub = new EventHub();
  const client = { on() {}, once() {}, guilds: { cache: new Map() }, ws: { ping: 0 } };
  const tracker = {
    snapshot: () => ({ rooms: [], members: [], people: [] }),
    _canvasEvents: [],
    isOnMap: () => false,
    setMapAction() {},
  };
  loadModules({ config, registry, hub, tracker, audit: {}, client });

  const commands = registry.list().map((cmd) => {
    const access = accessLabel(cmd);
    const moduleKey = String(cmd.module || 'misc').toLowerCase();
    const meta = MODULE_META[moduleKey] || { label: moduleKey, order: 500 };
    const badgeKind = meta.badgeKind
      || (PREMIUM_MODULES.has(moduleKey) ? 'premium' : null);
    const badge = meta.badge
      || (badgeKind === 'premium' ? 'Premium' : null);
    // Per-command: only full premium modules (not mixed avatar)
    const premium = badgeKind === 'premium';
    const planMeta = COMMAND_PLAN[cmd.name] || null;
    return {
      name: cmd.name,
      description: cmd.description || cmd.name,
      aliases: Array.isArray(cmd.aliases) ? cmd.aliases : [],
      module: moduleKey,
      moduleLabel: meta.label,
      moduleOrder: meta.order,
      slash: cmd.slash !== false,
      public: !!cmd.public,
      premium,
      plan: planMeta?.plan || null,
      planLabel: planMeta?.planLabel || null,
      planDetail: planMeta?.planDetail || null,
      access,
      options: (cmd.options || []).map((o) => ({
        name: o.name,
        description: o.description || '',
        type: o.type,
        required: !!o.required,
        summary: optionSummary(o),
      })),
    };
  });

  commands.sort((a, b) =>
    (a.moduleOrder - b.moduleOrder) || a.name.localeCompare(b.name));

  const modules = [...new Map(
    commands.map((c) => [c.module, {
      id: c.module,
      label: c.moduleLabel,
      order: c.moduleOrder,
      premium: c.premium,
      badge: null,
      badgeKind: null,
      count: 0,
    }]),
  ).values()].map((m) => {
    const meta = MODULE_META[m.id] || {};
    m.count = commands.filter((c) => c.module === m.id).length;
    m.badgeKind = meta.badgeKind
      || (PREMIUM_MODULES.has(m.id) && m.id !== 'avatar' ? 'premium' : null);
    if (m.id === 'avatar') {
      m.badgeKind = 'mixed';
      m.badge = 'Free + paid';
      m.premium = false;
      m.planSplit = {
        free: [
          { cmd: '/avatar', detail: 'Premade looks, edit, show, random' },
          { cmd: ',skin', detail: 'Basic skin tones' },
          { cmd: 'Boost', detail: 'Golden headset (Discord boost)' },
        ],
        paid: [
          { cmd: ',hair / ,clothes', detail: 'Custom layers & full closet' },
          { cmd: ',pet buy', detail: 'Companion pet (checkout or Pro grant)' },
        ],
      };
    } else if (m.badgeKind === 'premium') {
      m.badge = meta.badge || 'Premium';
      m.premium = true;
    } else {
      m.badge = meta.badge || null;
      m.premium = false;
    }
    return m;
  }).sort((a, b) => a.order - b.order);

  const outDir = path.join(__dirname, '..', '..', 'discord-commands');
  fs.mkdirSync(outDir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    prefix: ',',
    count: commands.length,
    modules,
    commands,
  };
  const outFile = path.join(outDir, 'commands.json');
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[export-commands] wrote ${commands.length} commands → ${outFile}`);
}

main();
