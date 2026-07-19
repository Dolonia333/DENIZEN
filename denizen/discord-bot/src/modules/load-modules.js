'use strict';

/**
 * Bootstrap all Bleed-parity modules onto registry + event hooks.
 */

const { createAntinuke } = require('./security/antinuke');
const { createAntiraid } = require('./security/antiraid');
const { createFakePerms } = require('./security');
const { createModeration } = require('./moderation');
const { createAutomod } = require('./automod');
const { createCommunity } = require('./community');
const { createVoiceMaster } = require('./voicemaster');
const { createTickets } = require('./tickets');
const { createMusic } = require('./music');
const { createIntegrations } = require('./integrations');
const { createLogging } = require('./logging');
const { createMisc } = require('./misc');
const { createCanvasBridge } = require('./canvas');
const { createDenizenAccount } = require('./denizen');
const { createAvatarModule } = require('./avatar');
const { createHangoutModule } = require('./hangout');
const { createDataFarm } = require('./data-farm');
const { createEconomy } = require('./economy');
const { createPvp } = require('./pvp');
const { createShop } = require('./shop');
const { createChatControls } = require('../chat');
const { canRunCommand } = require('../core/permissions');
const { WalletStore } = require('../core/wallet-store');

// Entitlement source of truth (shared with command gating). Best-effort: if it
// can't load, premium hooks run ungated rather than the bot failing to boot.
const guildPlans = (() => {
  try { return require('../../../src/denizen-guild-plans.js'); }
  catch (_) { return null; }
})();

/** Pull a guild id out of whatever event args a hook receives. */
function extractGuildId(args) {
  for (const a of args) {
    if (!a || typeof a !== 'object') continue;
    if (typeof a.guildId === 'string' && a.guildId) return a.guildId;       // interaction, audit evt
    if (a.guild && a.guild.id) return a.guild.id;                           // member, message, state
    if (a.message && a.message.guild && a.message.guild.id) return a.message.guild.id; // reaction
  }
  return null;
}

/**
 * Wrap a PREMIUM module's event hook so it only runs for guilds with an active
 * plan. Without this, passive protection (antinuke audit sweeps, antiraid join
 * checks, community listeners) ran for every guild regardless of payment —
 * command gating alone left the paid value fully available for free.
 *
 * Free modules, an unrecognized module, or a missing entitlement module pass
 * through untouched. No guild context (DM) → runs. Fails closed (skips) on an
 * entitlement error, consistent with command-registry gating.
 */
function gatedHook(moduleName, fn) {
  if (typeof fn !== 'function') return fn;
  if (!guildPlans || !guildPlans.isPremiumModule(moduleName)) return fn;
  /** @type {Set<string>} guildIds already notified this process */
  const noticed = gatedHook._noticed || (gatedHook._noticed = new Set());
  return async (...args) => {
    const gid = extractGuildId(args);
    if (gid) {
      let allowed = false;
      try { allowed = await guildPlans.isModuleAllowed(gid, moduleName); }
      catch (_) { allowed = false; }
      if (!allowed) {
        // One-time staff-facing log so silent skips aren't mysterious
        const key = `${gid}:${moduleName}`;
        if (!noticed.has(key)) {
          noticed.add(key);
          console.warn(`[premium] skipping ${moduleName} hooks for guild ${gid} (no active plan)`);
        }
        return undefined;
      }
    }
    return fn(...args);
  };
}

