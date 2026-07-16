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

  const vm = createVoiceMaster(deps);
  vm.register(deps.registry);
  hooks.onVoiceStateUpdate.push(vm.onVoiceStateUpdate);

  const tickets = createTickets(deps);
  tickets.register(deps.registry);
  hooks.onInteraction.push(tickets.onInteraction);

  const music = createMusic(deps);
  music.register(deps.registry);

  const integrations = createIntegrations(deps);
  integrations.register(deps.registry);

  const misc = createMisc(deps);
  misc.register(deps.registry);

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

  // Core help / ping
  deps.registry.register({
    name: 'ping',
    description: 'Check bot latency',
    module: 'core',
    async run(ctx) {
      const t = Date.now();
      await ctx.reply(
        `Pong — ${Date.now() - t}ms (ws ${Math.round(ctx.client.ws.ping)}ms)\n`
        + `_Try \`${prefix}help\` for the map, avatar, and hangout commands._`,
      );
    },
  });

  deps.registry.register({
    name: 'help',
    description: 'How to use Denizen Spaces + full command list',
    module: 'core',
    options: [
      {
        type: 3,
        name: 'topic',
        description: 'spaces | avatar | hangout | mods | all',
        required: false,
        choices: [
          { name: 'Spaces map (start here)', value: 'spaces' },
          { name: 'Avatar closet', value: 'avatar' },
          { name: 'Weekly hangout', value: 'hangout' },
          { name: 'Staff / moderation', value: 'mods' },
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
          `• \`${prefix}avatar\` / \`/avatar edit\` — open closet (preview + Save)`,
          `• \`/avatar random\` · \`reset\` · \`show @user\``,
          `• \`${prefix}skin dark\` · \`${prefix}hair short 3\` · \`${prefix}clothes 7\``,
          '• **Server boost** → golden headset on the pixel map',
          '',
          helpCopy.mapFooter(guildId),
        ].join('\n'));
        return;
      }

      if (topic === 'hangout') {
        await ctx.reply([
          '**Weekly hangout recap** (voice minutes)',
          `• \`/hangout setup #channel\` — where to post`,
          `• \`/hangout report\` — post this week’s top hangers now`,
          `• \`/hangout enable\` · \`disable\` · \`status\``,
          'Default schedule: Monday 17:00 UTC (configurable).',
          '',
          helpCopy.mapFooter(guildId),
        ].join('\n'));
        return;
      }

      if (topic === 'mods') {
        await ctx.reply([
          '**Staff tools**',
          `• \`${prefix}setup\` — jail role + mod log`,
          '• ban · softban · kick · timeout · warn · jail · mute',
          `• \`${prefix}automod\` · \`${prefix}antinuke\` · \`${prefix}antiraid\``,
          `• \`${prefix}welcome\` · \`${prefix}tickets\` · \`${prefix}voicemaster\``,
          '',
          '_Spaces map still works for everyone — staff tools are optional._',
        ].join('\n'));
        return;
      }

      // spaces (default) or all
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

  return hooks;
}

module.exports = { loadModules };
