'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { canRunCommand } = require('../../core/permissions');

function createVoiceMaster(deps) {
  const { config, hub } = deps;

  function isOwner(guildId, channelId, userId) {
    const t = config.get(guildId).voicemaster.tempChannels?.[channelId];
    return t && t.ownerId === userId;
  }

  async function sendInterface(channel, ownerId) {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vm_lock').setLabel('Lock').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vm_unlock').setLabel('Unlock').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vm_ghost').setLabel('Ghost').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vm_reveal').setLabel('Reveal').setStyle(ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vm_limit').setLabel('Limit 2').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('vm_limit0').setLabel('Limit ∞').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('vm_claim').setLabel('Claim').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('vm_delete').setLabel('Delete').setStyle(ButtonStyle.Danger),
    );
    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vm_region').setLabel('Region Auto').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vm_bitrate').setLabel('Bitrate 64').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vm_invite').setLabel('Invite link').setStyle(ButtonStyle.Success),
    );
    await channel.send({
      content: `🎙️ **VoiceMaster** — owner <@${ownerId}>\nLock · Unlock · Ghost · Reveal · Limit · Claim · Delete · Region · Bitrate · Invite`,
      components: [row1, row2, row3],
    }).catch(() => {});
  }

  async function onVoiceStateUpdate(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;
    const cfg = config.get(guild.id).voicemaster;
    if (!cfg.enabled || !cfg.hubChannelId) return;

    if (newState.channelId === cfg.hubChannelId && newState.member && !newState.member.user.bot) {
      const parent = cfg.categoryId || newState.channel?.parentId || null;
      const ch = await guild.channels.create({
        name: `${newState.member.displayName}'s channel`.slice(0, 100),
        type: ChannelType.GuildVoice,
        parent: parent || undefined,
        userLimit: cfg.defaultLimit || 0,
        permissionOverwrites: [
          {
            id: newState.member.id,
            allow: [
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.MuteMembers,
              PermissionFlagsBits.MoveMembers,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
            ],
          },
        ],
      }).catch(() => null);
      if (ch) {
        config.update(guild.id, (c) => {
          c.voicemaster.tempChannels[ch.id] = {
            ownerId: newState.member.id,
            createdAt: Date.now(),
          };
          return c;
        });
        await newState.member.voice.setChannel(ch).catch(() => {});
        if (cfg.interfaceText !== false) await sendInterface(ch, newState.member.id);
        hub.emit('voicemaster.create', {
          guildId: guild.id,
          channelId: ch.id,
          ownerId: newState.member.id,
        });
      }
    }

    const leftId = oldState.channelId;
    if (leftId && cfg.tempChannels?.[leftId]) {
      const ch = oldState.channel;
      if (ch && ch.members.filter((m) => !m.user.bot).size === 0) {
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
      description: 'VoiceMaster join-to-create + controls',
      aliases: ['vm'],
      module: 'voicemaster',
      // No blanket ManageChannels — owners must control their temp VC.
      // setup/off still check ManageChannels inside run().
      options: [
        { name: 'action', description: 'setup|off|status|lock|unlock|name|limit|claim|transfer|bitrate', type: 3, required: true },
        { name: 'value', description: 'name / limit / bitrate / user', type: 3, required: false },
      ],
      async run(ctx) {
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'status').toLowerCase();
        const value = ctx.getString?.('value') || ctx.args?.slice(1).join(' ') || '';

        if (action === 'setup') {
          if (!canRunCommand(ctx, { permission: 'ManageChannels' }).ok) {
            return ctx.reply('Need Manage Channels.');
          }
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
          if (!canRunCommand(ctx, { permission: 'ManageChannels' }).ok) {
            return ctx.reply('Need Manage Channels.');
          }
          config.update(ctx.guild.id, (c) => { c.voicemaster.enabled = false; return c; });
          return ctx.reply('VoiceMaster off.');
        }
        if (action === 'status') {
          const v = config.get(ctx.guild.id).voicemaster;
          return ctx.reply(
            `vm=${v.enabled} hub=${v.hubChannelId} temps=${Object.keys(v.tempChannels || {}).length}`,
          );
        }

        // Owner controls (must be in temp VC)
        const voice = ctx.member?.voice?.channel;
        if (!voice) return ctx.reply('Join your VoiceMaster channel first.');
        const temp = config.get(ctx.guild.id).voicemaster.tempChannels?.[voice.id];
        if (!temp) return ctx.reply('This is not a VoiceMaster temp channel.');

        const ownerOk = temp.ownerId === ctx.user.id
          || canRunCommand(ctx, { permission: 'ManageChannels' }).ok;

        if (action === 'claim') {
          if (voice.members.has(temp.ownerId)) {
            return ctx.reply('Owner is still in the channel.');
          }
          config.update(ctx.guild.id, (c) => {
            c.voicemaster.tempChannels[voice.id].ownerId = ctx.user.id;
            return c;
          });
          await voice.permissionOverwrites.edit(ctx.user.id, {
            ManageChannels: true,
            MuteMembers: true,
            MoveMembers: true,
          }).catch(() => {});
          return ctx.reply(`You claimed ownership of **${voice.name}**.`);
        }

        if (!ownerOk) return ctx.reply('Only the channel owner can do that.');

        if (action === 'lock') {
          await voice.permissionOverwrites.edit(ctx.guild.id, { Connect: false });
          return ctx.reply('Channel **locked**.');
        }
        if (action === 'unlock') {
          await voice.permissionOverwrites.edit(ctx.guild.id, { Connect: null });
          return ctx.reply('Channel **unlocked**.');
        }
        if (action === 'ghost') {
          await voice.permissionOverwrites.edit(ctx.guild.id, { ViewChannel: false });
          return ctx.reply('Channel **ghosted** (hidden).');
        }
        if (action === 'reveal') {
          await voice.permissionOverwrites.edit(ctx.guild.id, { ViewChannel: null });
          return ctx.reply('Channel **revealed**.');
        }
        if (action === 'name') {
          if (!value) return ctx.reply('Usage: ,vm name <name>');
          await voice.setName(value.slice(0, 100));
          return ctx.reply(`Renamed to **${value.slice(0, 100)}**.`);
        }
        if (action === 'limit') {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0 || n > 99) return ctx.reply('Usage: ,vm limit 0-99');
          await voice.setUserLimit(n);
          return ctx.reply(`User limit → **${n || '∞'}**.`);
        }
        if (action === 'bitrate') {
          const n = Number(value);
          if (!n || n < 8 || n > 384) return ctx.reply('Usage: ,vm bitrate 8-384 (kbps)');
          await voice.setBitrate(n * 1000);
          return ctx.reply(`Bitrate → **${n} kbps**.`);
        }
        if (action === 'transfer') {
          const user = ctx.message?.mentions?.users?.first?.();
          if (!user) return ctx.reply('Usage: ,vm transfer @user');
          if (!voice.members.has(user.id)) return ctx.reply('User must be in the channel.');
          config.update(ctx.guild.id, (c) => {
            c.voicemaster.tempChannels[voice.id].ownerId = user.id;
            return c;
          });
          await voice.permissionOverwrites.edit(user.id, {
            ManageChannels: true,
            MuteMembers: true,
            MoveMembers: true,
          }).catch(() => {});
          return ctx.reply(`Ownership transferred to <@${user.id}>.`);
        }
        if (action === 'delete') {
          await ctx.reply('Temp channel deleted.');
          config.update(ctx.guild.id, (c) => {
            delete c.voicemaster.tempChannels[voice.id];
            return c;
          });
          await voice.delete('VoiceMaster owner delete').catch(() => {});
          return;
        }
        if (action === 'kick' || action === 'reject') {
          const user = ctx.message?.mentions?.users?.first?.();
          if (!user) return ctx.reply(`Usage: ,vm ${action} @user`);
          const member = await ctx.guild.members.fetch(user.id).catch(() => null);
          if (!member?.voice?.channelId || member.voice.channelId !== voice.id) {
            return ctx.reply('User is not in your channel.');
          }
          if (action === 'reject') {
            await voice.permissionOverwrites.edit(user.id, { Connect: false });
          }
          await member.voice.disconnect(`VM ${action} by ${ctx.user.tag}`).catch(() => {});
          return ctx.reply(`${action === 'reject' ? 'Rejected' : 'Kicked'} <@${user.id}>.`);
        }
        if (action === 'permit' || action === 'allow' || action === 'trust') {
          const user = ctx.message?.mentions?.users?.first?.();
          if (!user) return ctx.reply('Usage: ,vm trust @user');
          await voice.permissionOverwrites.edit(user.id, { Connect: true, ViewChannel: true });
          config.update(ctx.guild.id, (c) => {
            const t = c.voicemaster.tempChannels[voice.id];
            if (t) {
              t.trusted = t.trusted || [];
              if (!t.trusted.includes(user.id)) t.trusted.push(user.id);
            }
            return c;
          });
          return ctx.reply(`Trusted <@${user.id}> to join.`);
        }
        if (action === 'untrust') {
          const user = ctx.message?.mentions?.users?.first?.();
          if (!user) return ctx.reply('Usage: ,vm untrust @user');
          await voice.permissionOverwrites.delete(user.id).catch(() => {});
          config.update(ctx.guild.id, (c) => {
            const t = c.voicemaster.tempChannels[voice.id];
            if (t?.trusted) t.trusted = t.trusted.filter((id) => id !== user.id);
            return c;
          });
          return ctx.reply(`Removed trust for <@${user.id}>.`);
        }
        if (action === 'rejectall' || action === 'kickall') {
          let n = 0;
          for (const m of voice.members.values()) {
            if (m.id === ctx.user.id || m.user.bot) continue;
            await m.voice.disconnect(`VM ${action}`).catch(() => {});
            n += 1;
          }
          return ctx.reply(`Disconnected **${n}** members.`);
        }
        if (action === 'invite') {
          const inv = await voice.createInvite({ maxAge: 3600, maxUses: 5 }).catch(() => null);
          if (!inv) return ctx.reply('Could not create invite.');
          return ctx.reply(`Invite: ${inv.url}`);
        }
        if (action === 'info') {
          const t = temp;
          return ctx.reply([
            `**${voice.name}**`,
            `Owner: <@${t.ownerId}>`,
            `Limit: ${voice.userLimit || '∞'} · Bitrate: ${Math.round((voice.bitrate || 0) / 1000)}kbps`,
            `Trusted: ${(t.trusted || []).map((id) => `<@${id}>`).join(', ') || '(none)'}`,
            `Members: ${voice.members.size}`,
          ].join('\n'));
        }
        return ctx.reply(
          'vm setup|off|status|lock|unlock|ghost|reveal|name|limit|claim|transfer|bitrate|kick|reject|trust|untrust|rejectall|invite|info|delete',
        );
      },
    });
  }

  async function onInteraction(interaction) {
    if (!interaction.isButton() || !interaction.customId?.startsWith('vm_')) return false;
    const voice = interaction.member?.voice?.channel;
    if (!voice) {
      await interaction.reply({ content: 'Join the VoiceMaster channel first.', ephemeral: true });
      return true;
    }
    const temp = config.get(interaction.guild.id).voicemaster.tempChannels?.[voice.id];
    if (!temp) {
      await interaction.reply({ content: 'Not a VoiceMaster channel.', ephemeral: true });
      return true;
    }
    const ownerOk = temp.ownerId === interaction.user.id
      || interaction.member.permissions.has('ManageChannels');
    const id = interaction.customId;

    try {
      if (id === 'vm_claim') {
        if (voice.members.has(temp.ownerId)) {
          await interaction.reply({ content: 'Owner still here.', ephemeral: true });
          return true;
        }
        config.update(interaction.guild.id, (c) => {
          c.voicemaster.tempChannels[voice.id].ownerId = interaction.user.id;
          return c;
        });
        await interaction.reply({ content: 'Claimed!', ephemeral: true });
        return true;
      }
      if (!ownerOk) {
        await interaction.reply({ content: 'Owner only.', ephemeral: true });
        return true;
      }
      if (id === 'vm_lock') await voice.permissionOverwrites.edit(interaction.guild.id, { Connect: false });
      if (id === 'vm_unlock') await voice.permissionOverwrites.edit(interaction.guild.id, { Connect: null });
      if (id === 'vm_ghost') await voice.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false });
      if (id === 'vm_reveal') await voice.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: null });
      if (id === 'vm_limit') await voice.setUserLimit(2);
      if (id === 'vm_limit0') await voice.setUserLimit(0);
      if (id === 'vm_bitrate') await voice.setBitrate(64000).catch(() => {});
      if (id === 'vm_region') await voice.setRTCRegion(null).catch(() => {});
      if (id === 'vm_invite') {
        const inv = await voice.createInvite({ maxAge: 3600, maxUses: 5 }).catch(() => null);
        await interaction.reply({
          content: inv ? `Invite: ${inv.url}` : 'Invite failed.',
          ephemeral: true,
        });
        return true;
      }
      if (id === 'vm_delete') {
        await interaction.reply({ content: 'Deleting…', ephemeral: true });
        await voice.delete('VM button').catch(() => {});
        config.update(interaction.guild.id, (c) => {
          delete c.voicemaster.tempChannels[voice.id];
          return c;
        });
        return true;
      }
      await interaction.reply({ content: 'Done.', ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: err.message, ephemeral: true }).catch(() => {});
    }
    return true;
  }

  return { register, onVoiceStateUpdate, onInteraction, isOwner };
}

module.exports = { createVoiceMaster };