function loadModules(deps) {
  const hooks = {
    onAudit: [],
    onMemberAdd: [],
    onMemberRemove: [],
    onGuildMemberUpdate: [],
    onMessage: [],
    onMessageDelete: [],
    onMessageUpdate: [],
    onReactionAdd: [],
    onReactionRemove: [],
    onVoiceStateUpdate: [],
    onInteraction: [],
  };

  const antinuke = createAntinuke(deps);
  antinuke.register(deps.registry);
  hooks.onAudit.push(gatedHook('security', antinuke.onAudit));

  const antiraid = createAntiraid(deps);
  antiraid.register(deps.registry);
  hooks.onMemberAdd.push(gatedHook('security', antiraid.onMemberAdd));

  const fake = createFakePerms(deps);
  fake.register(deps.registry);

  const mod = createModeration(deps);
  mod.register(deps.registry);

  const automod = createAutomod(deps);
  automod.register(deps.registry);
  hooks.onMessage.push(automod.onMessage);
  hooks.onMessageDelete.push(automod.onMessageDelete);
  hooks.onMessageUpdate.push(automod.onMessageUpdate);
  if (automod.onReactionRemove) {
    hooks.onReactionRemove = hooks.onReactionRemove || [];
    hooks.onReactionRemove.push(automod.onReactionRemove);
  }

  const community = createCommunity(deps);
  community.register(deps.registry);
  hooks.onMemberAdd.push(gatedHook('community', community.onMemberAdd));
  hooks.onMemberRemove.push(gatedHook('community', community.onMemberRemove));
  hooks.onMessage.push(gatedHook('community', community.onMessage));
  hooks.onReactionAdd.push(gatedHook('community', community.onReactionAdd));
  hooks.onGuildMemberUpdate.push(gatedHook('community', community.onGuildMemberUpdate));
  hooks.onInteraction.push(gatedHook('community', community.onInteraction));

  // Logging after community so ,log embeds/toggles win as the logging module
  const logging = createLogging(deps);
  logging.register(deps.registry);
  hooks.onMessageDelete.push(logging.onMessageDelete);
  hooks.onMessageUpdate.push(logging.onMessageUpdate);
  hooks.onMemberAdd.push(logging.onMemberAdd);
  hooks.onMemberRemove.push(logging.onMemberRemove);
  hooks.onVoiceStateUpdate.push(logging.onVoiceStateUpdate);
  hooks.onAudit.push(logging.onAudit);

  const vm = createVoiceMaster(deps);
  vm.register(deps.registry);
  hooks.onVoiceStateUpdate.push(vm.onVoiceStateUpdate);
  hooks.onInteraction.push(vm.onInteraction);

  const tickets = createTickets(deps);
  tickets.register(deps.registry);
  hooks.onInteraction.push(tickets.onInteraction);

  const music = createMusic(deps);
  music.register(deps.registry);
  if (music.onInteraction) hooks.onInteraction.push(music.onInteraction);

  const integrations = createIntegrations(deps);
  integrations.register(deps.registry);

  const misc = createMisc(deps);
  misc.register(deps.registry);
  if (misc.onMessage) hooks.onMessage.push(misc.onMessage);
  if (misc.onReactionAdd) hooks.onReactionAdd.push(misc.onReactionAdd);

  const canvas = createCanvasBridge(deps);
  canvas.attach();
  canvas.register(deps.registry);

  const denizenAccount = createDenizenAccount(deps);
  denizenAccount.register(deps.registry);

  const avatar = createAvatarModule(deps);
  avatar.register(deps.registry);
  hooks.onInteraction.push(gatedHook('avatar', avatar.onInteraction));

  const hangout = createHangoutModule(deps);
  hangout.register(deps.registry);

  // Credits wallet + button PVP duels (shared WalletStore)
  deps.wallet = deps.wallet || new WalletStore();
  const economy = createEconomy(deps);
  economy.register(deps.registry);
  hooks.onMessage.push(economy.onMessage);

  const pvp = createPvp(deps);
  pvp.register(deps.registry);
  hooks.onInteraction.push(pvp.onInteraction);

  const shop = createShop(deps);
  shop.register(deps.registry);

  // Discord data farm — harvest guild chats into learning lake (privacy-aware)
  const dataFarm = createDataFarm(deps);
  dataFarm.register(deps.registry);
  hooks.onMessage.push(dataFarm.onMessage);

  // Open-channel chat controls (,chat on|off|status)
  const chatControls = createChatControls(deps);
  chatControls.register(deps.registry);

  const helpCopy = require('../help-copy');
  const {
    helpHubEmbed,
    helpHubRows,
    baseEmbed,
    infoEmbed,
    successEmbed,
    BRAND,
    securityDashboardEmbed,
  } = require('../core/ui-kit');
  const defaultPrefix = deps.registry.prefix || ',';

  function guildPrefix(guildId) {
    if (guildId && deps.config?.get) {
      const p = deps.config.get(guildId).prefix;
      if (typeof p === 'string' && p.length) return p;
    }
    return defaultPrefix;
  }

  function topicEmbed(topic, guildId, by) {
    const prefix = guildPrefix(guildId);
    if (topic === 'spaces' || topic === 'avatar' || topic === 'hangout') {
      return helpCopy.spacesHelpEmbed({ prefix, guildId });
    }
    if (topic === 'music') {
      return baseEmbed({
        color: BRAND.primary,
        title: '♪ Music player',
        description: 'Interactive panel beats a wall of text commands.',
        fields: [
          { name: 'Play', value: `\`/play\` · \`${prefix}play <song>\``, inline: true },
          { name: 'Panel', value: `\`${prefix}player\` — pin in #music`, inline: true },
          { name: 'Controls', value: 'Skip · Pause · Stop · Loop · Filters on the panel', inline: false },
          { name: 'Lavalink', value: `\`${prefix}lavalink\` node status`, inline: true },
        ],
      });
    }
    if (topic === 'tickets') {
      return baseEmbed({
        color: BRAND.info,
        title: '🎫 Tickets',
        description: 'Support desk with forms, SLA, notes, and transcripts.',
        fields: [
          { name: 'Staff', value: `\`${prefix}tickets setup\` · panel · sla`, inline: false },
          { name: 'Forms', value: `\`${prefix}tickets form Label | desc | Q1?, Q2?\``, inline: false },
          { name: 'Live ticket', value: 'claim · note · archive · reopen', inline: false },
        ],
      });
    }
    if (topic === 'security') {
      const s = deps.config.get(guildId || '0')?.security || {};
      const emb = securityDashboardEmbed(s);
      emb.setFooter({ text: 'Denizen Spaces · security is a premium module' });
      return emb;
    }
    if (topic === 'mods') {
      return baseEmbed({
        color: BRAND.warn,
        title: '⚔ Moderation',
        description: 'Case-logged staff tools + automod.',
        fields: [
          { name: 'Setup', value: `\`${prefix}setup\` · \`${prefix}setupmute\` · \`${prefix}log on\``, inline: false },
          { name: 'Actions', value: 'ban · softban · kick · timeout · warn · jail · mute · imagemute · reactionmute · purge', inline: false },
          { name: 'Automod', value: `\`${prefix}automod on\` · snipe · reactionsnipe`, inline: false },
        ],
      });
    }
    if (topic === 'community') {
      return baseEmbed({
        color: BRAND.success,
        title: 'Community 💎',
        description: 'Premium module — levels, roles, starboard, giveaways.',
        fields: [
          { name: 'Levels', value: `\`${prefix}levels rank\` · lb · reward`, inline: true },
          { name: 'Roles', value: 'reactionrole · buttonrole · vanityrole', inline: true },
          { name: 'Fun', value: 'starboard · giveaway · blacktea', inline: true },
        ],
      });
    }
    if (topic === 'all' && by) {
      const lines = [...by.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([mod, names]) => `**${mod}**: ${names.slice(0, 10).join(', ')}${names.length > 10 ? '…' : ''}`);
      return baseEmbed({
        title: 'All modules',
        description: lines.join('\n').slice(0, 4000),
      });
    }
    return helpHubEmbed(prefix);
  }

  deps.registry.register({
    name: 'ping',
    description: 'Check bot latency',
    module: 'core',
    async run(ctx) {
      const t = Date.now();
      const ms = Date.now() - t;
      const p = guildPrefix(ctx.guild?.id);
      await ctx.reply({
        embeds: [successEmbed(
          'Pong',
          `**${ms}ms** round-trip · WS **${Math.round(ctx.client.ws.ping)}ms**\n_Denizen Spaces · \`${p}help\`_`,
        )],
      });
    },
  });

  deps.registry.register({
    name: 'prefix',
    description: 'View or set the server command prefix (Manage Server to change)',
    module: 'core',
    options: [
      {
        type: 3,
        name: 'action',
        description: 'view | set | remove',
        required: false,
        choices: [
          { name: 'View current prefix', value: 'view' },
          { name: 'Set a new prefix', value: 'set' },
          { name: 'Reset to default (,)', value: 'remove' },
        ],
      },
      {
        type: 3,
        name: 'prefix',
        description: 'New prefix (1–5 characters)',
        required: false,
      },
    ],
    async run(ctx) {
      if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
      const current = guildPrefix(ctx.guild.id);
      const actionRaw = (ctx.getString?.('action') || ctx.args?.[0] || 'view').toLowerCase();
      const valueOpt = ctx.getString?.('prefix');

      // ,prefix !  OR  ,prefix set !  OR  /prefix action:set prefix:!
      let action = actionRaw;
      let next = valueOpt;
      if (['view', 'show', 'get', 'current'].includes(actionRaw)) {
        action = 'view';
      } else if (['remove', 'reset', 'clear', 'default'].includes(actionRaw)) {
        action = 'remove';
      } else if (actionRaw === 'set') {
        action = 'set';
        next = valueOpt || ctx.args?.[1];
      } else if (actionRaw && actionRaw !== 'view') {
        // First token is the new prefix itself (,prefix !)
        action = 'set';
        next = valueOpt || ctx.args?.[0] || actionRaw;
      } else {
        action = 'view';
      }

      if (action === 'view') {
        return ctx.reply(
          `Server prefix is \`${current}\` — try \`${current}help\`.\n`
          + `Change it: \`${current}prefix set !\` · Reset: \`${current}prefix remove\``,
        );
      }

      if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) {
        return ctx.reply('Need **Manage Server** to change the prefix.');
      }

      if (action === 'remove') {
        deps.config.update(ctx.guild.id, (c) => {
          c.prefix = defaultPrefix;
          return c;
        });
        return ctx.reply(`Prefix reset to \`${defaultPrefix}\`.`);
      }

      const candidate = String(next || '').trim();
      if (!candidate) {
        return ctx.reply(`Usage: \`${current}prefix set <prefix>\` (1–5 characters)`);
      }
      if (candidate.length > 5) {
        return ctx.reply('Prefix must be 1–5 characters.');
      }
      if (/\s/.test(candidate)) {
        return ctx.reply('Prefix cannot contain spaces.');
      }
      if (candidate.startsWith('/')) {
        return ctx.reply('Prefix cannot start with `/` (reserved for slash commands).');
      }

      deps.config.update(ctx.guild.id, (c) => {
        c.prefix = candidate;
        return c;
      });
      return ctx.reply(`Prefix set to \`${candidate}\` — example: \`${candidate}help\`.`);
    },
  });

  deps.registry.register({
    name: 'help',
    description: 'Interactive Denizen Spaces command hub',
    module: 'core',
    options: [
      {
        type: 3,
        name: 'topic',
        description: 'spaces | music | tickets | mods | security | all',
        required: false,
        choices: [
          { name: 'Command hub', value: 'hub' },
          { name: 'Spaces map', value: 'spaces' },
          { name: 'Music player', value: 'music' },
          { name: 'Tickets', value: 'tickets' },
          { name: 'Moderation', value: 'mods' },
          { name: 'Security', value: 'security' },
          { name: 'Community', value: 'community' },
          { name: 'All modules', value: 'all' },
        ],
      },
    ],
    async run(ctx) {
      const topic = (ctx.getString?.('topic') || ctx.args?.[0] || 'hub').toLowerCase();
      const guildId = ctx.guild?.id;
      const prefix = guildPrefix(guildId);
      const by = new Map();
      for (const cmd of deps.registry.list()) {
        if (!by.has(cmd.module)) by.set(cmd.module, []);
        by.get(cmd.module).push(cmd.name);
      }
      if (topic === 'hub' || !topic) {
        await ctx.reply({
          embeds: [helpHubEmbed(prefix)],
          components: helpHubRows(),
        });
        return;
      }
      await ctx.reply({
        embeds: [topicEmbed(topic, guildId, by)],
        components: topic === 'all' ? [] : helpHubRows(),
      });
    },
  });

  // Help select menu
  hooks.onInteraction.push(async (interaction) => {
    if (!interaction.isStringSelectMenu() || interaction.customId !== 'denizen_help_topic') {
      return false;
    }
    const topic = interaction.values[0];
    const by = new Map();
    for (const cmd of deps.registry.list()) {
      if (!by.has(cmd.module)) by.set(cmd.module, []);
      by.get(cmd.module).push(cmd.name);
    }
    await interaction.update({
      embeds: [topicEmbed(topic, interaction.guildId, by)],
      components: helpHubRows(),
    }).catch(async () => {
      await interaction.reply({
        embeds: [topicEmbed(topic, interaction.guildId, by)],
        ephemeral: true,
      }).catch(() => {});
    });
    return true;
  });

  deps.registry.register({
    name: 'start',
    description: 'Get started with the Discord Spaces map',
    module: 'core',
    aliases: ['maphelp', 'spaces'],
    async run(ctx) {
      const guildId = ctx.guild?.id;
      await ctx.reply({
        embeds: [helpCopy.spacesHelpEmbed({
          prefix: guildPrefix(guildId),
          guildId,
          title: 'Enter Denizen Spaces',
        })],
      });
    },
  });

  // Expose workers for index.js onReady
  return {
    ...hooks,
    _community: community,
    _integrations: integrations,
    _music: music,
  };
}

module.exports = { loadModules, _gatedHook: gatedHook, _extractGuildId: extractGuildId };
