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

  const helpCopy = require('../help-copy');
  const prefix = deps.registry.prefix || ',';

  deps.registry.register({
    name: 'ping',
    description: 'Check bot latency',
    module: 'core',
    async run(ctx) {
      const t = Date.now();
      await ctx.reply(
        `Pong — ${Date.now() - t}ms (ws ${Math.round(ctx.client.ws.ping)}ms)\n`
        + `_Bleed-parity + Spaces · \`${prefix}help\`_`,
      );
    },
  });

  deps.registry.register({
    name: 'help',
    description: 'How to use Denizen Spaces + Bleed-parity modules',
    module: 'core',
    options: [
      {
        type: 3,
        name: 'topic',
        description: 'spaces | avatar | hangout | mods | security | all',
        required: false,
        choices: [
          { name: 'Spaces map', value: 'spaces' },
          { name: 'Avatar closet', value: 'avatar' },
          { name: 'Weekly hangout', value: 'hangout' },
          { name: 'Moderation', value: 'mods' },
          { name: 'Security (antinuke/raid)', value: 'security' },
          { name: 'All modules', value: 'all' },
        ],
      },
    ],
    async run(ctx) {
      const topic = (ctx.getString?.('topic') || ctx.args?.[0] || 'spaces').toLowerCase();
      const guildId = ctx.guild?.id;
      const by = new Map();
      for (const cmd of deps.registry.list()) {
        if (!by.has(cmd.module)) by.set(cmd.module, []);
        by.get(cmd.module).push(cmd.name);
      }

      if (topic === 'avatar') {
        await ctx.reply([
          '**Avatar closet**',
          `• \`${prefix}avatar\` / \`/avatar edit\``,
          `• \`${prefix}skin\` · \`${prefix}hair\` · \`${prefix}clothes\``,
          '• Server boost → golden headset',
          helpCopy.mapFooter(guildId),
        ].join('\n'));
        return;
      }
      if (topic === 'hangout') {
        await ctx.reply([
          '**Weekly hangout**',
          `• \`/hangout setup\` · \`report\` · \`enable\``,
          helpCopy.mapFooter(guildId),
        ].join('\n'));
        return;
      }
      if (topic === 'security') {
        await ctx.reply([
          '**Security (Bleed-parity)**',
          `• \`${prefix}security enable\` · \`${prefix}security doctor\``,
          `• \`${prefix}antinuke on\` · module ban|kick|channel|role|webhook|emoji|botadd|vanity`,
          `• \`${prefix}antiraid on\` · avatar · age · massjoin · unlock · lockdown`,
          `• \`${prefix}fakepermissions add @role ban_members\``,
          `• \`${prefix}recentban N\` · \`${prefix}raid 2h ban\``,
        ].join('\n'));
        return;
      }
      if (topic === 'mods') {
        await ctx.reply([
          '**Moderation**',
          `• \`${prefix}setup\` · \`${prefix}setupmute\` · \`${prefix}modlog\``,
          '• ban · softban · unban · kick · timeout · untimeout · warn · jail · unjail · mute · unmute',
          `• \`${prefix}purge N\` · \`${prefix}nick\` · \`${prefix}role add|remove\``,
          `• \`${prefix}automod\` · snipe · editsnipe`,
          `• \`${prefix}tickets setup|panel|claim|close\``,
          `• \`${prefix}voicemaster setup\` · lock · limit · claim`,
          `• \`${prefix}log on\` · reactionrole · buttonrole · levels · starboard`,
        ].join('\n'));
        return;
      }
      await ctx.reply(helpCopy.fullHelp({
        prefix,
        guildId,
        modules: topic === 'all' ? by : null,
      }));
    },
  });

  deps.registry.register({
    name: 'start',
    description: 'Get started with the Discord Spaces map',
    module: 'core',
    aliases: ['maphelp', 'spaces'],
    async run(ctx) {
      await ctx.reply(helpCopy.spacesIntro({
        prefix,
        guildId: ctx.guild?.id,
      }));
    },
  });

  // Expose workers for index.js onReady
  return {
    ...hooks,
    _community: community,
    _integrations: integrations,
  };
}

module.exports = { loadModules };
