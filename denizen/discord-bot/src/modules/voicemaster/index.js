'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { canRunCommand } = require('../../core/permissions');

function createVoiceMaster(deps) {
  const { config, hub } = deps;

  async function onVoiceStateUpdate(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;
    const cfg = config.get(guild.id).voicemaster;
    if (!cfg.enabled || !cfg.hubChannelId) return;

    // Join hub → create temp
    if (newState.channelId === cfg.hubChannelId && newState.member && !newState.member.user.bot) {
      const parent = cfg.categoryId || newState.channel?.parentId || null;
      const ch = await guild.channels.create({
        name: `${newState.member.displayName}'s channel`,
        type: ChannelType.GuildVoice,
        parent: parent || undefined,
        permissionOverwrites: [
          { id: newState.member.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.MoveMembers] },
        ],
      }).catch(() => null);
      if (ch) {
        config.update(guild.id, (c) => {
          c.voicemaster.tempChannels[ch.id] = { ownerId: newState.member.id, createdAt: Date.now() };
          return c;
        });
        await newState.member.voice.setChannel(ch).catch(() => {});
        hub.emit('voicemaster.create', { guildId: guild.id, channelId: ch.id, ownerId: newState.member.id });
      }
    }

    // Leave temp → delete if empty
    const leftId = oldState.channelId;
    if (leftId && cfg.tempChannels?.[leftId]) {
      const ch = oldState.channel;
      if (ch && ch.members.size === 0) {
        await ch.delete('VoiceMaster empty').catch(() => {});
        config.update(guild.id, (c) => {
          delete c.voicemaster.tempChannels[leftId];
          return c;
        });
        hub.emit('voicemaster.delete', { guildId: guild.id, channelId: leftId });
      }
    }
  }

  function register(registry) {
    registry.register({
      name: 'voicemaster',
      description: 'Setup join-to-create voice hub',
      aliases: ['vm'],
      module: 'voicemaster',
      permission: 'ManageChannels',
      options: [
        { name: 'action', description: 'setup|off|status', type: 3, required: true },
      ],
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageChannels' }).ok) return ctx.reply('Need Manage Channels.');
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'status').toLowerCase();
        if (action === 'setup') {
          const cat = await ctx.guild.channels.create({
            name: 'VoiceMaster',
            type: ChannelType.GuildCategory,
          });
          const hubCh = await ctx.guild.channels.create({
            name: '➕ Join to Create',
            type: ChannelType.GuildVoice,
            parent: cat.id,
          });
          config.update(ctx.guild.id, (c) => {
            c.voicemaster.enabled = true;
            c.voicemaster.hubChannelId = hubCh.id;
            c.voicemaster.categoryId = cat.id;
            return c;
          });
          return ctx.reply(`VoiceMaster ready — join ${hubCh}`);
        }
        if (action === 'off') {
          config.update(ctx.guild.id, (c) => { c.voicemaster.enabled = false; return c; });
          return ctx.reply('VoiceMaster off.');
        }
        const v = config.get(ctx.guild.id).voicemaster;
        return ctx.reply(`vm=${v.enabled} hub=${v.hubChannelId} temps=${Object.keys(v.tempChannels || {}).length}`);
      },
    });
  }

  return { register, onVoiceStateUpdate };
}

module.exports = { createVoiceMaster };
