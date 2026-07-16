'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  Colors,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { canRunCommand } = require('../../core/permissions');
const { renderTemplate, renderScript } = require('../../core/embed-vars');
const {
  ticketPanelEmbed,
  ticketOpenRows,
  successEmbed,
  infoEmbed,
  dangerEmbed,
  baseEmbed,
  BRAND,
} = require('../../core/ui-kit');

/**
 * Tickets product: panels, forms, claim, notes, reopen, SLA warning, transcripts.
 */
function createTickets(deps) {
  const { config, hub } = deps;

  function ticketCfg(guildId) {
    return config.get(guildId).tickets;
  }

  async function openTicket(guild, user, reason = 'Support', option = null) {
    const cfg = ticketCfg(guild.id);
    if (!cfg.enabled) throw new Error('Tickets disabled — run ,tickets setup');
    const existing = Object.entries(cfg.open || {}).find(([, v]) => v.userId === user.id && !v.closed);
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
          PermissionFlagsBits.ReadMessageHistory,
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

    const slaMs = (cfg.slaMinutes || 0) * 60_000;
    config.update(guild.id, (c) => {
      c.tickets.open[ch.id] = {
        userId: user.id,
        reason,
        option,
        claimedBy: null,
        notes: [],
        fields: option?.fields || [],
        ts: Date.now(),
        slaAt: slaMs ? Date.now() + slaMs : null,
        closed: false,
      };
      return c;
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('denizen_ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('denizen_ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('denizen_ticket_note').setLabel('Add note').setStyle(ButtonStyle.Secondary),
    );

    const introTpl = cfg.openMessage
      || 'Ticket for {user} — **{reason}**\nStaff: Claim · Close · notes via `,tickets note <text>`';
    const intro = renderTemplate(introTpl, { user, guild, reason });

    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle(`Ticket · ${reason}`.slice(0, 256))
      .setDescription(intro.slice(0, 4000))
      .addFields(
        { name: 'User', value: `<@${user.id}>`, inline: true },
        { name: 'Opened', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
      )
      .setTimestamp(new Date());
    if (cfg.slaMinutes) {
      embed.addFields({ name: 'SLA', value: `${cfg.slaMinutes}m response target`, inline: true });
    }
    if (option?.fields?.length) {
      embed.addFields({
        name: 'Form',
        value: option.fields.map((f) => `• **${f}**`).join('\n').slice(0, 1024),
      });
    }

    await ch.send({
      content: cfg.supportRoleId ? `||<@&${cfg.supportRoleId}>||` : undefined,
      embeds: [embed],
      components: [row],
    });

    if (option?.fields?.length) {
      await ch.send(
        `Please answer:\n${option.fields.map((f, i) => `**${i + 1}. ${f}**`).join('\n')}`,
      ).catch(() => {});
    }

    hub.emit('tickets.open', { guildId: guild.id, channelId: ch.id, userId: user.id });

    // SLA reminder
    if (slaMs) {
      setTimeout(async () => {
        const open = ticketCfg(guild.id).open?.[ch.id];
        if (!open || open.claimedBy || open.closed) return;
        const channel = await guild.channels.fetch(ch.id).catch(() => null);
        if (channel?.isTextBased?.()) {
          await channel.send(
            `⏰ **SLA**: no claim yet (${cfg.slaMinutes}m). Staff please respond.`,
          ).catch(() => {});
        }
      }, slaMs).unref?.();
    }

    return ch;
  }

  async function buildTranscript(channel, open) {
    let transcript = `Ticket transcript · ${channel.name}\nUser: ${open.userId}\nReason: ${open.reason}\nClaimed: ${open.claimedBy || '—'}\nNotes: ${(open.notes || []).length}\n\n`;
    for (const n of open.notes || []) {
      transcript += `[NOTE ${new Date(n.ts).toISOString()}] ${n.modTag}: ${n.text}\n`;
    }
    transcript += '\n--- messages ---\n';
    try {
      const msgs = await channel.messages.fetch({ limit: 100 });
      const ordered = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      for (const m of ordered) {
        transcript += `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content}\n`;
      }
    } catch (_) {}
    return transcript;
  }

  async function closeTicket(guild, channel, closer, { archive = false } = {}) {
    const open = ticketCfg(guild.id).open[channel.id];
    if (!open || open.closed) throw new Error('Not an open ticket channel');

    const transcript = await buildTranscript(channel, open);
    const logId = ticketCfg(guild.id).logChannelId;
    if (logId) {
      const log = await guild.channels.fetch(logId).catch(() => null);
      if (log?.isTextBased?.()) {
        await log.send({
          content: `🎫 Closed **${channel.name}** by ${closer?.tag || closer?.id || 'system'} (user <@${open.userId}>)`,
          files: [{ attachment: Buffer.from(transcript, 'utf8'), name: `ticket-${channel.id}.txt` }],
        }).catch(() => {});
      }
    }

    if (archive) {
      config.update(guild.id, (c) => {
        c.tickets.open[channel.id] = {
          ...open,
          closed: true,
          closedAt: Date.now(),
          closedBy: closer?.id || null,
        };
        c.tickets.closed = c.tickets.closed || {};
        c.tickets.closed[channel.id] = c.tickets.open[channel.id];
        return c;
      });
      await channel.permissionOverwrites.edit(open.userId, { SendMessages: false }).catch(() => {});
      await channel.setName(`closed-${channel.name}`.slice(0, 100)).catch(() => {});
      await channel.send('Ticket archived (closed). Staff: `,tickets reopen` or delete channel.').catch(() => {});
      hub.emit('tickets.close', { guildId: guild.id, channelId: channel.id, archived: true });
      return;
    }

    config.update(guild.id, (c) => {
      c.tickets.closed = c.tickets.closed || {};
      c.tickets.closed[channel.id] = {
        ...open,
        closed: true,
        closedAt: Date.now(),
        closedBy: closer?.id || null,
        channelName: channel.name,
      };
      // Keep last 20 closed meta for reopen by user id
      const keys = Object.keys(c.tickets.closed);
      if (keys.length > 30) {
        for (const k of keys.slice(0, keys.length - 30)) delete c.tickets.closed[k];
      }
      delete c.tickets.open[channel.id];
      return c;
    });
    hub.emit('tickets.close', { guildId: guild.id, channelId: channel.id });
    await channel.delete('Ticket closed').catch(() => {});
  }

  function register(registry) {
    registry.register({
      name: 'tickets',
      description: 'Ticket system — panels, forms, claim, notes, reopen, SLA',
      aliases: ['ticket', 'tix'],
      module: 'tickets',
      options: [
        { name: 'action', description: 'setup|panel|close|claim|note|reopen|list|…', type: 3, required: true },
        { name: 'reason', description: 'Open reason / note text', type: 3, required: false },
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
            c.tickets.slaMinutes = c.tickets.slaMinutes || 30;
            return c;
          });
          return ctx.reply(`Tickets ready: ${cat} · logs ${log} · default SLA 30m (\`,tickets sla 60\`)`);
        }

        if (action === 'sla') {
          if (!canRunCommand(ctx, { permission: 'Administrator' }).ok) return ctx.reply('Need Administrator.');
          const n = Number(ctx.args?.[1] || ctx.getString?.('reason'));
          if (!Number.isFinite(n) || n < 0 || n > 24 * 60) return ctx.reply('Usage: ,tickets sla <minutes> (0=off)');
          config.update(ctx.guild.id, (c) => { c.tickets.slaMinutes = n; return c; });
          return ctx.reply(`Ticket SLA → **${n || 'off'}** minutes.`);
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

        if (action === 'message' || action === 'openmessage') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
          const text = ctx.args?.slice(1).join(' ');
          if (!text) return ctx.reply('Usage: ,tickets message <template with {user} {reason}>');
          config.update(ctx.guild.id, (c) => { c.tickets.openMessage = text; return c; });
          return ctx.reply('Open message template saved. Supports `{embed}$v{title: …}` scripts.');
        }

        if (action === 'panel') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) {
            return ctx.reply({ embeds: [dangerEmbed('Denied', 'Need Manage Guild.')] });
          }
          const title = ctx.args?.slice(1).join(' ') || 'Support desk';
          const options = ticketCfg(ctx.guild.id).forms || [];
          const components = [];
          if (options.length) {
            components.push(new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('denizen_ticket_select')
                .setPlaceholder('Choose a ticket category…')
                .addOptions(options.slice(0, 25).map((o, i) => ({
                  label: o.label.slice(0, 100),
                  description: (o.description || 'Open a private ticket').slice(0, 100),
                  value: String(i),
                  emoji: '🎫',
                }))),
            ));
          }
          components.push(...ticketOpenRows(false));
          const msg = await ctx.channel.send({
            embeds: [ticketPanelEmbed(title)],
            components,
          });
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
          return ctx.reply({
            embeds: [successEmbed('Panel live', 'Pin this in #support — structured desk UI, not a command dump.')],
            ephemeral: true,
          }).catch(() => ctx.reply('Panel posted.'));
        }

        if (action === 'form' || action === 'option') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
          const sub = (ctx.args?.[1] || '').toLowerCase();
          if (sub === 'list') {
            const forms = ticketCfg(ctx.guild.id).forms || [];
            return ctx.reply(forms.length
              ? forms.map((f, i) => `${i + 1}. **${f.label}** — ${f.description || ''} ${(f.fields || []).length ? `fields: ${f.fields.join(', ')}` : ''}`).join('\n')
              : 'No forms. `,tickets form Support | Get help | What is the issue?, Account email`');
          }
          if (sub === 'clear') {
            config.update(ctx.guild.id, (c) => { c.tickets.forms = []; return c; });
            return ctx.reply('Ticket forms cleared.');
          }
          // Label | description | field1, field2
          const raw = ctx.args?.slice(1).join(' ') || '';
          const parts = raw.split('|').map((s) => s.trim());
          const label = parts[0];
          if (!label) {
            return ctx.reply('Usage: ,tickets form Label | description | Field1?, Field2?');
          }
          const description = parts[1] || '';
          const fields = parts[2]
            ? parts[2].split(',').map((s) => s.trim()).filter(Boolean)
            : [];
          config.update(ctx.guild.id, (c) => {
            c.tickets.forms = c.tickets.forms || [];
            c.tickets.forms.push({ label, description, fields });
            return c;
          });
          return ctx.reply(
            `Form **${label}** added${fields.length ? ` with fields: ${fields.join(', ')}` : ''}. Re-post panel.`,
          );
        }

        if (action === 'panels') {
          const panels = ticketCfg(ctx.guild.id).panels || [];
          return ctx.reply(panels.length
            ? panels.map((p) => `• ${p.title} in <#${p.channelId}>`).join('\n')
            : 'No panels.');
        }

        if (action === 'note') {
          const open = ticketCfg(ctx.guild.id).open[ctx.channel.id];
          if (!open || open.closed) return ctx.reply('Not an open ticket.');
          const text = ctx.getString?.('reason') || ctx.args?.slice(1).join(' ');
          if (!text) return ctx.reply('Usage: ,tickets note internal staff note');
          config.update(ctx.guild.id, (c) => {
            const t = c.tickets.open[ctx.channel.id];
            t.notes = t.notes || [];
            t.notes.push({ text, modId: ctx.user.id, modTag: ctx.user.tag, ts: Date.now() });
            return c;
          });
          return ctx.reply({
            content: `📝 Staff note saved (${(open.notes || []).length + 1} total).`,
            ephemeral: true,
          }).catch(() => ctx.reply('Note saved.'));
        }

        if (action === 'notes') {
          const open = ticketCfg(ctx.guild.id).open[ctx.channel.id];
          if (!open) return ctx.reply('Not a ticket channel.');
          const notes = open.notes || [];
          if (!notes.length) return ctx.reply('No staff notes.');
          return ctx.reply(
            notes.slice(-10).map((n, i) =>
              `**${i + 1}.** ${n.modTag}: ${n.text} (<t:${Math.floor(n.ts / 1000)}:R>)`,
            ).join('\n'),
          );
        }

        if (action === 'close' || action === 'archive') {
          try {
            await closeTicket(ctx.guild, ctx.channel, ctx.user, { archive: action === 'archive' });
            if (action === 'archive') return ctx.reply('Ticket archived.');
          } catch (err) {
            return ctx.reply(err.message);
          }
          return;
        }

        if (action === 'reopen') {
          const open = ticketCfg(ctx.guild.id).open[ctx.channel.id];
          if (open?.closed) {
            config.update(ctx.guild.id, (c) => {
              c.tickets.open[ctx.channel.id].closed = false;
              c.tickets.open[ctx.channel.id].closedAt = null;
              return c;
            });
            await ctx.channel.permissionOverwrites.edit(open.userId, {
              ViewChannel: true,
              SendMessages: true,
              AttachFiles: true,
              ReadMessageHistory: true,
            }).catch(() => {});
            await ctx.channel.setName(ctx.channel.name.replace(/^closed-/, '')).catch(() => {});
            return ctx.reply(`Reopened ticket for <@${open.userId}>.`);
          }
          // Reopen by creating new ticket from last closed for a user
          const user = ctx.message?.mentions?.users?.first?.();
          if (!user) return ctx.reply('Usage: ,tickets reopen (in archived channel) or ,tickets reopen @user');
          const closed = Object.values(ticketCfg(ctx.guild.id).closed || {})
            .filter((t) => t.userId === user.id)
            .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))[0];
          try {
            const ch = await openTicket(ctx.guild, user, closed?.reason || 'Reopened', closed?.option || null);
            return ctx.reply(`Reopened as ${ch}`);
          } catch (err) {
            return ctx.reply(err.message);
          }
        }

        if (action === 'claim') {
          const open = ticketCfg(ctx.guild.id).open[ctx.channel.id];
          if (!open || open.closed) return ctx.reply('Not an open ticket.');
          config.update(ctx.guild.id, (c) => {
            c.tickets.open[ctx.channel.id].claimedBy = ctx.user.id;
            c.tickets.open[ctx.channel.id].claimedAt = Date.now();
            return c;
          });
          return ctx.reply(`Ticket claimed by <@${ctx.user.id}>.`);
        }

        if (action === 'unclaim') {
          const open = ticketCfg(ctx.guild.id).open[ctx.channel.id];
          if (!open) return ctx.reply('Not a ticket.');
          config.update(ctx.guild.id, (c) => {
            c.tickets.open[ctx.channel.id].claimedBy = null;
            return c;
          });
          return ctx.reply('Ticket unclaimed.');
        }

        if (action === 'adduser' || action === 'removeuser') {
          const open = ticketCfg(ctx.guild.id).open[ctx.channel.id];
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
            return ctx.reply(`Added <@${user.id}>.`);
          }
          await ctx.channel.permissionOverwrites.delete(user.id).catch(() => {});
          return ctx.reply(`Removed <@${user.id}>.`);
        }

        if (action === 'rename') {
          const open = ticketCfg(ctx.guild.id).open[ctx.channel.id];
          if (!open) return ctx.reply('Not a ticket channel.');
          const name = ctx.args?.slice(1).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90);
          if (!name) return ctx.reply('Usage: ,tickets rename new-name');
          await ctx.channel.setName(name);
          return ctx.reply(`Renamed to **${name}**.`);
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

        const open = Object.entries(ticketCfg(ctx.guild.id).open || {}).filter(([, v]) => !v.closed);
        if (!open.length) return ctx.reply('No open tickets.');
        return ctx.reply(
          open.map(([id, v]) => {
            const age = Math.round((Date.now() - v.ts) / 60000);
            const claim = v.claimedBy ? `claimed <@${v.claimedBy}>` : '**unclaimed**';
            const sla = v.slaAt && !v.claimedBy && Date.now() > v.slaAt ? ' ⏰SLA' : '';
            return `<#${id}> — <@${v.userId}> · ${claim} · ${age}m${sla}`;
          }).join('\n'),
        );
      },
    });
  }

  async function onInteraction(interaction) {
    if (interaction.isButton()) {
      if (interaction.customId === 'denizen_ticket_guide') {
        await interaction.reply({
          embeds: [infoEmbed(
            'How tickets work',
            [
              '1. Open a ticket from the panel',
              '2. Fill the form (modal) if your category needs it',
              '3. Staff **Claim** then resolve in your private channel',
              '4. Close → transcript lands in staff logs',
              '',
              '_Denizen Spaces support desk — structured, not a bare channel factory._',
            ].join('\n'),
          )],
          ephemeral: true,
        });
        return true;
      }
      if (interaction.customId === 'denizen_ticket_open') {
        // Modal first for a polished intake
        const modal = new ModalBuilder()
          .setCustomId('denizen_ticket_modal_open')
          .setTitle('Open a ticket');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('subject')
              .setLabel('Subject')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Short summary')
              .setRequired(true)
              .setMaxLength(80),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('details')
              .setLabel('Details')
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder('What do you need help with?')
              .setRequired(true)
              .setMaxLength(800),
          ),
        );
        await interaction.showModal(modal);
        return true;
      }
      if (interaction.customId === 'denizen_ticket_close') {
        try {
          await interaction.reply({
            embeds: [infoEmbed('Closing', 'Saving transcript…')],
            ephemeral: true,
          });
          await closeTicket(interaction.guild, interaction.channel, interaction.user);
        } catch (err) {
          await interaction.reply({
            embeds: [dangerEmbed('Close failed', err.message)],
            ephemeral: true,
          }).catch(() => {});
        }
        return true;
      }
      if (interaction.customId === 'denizen_ticket_claim') {
        config.update(interaction.guild.id, (c) => {
          if (c.tickets.open[interaction.channel.id]) {
            c.tickets.open[interaction.channel.id].claimedBy = interaction.user.id;
            c.tickets.open[interaction.channel.id].claimedAt = Date.now();
          }
          return c;
        });
        await interaction.reply({
          embeds: [successEmbed('Claimed', `<@${interaction.user.id}> is on this ticket.`)],
        });
        return true;
      }
      if (interaction.customId === 'denizen_ticket_note') {
        const modal = new ModalBuilder()
          .setCustomId('denizen_ticket_modal_note')
          .setTitle('Staff note');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('note')
              .setLabel('Internal note')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(500),
          ),
        );
        await interaction.showModal(modal);
        return true;
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'denizen_ticket_modal_open') {
        try {
          await interaction.deferReply({ ephemeral: true });
          const subject = interaction.fields.getTextInputValue('subject');
          const details = interaction.fields.getTextInputValue('details');
          const reason = subject;
          const ch = await openTicket(interaction.guild, interaction.user, reason, {
            label: subject,
            fields: ['Details'],
          });
          await ch.send({
            embeds: [baseEmbed({
              color: BRAND.info,
              title: 'Intake',
              fields: [
                { name: 'Subject', value: subject.slice(0, 256) },
                { name: 'Details', value: details.slice(0, 1024) },
              ],
            })],
          }).catch(() => {});
          await interaction.editReply({
            embeds: [successEmbed('Ticket opened', `${ch} — staff will claim shortly.`)],
          });
        } catch (err) {
          if (interaction.deferred) {
            await interaction.editReply({ embeds: [dangerEmbed('Failed', err.message)] }).catch(() => {});
          }
        }
        return true;
      }
      if (interaction.customId === 'denizen_ticket_modal_note') {
        const open = ticketCfg(interaction.guild.id).open[interaction.channel.id];
        if (!open) {
          await interaction.reply({ embeds: [dangerEmbed('Not a ticket', '')], ephemeral: true });
          return true;
        }
        const text = interaction.fields.getTextInputValue('note');
        config.update(interaction.guild.id, (c) => {
          const t = c.tickets.open[interaction.channel.id];
          t.notes = t.notes || [];
          t.notes.push({
            text,
            modId: interaction.user.id,
            modTag: interaction.user.tag,
            ts: Date.now(),
          });
          return c;
        });
        await interaction.reply({
          embeds: [successEmbed('Note saved', text.slice(0, 200))],
          ephemeral: true,
        });
        return true;
      }
      // Category form modal: denizen_ticket_modal_form_<idx>
      if (interaction.customId.startsWith('denizen_ticket_modal_form_')) {
        try {
          await interaction.deferReply({ ephemeral: true });
          const idx = Number(interaction.customId.replace('denizen_ticket_modal_form_', ''));
          const form = ticketCfg(interaction.guild.id).forms?.[idx];
          const reason = form?.label || 'Support';
          const answers = [];
          for (let i = 0; i < 5; i += 1) {
            try {
              const v = interaction.fields.getTextInputValue(`f${i}`);
              if (v) answers.push({ q: form?.fields?.[i] || `Field ${i + 1}`, a: v });
            } catch (_) { /* field not present */ }
          }
          const ch = await openTicket(interaction.guild, interaction.user, reason, form);
          if (answers.length) {
            await ch.send({
              embeds: [baseEmbed({
                color: BRAND.info,
                title: 'Form answers',
                fields: answers.map((x) => ({
                  name: x.q.slice(0, 256),
                  value: x.a.slice(0, 1024),
                })),
              })],
            }).catch(() => {});
          }
          await interaction.editReply({
            embeds: [successEmbed('Ticket opened', `${ch} · **${reason}**`)],
          });
        } catch (err) {
          if (interaction.deferred) {
            await interaction.editReply({ embeds: [dangerEmbed('Failed', err.message)] }).catch(() => {});
          }
        }
        return true;
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'denizen_ticket_select') {
      const idx = Number(interaction.values[0]);
      const form = ticketCfg(interaction.guild.id).forms?.[idx];
      const fields = (form?.fields || []).slice(0, 5);
      if (fields.length) {
        const modal = new ModalBuilder()
          .setCustomId(`denizen_ticket_modal_form_${idx}`)
          .setTitle(String(form.label || 'Ticket').slice(0, 45));
        for (let i = 0; i < fields.length; i += 1) {
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId(`f${i}`)
                .setLabel(String(fields[i]).slice(0, 45))
                .setStyle(i === 0 ? TextInputStyle.Paragraph : TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(i === 0 ? 800 : 200),
            ),
          );
        }
        await interaction.showModal(modal);
        return true;
      }
      try {
        await interaction.deferReply({ ephemeral: true });
        const reason = form?.label || 'Support';
        const ch = await openTicket(interaction.guild, interaction.user, reason, form);
        await interaction.editReply({
          embeds: [successEmbed('Ticket opened', `${ch} · **${reason}**`)],
        });
      } catch (err) {
        if (interaction.deferred) {
          await interaction.editReply({ embeds: [dangerEmbed('Failed', err.message)] }).catch(() => {});
        }
      }
      return true;
    }
    return false;
  }

  return { register, onInteraction, openTicket, closeTicket };
}

module.exports = { createTickets };
