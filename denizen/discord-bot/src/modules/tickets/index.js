'use strict';

const { ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { canRunCommand } = require('../../core/permissions');

function createTickets(deps) {
  const { config, hub } = deps;

  async function openTicket(guild, user, reason = 'Support') {
    const cfg = config.get(guild.id).tickets;
    if (!cfg.enabled) throw new Error('Tickets disabled — run ,tickets setup');
    const existing = Object.entries(cfg.open || {}).find(([, v]) => v.userId === user.id);
    if (existing) throw new Error(`You already have a ticket: <#${existing[0]}>`);

    const ch = await guild.channels.create({
      name: `ticket-${user.username}`.slice(0, 90).toLowerCase().replace(/[^a-z0-9-]/g, ''),
      type: ChannelType.GuildText,
      parent: cfg.categoryId || undefined,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
      ],
    });
    config.update(guild.id, (c) => {
      c.tickets.open[ch.id] = { userId: user.id, reason, ts: Date.now() };
      return c;
    });
    await ch.send(`Ticket for <@${user.id}> — ${reason}\nStaff: use \`,tickets close\` when done.`);
    hub.emit('tickets.open', { guildId: guild.id, channelId: ch.id, userId: user.id });
    return ch;
  }

  function register(registry) {
    registry.register({
      name: 'tickets',
      description: 'Ticket system',
      aliases: ['ticket', 'tix'],
      module: 'tickets',
      options: [
        { name: 'action', description: 'setup|panel|close|list', type: 3, required: true },
        { name: 'reason', description: 'Open reason', type: 3, required: false },
      ],
      async run(ctx) {
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'list').toLowerCase();
        if (action === 'setup') {
          if (!canRunCommand(ctx, { permission: 'Administrator' }).ok) return ctx.reply('Need Administrator.');
          const cat = await ctx.guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory });
          config.update(ctx.guild.id, (c) => {
            c.tickets.enabled = true;
            c.tickets.categoryId = cat.id;
            return c;
          });
          return ctx.reply(`Tickets category ready: ${cat}`);
        }
        if (action === 'panel') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('denizen_ticket_open').setLabel('Open Ticket').setStyle(ButtonStyle.Primary),
          );
          await ctx.channel.send({ content: '**Support Tickets**\nClick to open a private ticket.', components: [row] });
          return ctx.reply({ content: 'Panel posted.', ephemeral: true }).catch(() => ctx.reply('Panel posted.'));
        }
        if (action === 'close') {
          const open = config.get(ctx.guild.id).tickets.open[ctx.channel.id];
          if (!open) return ctx.reply('This is not a ticket channel.');
          config.update(ctx.guild.id, (c) => { delete c.tickets.open[ctx.channel.id]; return c; });
          hub.emit('tickets.close', { guildId: ctx.guild.id, channelId: ctx.channel.id });
          await ctx.reply('Closing ticket…');
          await ctx.channel.delete('Ticket closed').catch(() => {});
          return;
        }
        if (action === 'open') {
          try {
            const reason = ctx.getString?.('reason') || ctx.args?.slice(1).join(' ') || 'Support';
            const ch = await openTicket(ctx.guild, ctx.user, reason);
            return ctx.reply(`Opened ${ch}`);
          } catch (err) {
            return ctx.reply(err.message);
          }
        }
        const open = Object.keys(config.get(ctx.guild.id).tickets.open || {});
        return ctx.reply(open.length ? `Open: ${open.map((id) => `<#${id}>`).join(', ')}` : 'No open tickets.');
      },
    });
  }

  async function onInteraction(interaction) {
    if (!interaction.isButton()) return false;
    if (interaction.customId !== 'denizen_ticket_open') return false;
    try {
      await interaction.deferReply({ ephemeral: true });
      const ch = await openTicket(interaction.guild, interaction.user, 'Panel');
      await interaction.editReply(`Opened ${ch}`);
    } catch (err) {
      if (interaction.deferred) await interaction.editReply(err.message).catch(() => {});
      else await interaction.reply({ content: err.message, ephemeral: true }).catch(() => {});
    }
    return true;
  }

  return { register, onInteraction, openTicket };
}

module.exports = { createTickets };
