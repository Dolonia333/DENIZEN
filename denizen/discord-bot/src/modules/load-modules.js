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

  // Core help / ping
  deps.registry.register({
    name: 'ping',
    description: 'Latency check',
    module: 'core',
    async run(ctx) {
      const t = Date.now();
      await ctx.reply(`Pong — ${Date.now() - t}ms (ws ${Math.round(ctx.client.ws.ping)}ms)`);
    },
  });

  deps.registry.register({
    name: 'help',
    description: 'List commands by module',
    module: 'core',
    async run(ctx) {
      const by = new Map();
      for (const cmd of deps.registry.list()) {
        if (!by.has(cmd.module)) by.set(cmd.module, []);
        by.get(cmd.module).push(cmd.name);
      }
      const lines = [...by.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([mod, names]) => `**${mod}**: ${names.join(', ')}`);
      await ctx.reply(`Denizen commands (prefix \`,\` or slash)\n${lines.join('\n')}`.slice(0, 1900));
    },
  });

  return hooks;
}

module.exports = { loadModules };
