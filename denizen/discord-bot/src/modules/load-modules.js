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
const { createChatControls } = require('../chat');

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
  hooks.onAudit.push(antinuke.onAudit);

  const antiraid = createAntiraid(deps);
  antiraid.register(deps.registry);
  hooks.onMemberAdd.push(antiraid.onMemberAdd);

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
  hooks.onMemberAdd.push(community.onMemberAdd);
  hooks.onMemberRemove.push(community.onMemberRemove);
  hooks.onMessage.push(community.onMessage);
  hooks.onReactionAdd.push(community.onReactionAdd);
  hooks.onGuildMemberUpdate.push(community.onGuildMemberUpdate);
  hooks.onInteraction.push(community.onInteraction);

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

  const canvas = createCanvasBridge(deps);
  canvas.attach();
  canvas.register(deps.registry);

  const denizenAccount = createDenizenAccount(deps);
  denizenAccount.register(deps.registry);

  const avatar = createAvatarModule(deps);
  avatar.register(deps.registry);
  hooks.onInteraction.push(avatar.onInteraction);

  const hangout = createHangoutModule(deps);
  hangout.register(deps.registry);

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
  const prefix = deps.registry.prefix || ',';

  function topicEmbed(topic, guildId, by) {
    if (topic === 'spaces' || topic === 'avatar' || topic === 'hangout') {
      return baseEmbed({
        color: BRAND.primary,
        title: 'Spaces map & identity',
        description: helpCopy.spacesIntro({ prefix, guildId }),
        fields: [
          { name: 'Avatar', value: `\`${prefix}avatar\` · boost → golden headset`, inline: true },
          { name: 'Hangout', value: `\`/hangout setup\` · weekly VC board`, inline: true },
          { name: 'Map', value: helpCopy.mapUrl(guildId), inline: false },
        ],
      });
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
      return securityDashboardEmbed(s);
    }
    if (topic === 'mods') {
      return baseEmbed({
        color: BRAND.warn,
        title: '⚔ Moderation',
        description: 'Case-logged staff tools + automod.',
        fields: [
          { name: 'Setup', value: `\`${prefix}setup\` · \`${prefix}setupmute\` · \`${prefix}log on\``, inline: false },
          { name: 'Actions', value: 'ban · softban · kick · timeout · warn · jail · mute · purge', inline: false },
          { name: 'Automod', value: `\`${prefix}automod on\` · snipe · reactionsnipe`, inline: false },
        ],
      });
    }
    if (topic === 'community') {
      return baseEmbed({
        color: BRAND.success,
        title: 'Community',
        fields: [
          { name: 'Levels', value: `\`${prefix}levels rank\` · lb · rewards`, inline: true },
          { name: 'Roles', value: 'reactionrole · buttonrole · vanity', inline: true },
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
      await ctx.reply({
        embeds: [successEmbed(
          'Pong',
          `**${ms}ms** round-trip · WS **${Math.round(ctx.client.ws.ping)}ms**\n_Denizen Spaces · \`${prefix}help\`_`,
        )],
      });
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
        embeds: [baseEmbed({
          color: BRAND.primary,
          title: 'Enter Denizen Spaces',
          description: helpCopy.spacesIntro({ prefix, guildId }),
          fields: [
            { name: 'Open map', value: helpCopy.mapUrl(guildId) || '/discord-map/', inline: false },
            { name: 'Customize', value: `\`${prefix}avatar\` — closet + boost headset`, inline: true },
            { name: 'Music', value: `\`${prefix}player\` — interactive panel`, inline: true },
          ],
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

module.exports = { loadModules };
