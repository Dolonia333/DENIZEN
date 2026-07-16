'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { canRunCommand } = require('../../core/permissions');
const { renderTemplate } = require('../../core/embed-vars');

function createTickets(deps) {
  const { config, hub } = deps;

  async function openTicket(guild, user, reason = 'Support', option = null) {
    const cfg = config.get(guild.id).tickets;
    if (!cfg.enabled) throw new Error('Tickets disabled — run ,tickets setup');
    const existing = Object.entries(cfg.open || {}).find(([, v]) => v.userId === user.id);
    if (existing) throw new Error(`You already have a ticket: <#${existing[0]}>`);

    const overwrites = [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ];
    if (cfg.supportRoleId) {
      overwrites.push({
        id: cfg.supportRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
        ],
      });
    }

    const ch = await guild.channels.create({
      name: `ticket-${user.username}`.slice(0, 90).toLowerCase().replace(/[^a-z0-9-]/g, ''),
      type: ChannelType.GuildText,
      parent: cfg.categoryId || undefined,
      permissionOverwrites: overwrites,
      topic: `Ticket for ${user.tag} · ${reason}`,
    });

    config.update(guild.id, (c) => {
      c.tickets.open[ch.id] = {
        userId: user.id,
        reason,
        option,
        claimedBy: null,
        ts: Date.now(),
      };
      return c;
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('denizen_ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('denizen_ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger),
    );

    const intro = renderTemplate(
      cfg.openMessage || 'Ticket for {user} — **{reason}**\nStaff: Claim · Close when done.',
      { user, guild, reason },
    );
    await ch.send({
      content: `${intro}${cfg.supportRoleId ? `\n||<@&${cfg.supportRoleId}>||` : ''}`,
      components: [row],
    });
    hub.emit('tickets.open', { guildId: guild.id, channelId: ch.id, userId: user.id });
    return ch;
  }

  async function closeTicket(guild, channel, closer) {
    const open = config.get(guild.id).tickets.open[channel.id];
    if (!open) throw new Error('Not a ticket channel');

    // Transcript (last 50 messages)
    let transcript = `Ticket transcript · ${channel.name}\nUser: ${open.userId}\nReason: ${open.reason}\n\n`;
    try {
      const msgs = await channel.messages.fetch({ limit: 50 });
      const ordered = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      for (const m of ordered) {
        transcript += `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content}\n`;
      }
    } catch (_) {}

    const logId = config.get(guild.id).tickets.logChannelId;
    if (logId) {
      const log = await guild.channels.fetch(logId).catch(() => null);
      if (log?.isTextBased?.()) {
        await log.send({
          content: `🎫 Closed ticket **${channel.name}** by ${closer?.tag || closer?.id || 'system'} (user <@${open.userId}>)`,
          files: [{ attachment: Buffer.from(transcript, 'utf8'), name: `ticket-${channel.id}.txt` }],
        }).catch(() => {});
      }
    }

    config.update(guild.id, (c) => { delete c.tickets.open[channel.id]; return c; });
    hub.emit('tickets.close', { guildId: guild.id, channelId: channel.id });
    await channel.delete('Ticket closed').catch(() => {});
  }

  function register(registry) {
    registry.register({
      name: 'tickets',
      description: 'Ticket system (setup, panel, close, claim, list)',
      aliases: ['ticket', 'tix'],
      module: 'tickets',
      options: [
        { name: 'action', description: 'setup|panel|close|claim|list|support|log', type: 3, required: true },
        { name: 'reason', description: 'Open reason', type: 3, required: false },
      ],
      async run(ctx) {
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'list').toLowerCase();

        if (action === 'setup') {
          if (!canRunCommand(ctx, { permission: 'Administrator' }).ok) return ctx.reply('Need Administrator.');
          const cat = await ctx.guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory });
          const log = await ctx.guild.channels.create({
            name: 'ticket-logs',
            type: ChannelType.GuildText,
            parent: cat.id,
            permissionOverwrites: [
              { id: ctx.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            ],
          });
          config.update(ctx.guild.id, (c) => {
            c.tickets.enabled = true;
            c.tickets.categoryId = cat.id;
            c.tickets.logChannelId = log.id;
            return c;
          });
          return ctx.reply(`Tickets ready: ${cat} · logs ${log}`);
        }

        if (action === 'support') {
          if (!canRunCommand(ctx, { permission: 'Administrator' }).ok) return ctx.reply('Need Administrator.');
          const role = ctx.message?.mentions?.roles?.first?.();
          if (!role) return ctx.reply('Usage: ,tickets support @role');
          config.update(ctx.guild.id, (c) => { c.tickets.supportRoleId = role.id; return c; });
          return ctx.reply(`Support role → ${role}`);
        }

        if (action === 'log') {
          if (!canRunCommand(ctx, { permission: 'Administrator' }).ok) return ctx.reply('Need Administrator.');
          const ch = ctx.message?.mentions?.channels?.first?.() || ctx.channel;
          config.update(ctx.guild.id, (c) => { c.tickets.logChannelId = ch.id; return c; });
          return ctx.reply(`Ticket log → ${ch}`);
        }

        if (action === 'panel') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
          // ,tickets panel [title]
          const title = ctx.args?.slice(1).join(' ') || 'Support Tickets';
          const options = config.get(ctx.guild.id).tickets.forms || [];
          let msg;
          if (options.length) {
            const menu = new StringSelectMenuBuilder()
              .setCustomId('denizen_ticket_select')
              .setPlaceholder('Select ticket type…')
              .addOptions(options.slice(0, 25).map((o, i) => ({
                label: o.label.slice(0, 100),
                description: (o.description || '').slice(0, 100) || undefined,
                value: String(i),
              })));
            msg = await ctx.channel.send({
              content: `**${title}**\nChoose a category to open a private ticket.`,
              components: [new ActionRowBuilder().addComponents(menu)],
            });
          } else {
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('denizen_ticket_open')
                .setLabel('Open Ticket')
                .setStyle(ButtonStyle.Primary),
            );
            msg = await ctx.channel.send({
              content: `**${title}**\nClick to open a private ticket.`,
              components: [row],
            });
          }
          config.update(ctx.guild.id, (c) => {
            c.tickets.panels = c.tickets.panels || [];
            c.tickets.panels.push({
              messageId: msg.id,
              channelId: ctx.channel.id,
              title,
              ts: Date.now(),
            });
            return c;
          });
          return ctx.reply({ content: `Panel posted (${msg.id}).`, ephemeral: true }).catch(() => ctx.reply('Panel posted.'));
        }

        if (action === 'form' || action === 'option') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
          if ((ctx.args?.[1] || '').toLowerCase() === 'list') {
            const forms = config.get(ctx.guild.id).tickets.forms || [];
            return ctx.reply(forms.length
              ? forms.map((f, i) => `${i + 1}. **${f.label}** — ${f.description || ''}`).join('\n')
              : 'No forms. `,tickets form Support | Get help`');
          }
          if ((ctx.args?.[1] || '').toLowerCase() === 'clear') {
            config.update(ctx.guild.id, (c) => { c.tickets.forms = []; return c; });
            return ctx.reply('Ticket forms cleared.');
          }
          // ,tickets form Support | Get help from staff
          const raw = ctx.args?.slice(1).join(' ') || '';
          const [label, ...rest] = raw.split('|').map((s) => s.trim());
          if (!label) return ctx.reply('Usage: ,tickets form Label | optional description · list · clear');
          config.update(ctx.guild.id, (c) => {
            c.tickets.forms = c.tickets.forms || [];
            c.tickets.forms.push({ label, description: rest.join('|') || '' });
            return c;
          });
          return ctx.reply(`Ticket option added: **${label}**. Re-post panel to use select menu.`);
        }

        if (action === 'panels') {
          const panels = config.get(ctx.guild.id).tickets.panels || [];
          return ctx.reply(panels.length
            ? panels.map((p) => `• ${p.title} in <#${p.channelId}> (\`${p.messageId}\`)`).join('\n')
            : 'No panels recorded.');
        }

        if (action === 'adduser' || action === 'removeuser') {
          const open = config.get(ctx.guild.id).tickets.open[ctx.channel.id];
          if (!open) return ctx.reply('Not a ticket channel.');
          const user = ctx.message?.mentions?.users?.first?.();
          if (!user) return ctx.reply(`Usage: ,tickets ${action} @user`);
          if (action === 'adduser') {
            await ctx.channel.permissionOverwrites.edit(user.id, {
              ViewChannel: true,
              SendMessages: true,
              AttachFiles: true,
              ReadMessageHistory: true,
            });
            return ctx.reply(`Added <@${user.id}> to ticket.`);
          }
          await ctx.channel.permissionOverwrites.delete(user.id).catch(() => {});
          return ctx.reply(`Removed <@${user.id}> from ticket.`);
        }

        if (action === 'rename') {
          const open = config.get(ctx.guild.id).tickets.open[ctx.channel.id];
          if (!open) return ctx.reply('Not a ticket channel.');
          const name = ctx.args?.slice(1).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90);
          if (!name) return ctx.reply('Usage: ,tickets rename new-name');
          await ctx.channel.setName(name);
          return ctx.reply(`Renamed to **${name}**.`);
        }

        if (action === 'close') {
          try {
            await closeTicket(ctx.guild, ctx.channel, ctx.user);
          } catch (err) {
            return ctx.reply(err.message);
          }
          return;
        }

        if (action === 'claim') {
          const open = config.get(ctx.guild.id).tickets.open[ctx.channel.id];
          if (!open) return ctx.reply('Not a ticket channel.');
          config.update(ctx.guild.id, (c) => {
            c.tickets.open[ctx.channel.id].claimedBy = ctx.user.id;
            return c;
          });
          return ctx.reply(`Ticket claimed by <@${ctx.user.id}>.`);
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

        const open = Object.entries(config.get(ctx.guild.id).tickets.open || {});
        if (!open.length) return ctx.reply('No open tickets.');
        return ctx.reply(
          open.map(([id, v]) => `<#${id}> — <@${v.userId}>${v.claimedBy ? ` claimed by <@${v.claimedBy}>` : ''}`).join('\n'),
        );
      },
    });
  }

  async function onInteraction(interaction) {
    if (interaction.isButton()) {
      if (interaction.customId === 'denizen_ticket_open') {
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
      if (interaction.customId === 'denizen_ticket_close') {
        try {
          await interaction.reply({ content: 'Closing…', ephemeral: true });
          await closeTicket(interaction.guild, interaction.channel, interaction.user);
        } catch (err) {
          await interaction.reply({ content: err.message, ephemeral: true }).catch(() => {});
        }
        return true;
      }
      if (interaction.customId === 'denizen_ticket_claim') {
        config.update(interaction.guild.id, (c) => {
          if (c.tickets.open[interaction.channel.id]) {
            c.tickets.open[interaction.channel.id].claimedBy = interaction.user.id;
          }
          return c;
        });
        await interaction.reply(`Claimed by <@${interaction.user.id}>.`);
        return true;
      }
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'denizen_ticket_select') {
      try {
        await interaction.deferReply({ ephemeral: true });
        const idx = Number(interaction.values[0]);
        const form = config.get(interaction.guild.id).tickets.forms?.[idx];
        const reason = form?.label || 'Support';
        const ch = await openTicket(interaction.guild, interaction.user, reason, form);
        await interaction.editReply(`Opened ${ch} (${reason})`);
      } catch (err) {
        if (interaction.deferred) await interaction.editReply(err.message).catch(() => {});
      }
      return true;
    }
    return false;
  }

  return { register, onInteraction, openTicket, closeTicket };
}

module.exports = { createTickets };
