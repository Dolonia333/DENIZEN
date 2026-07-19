'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { canRunCommand } = require('../../core/permissions');
const { logCase } = require('../../core/cases');

function parseDurationMs(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d+)(s|m|h|d|w)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2] || 'm'];
  return n * unit;
}

function createModeration(deps) {
  const { config } = deps;

  async function applyMuteOverwrite(guild, role, opts = {}) {
    for (const ch of guild.channels.cache.values()) {
      try {
        if (ch.isTextBased?.()) {
          const over = { SendMessages: false, AddReactions: false };
          if (opts.images) over.AttachFiles = false;
          await ch.permissionOverwrites.edit(role, over);
        }
      } catch (_) {}
    }
  }

  function register(registry) {
    registry.register({
      name: 'setup',
      description: 'Create jail role, jail channel, and case log',
      module: 'moderation',
      permission: 'Administrator',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'Administrator' }).ok) return ctx.reply('Need Administrator.');
        const guild = ctx.guild;
        let jailRole = guild.roles.cache.find((r) => r.name === 'Jailed');
        if (!jailRole) jailRole = await guild.roles.create({ name: 'Jailed', reason: 'Denizen setup' });
        let log = guild.channels.cache.find((c) => c.name === 'denizen-mod-log');
        if (!log) {
          log = await guild.channels.create({
            name: 'denizen-mod-log',
            type: ChannelType.GuildText,
            permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }],
          });
        }
        let jail = guild.channels.cache.find((c) => c.name === 'jail');
        if (!jail) {
          jail = await guild.channels.create({
            name: 'jail',
            type: ChannelType.GuildText,
            permissionOverwrites: [
              { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
              { id: jailRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            ],
          });
        }
        for (const ch of guild.channels.cache.values()) {
          if (ch.id === jail.id) continue;
          try { await ch.permissionOverwrites.edit(jailRole, { ViewChannel: false }).catch(() => {}); } catch (_) {}
        }
        config.update(guild.id, (c) => {
          c.moderation.jailRoleId = jailRole.id;
          c.moderation.jailChannelId = jail.id;
          c.moderation.caseLogChannelId = log.id;
          c.security.logChannelId = c.security.logChannelId || log.id;
          c.logging.channelId = c.logging.channelId || log.id;
          c.logging.enabled = true;
          return c;
        });
        return ctx.reply(`Setup complete: ${jailRole}, ${jail}, ${log}`);
      },
    });

    registry.register({
      name: 'setupmute',
      description: 'Create mute roles',
      module: 'moderation',
      permission: 'Administrator',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'Administrator' }).ok) return ctx.reply('Need Administrator.');
        const guild = ctx.guild;
        const make = async (name, opts) => {
          let r = guild.roles.cache.find((x) => x.name === name);
          if (!r) r = await guild.roles.create({ name, reason: 'Denizen setupmute' });
          await applyMuteOverwrite(guild, r, opts);
          return r;
        };
        const muted = await make('Muted');
        const image = await make('Image Muted', { images: true });
        const react = await make('Reaction Muted');
        config.update(guild.id, (c) => {
          c.moderation.muteRoleId = muted.id;
          c.moderation.imageMuteRoleId = image.id;
          c.moderation.reactionMuteRoleId = react.id;
          return c;
        });
        return ctx.reply(`Mute roles ready: ${muted}, ${image}, ${react}`);
      },
    });

    const modAction = (name, fakePerm, fn, opts = {}) => {
      registry.register({
        name,
        description: opts.description || `${name} a member`,
        module: 'moderation',
        fakePerm,
        options: [
          { name: 'user', description: 'Target', type: 6, required: true },
          { name: 'reason', description: 'Reason', type: 3, required: false },
          ...(opts.duration ? [{ name: 'duration', description: 'e.g. 10m 1h 1d', type: 3, required: false }] : []),
          ...(opts.amount ? [{ name: 'amount', description: 'Message count', type: 4, required: false }] : []),
        ],
        async run(ctx) {
          const gate = canRunCommand(ctx, { fakePerm });
          if (!gate.ok) return ctx.reply(`Missing permission (${gate.reason}). Use ,fakepermissions or Discord Admin.`);
          const user = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
          if (!user && !opts.noUser) return ctx.reply('Mention a user.');
          const reason = ctx.getString?.('reason')
            || (opts.duration ? ctx.args?.slice(2).join(' ') : ctx.args?.slice(1).join(' '))
            || 'No reason';
          const member = user ? await ctx.guild.members.fetch(user.id).catch(() => null) : null;
          try {
            await fn(ctx, member, user, reason);
            if (user) {
              const logged = await logCase(ctx.guild, config, {
                action: name,
                targetId: user.id,
                targetTag: user.tag,
                modId: ctx.user.id,
                modTag: ctx.user.tag,
                reason,
              });
              return ctx.reply(`✅ Case #${logged.caseId} — ${name} **${user.tag}**`);
            }
            return ctx.reply(`✅ ${name} done.`);
          } catch (err) {
            return ctx.reply(`Failed: ${err.message}`);
          }
        },
      });
    };

    modAction('ban', 'ban_members', async (ctx, member, user, reason) => {
      await ctx.guild.members.ban(user.id, { reason: `${ctx.user.tag}: ${reason}`, deleteMessageSeconds: 0 });
    });
    modAction('softban', 'ban_members', async (ctx, member, user, reason) => {
      await ctx.guild.members.ban(user.id, {
        reason: `${ctx.user.tag}: softban ${reason}`,
        deleteMessageSeconds: 60 * 60 * 24,
      });
      await ctx.guild.members.unban(user.id, 'softban complete').catch(() => {});
    });
    modAction('unban', 'ban_members', async (ctx, member, user, reason) => {
      await ctx.guild.members.unban(user.id, `${ctx.user.tag}: ${reason}`);
    });
    modAction('kick', 'kick_members', async (ctx, member, user, reason) => {
      if (!member) throw new Error('Member not in server');
      await member.kick(`${ctx.user.tag}: ${reason}`);
    });
    modAction('timeout', 'moderate_members', async (ctx, member, user, reason) => {
      if (!member) throw new Error('Member not in server');
      const durRaw = ctx.getString?.('duration') || ctx.args?.[1] || '1h';
      const ms = parseDurationMs(durRaw) || 3_600_000;
      await member.timeout(Math.min(ms, 28 * 86400000), `${ctx.user.tag}: ${reason}`);
    }, { duration: true });
    modAction('untimeout', 'moderate_members', async (ctx, member) => {
      if (!member) throw new Error('Member not in server');
      await member.timeout(null);
    });
    modAction('warn', 'moderate_members', async (ctx, member, user, reason) => {
      config.update(ctx.guild.id, (c) => {
        c.moderation.warns = c.moderation.warns || {};
        c.moderation.warns[user.id] = c.moderation.warns[user.id] || [];
        c.moderation.warns[user.id].push({ reason, modId: ctx.user.id, ts: Date.now() });
        return c;
      });
      await user.send(`You were warned in **${ctx.guild.name}**: ${reason}`).catch(() => {});
    });
    registry.register({
      name: 'warnings',
      description: 'List warnings for a member',
      module: 'moderation',
      fakePerm: 'moderate_members',
      options: [{ name: 'user', description: 'Target', type: 6, required: true }],
      async run(ctx) {
        const gate = canRunCommand(ctx, { fakePerm: 'moderate_members' });
        if (!gate.ok) return ctx.reply(`Denied: ${gate.reason}`);
        const user = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
        if (!user) return ctx.reply('Mention a user.');
        const list = config.get(ctx.guild.id).moderation.warns?.[user.id] || [];
        if (!list.length) return ctx.reply(`No warnings for **${user.tag}**.`);
        const lines = list.slice(-10).map((w, i) => `${i + 1}. ${w.reason} (<t:${Math.floor(w.ts / 1000)}:R>)`);
        return ctx.reply(`Warnings for **${user.tag}**:\n${lines.join('\n')}`);
      },
    });
    modAction('jail', 'moderate_members', async (ctx, member, user, reason) => {
      if (!member) throw new Error('Member not in server');
      const rid = config.get(ctx.guild.id).moderation.jailRoleId;
      if (!rid) throw new Error('Run /setup first');
      await member.roles.add(rid, reason);
    });
    modAction('unjail', 'moderate_members', async (ctx, member, user, reason) => {
      if (!member) throw new Error('Member not in server');
      const rid = config.get(ctx.guild.id).moderation.jailRoleId;
      if (!rid) throw new Error('Run /setup first');
      await member.roles.remove(rid, reason);
    });
    modAction('mute', 'moderate_members', async (ctx, member, user, reason) => {
      if (!member) throw new Error('Member not in server');
      const rid = config.get(ctx.guild.id).moderation.muteRoleId;
      if (!rid) throw new Error('Run /setupmute first');
      await member.roles.add(rid, reason);
    });
    modAction('unmute', 'moderate_members', async (ctx, member, user, reason) => {
      if (!member) throw new Error('Member not in server');
      const rid = config.get(ctx.guild.id).moderation.muteRoleId;
      if (!rid) throw new Error('Run /setupmute first');
      await member.roles.remove(rid, reason);
    });
    modAction('imagemute', 'moderate_members', async (ctx, member, user, reason) => {
      if (!member) throw new Error('Member not in server');
      const rid = config.get(ctx.guild.id).moderation.imageMuteRoleId;
      if (!rid) throw new Error('Run /setupmute first');
      await member.roles.add(rid, reason);
    }, { description: 'Block image/embed uploads via Image Muted role' });
    modAction('unimagemute', 'moderate_members', async (ctx, member, user, reason) => {
      if (!member) throw new Error('Member not in server');
      const rid = config.get(ctx.guild.id).moderation.imageMuteRoleId;
      if (!rid) throw new Error('Run /setupmute first');
      await member.roles.remove(rid, reason);
    }, { description: 'Remove Image Muted role' });
    modAction('reactionmute', 'moderate_members', async (ctx, member, user, reason) => {
      if (!member) throw new Error('Member not in server');
      const rid = config.get(ctx.guild.id).moderation.reactionMuteRoleId;
      if (!rid) throw new Error('Run /setupmute first');
      await member.roles.add(rid, reason);
    }, { description: 'Block reactions via Reaction Muted role' });
    modAction('unreactionmute', 'moderate_members', async (ctx, member, user, reason) => {
      if (!member) throw new Error('Member not in server');
      const rid = config.get(ctx.guild.id).moderation.reactionMuteRoleId;
      if (!rid) throw new Error('Run /setupmute first');
      await member.roles.remove(rid, reason);
    }, { description: 'Remove Reaction Muted role' });

    registry.register({
      name: 'purge',
      description: 'Bulk delete messages (1–100)',
      aliases: ['clear', 'prune'],
      module: 'moderation',
      fakePerm: 'manage_messages',
      options: [
        { name: 'amount', description: '1-100', type: 4, required: true },
        { name: 'user', description: 'Only from this user', type: 6, required: false },
      ],
      async run(ctx) {
        const gate = canRunCommand(ctx, { fakePerm: 'manage_messages' });
        if (!gate.ok) return ctx.reply(`Denied: ${gate.reason}`);
        const amount = ctx.getInteger?.('amount') ?? Number(ctx.args?.[0]) ?? 0;
        if (!Number.isFinite(amount) || amount < 1 || amount > 100) {
          return ctx.reply('Amount 1–100.');
        }
        const user = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
        const fetched = await ctx.channel.messages.fetch({ limit: 100 });
        let list = [...fetched.values()].filter((m) => Date.now() - m.createdTimestamp < 14 * 86400000);
        // Drop the invoking prefix message before slicing so `,purge 10` deletes 10
        // (not 9 after excluding the command).
        if (ctx.message) list = list.filter((m) => m.id !== ctx.message.id);
        if (user) list = list.filter((m) => m.author.id === user.id);
        list = list.slice(0, amount);
        if (!list.length) return ctx.reply('No messages to purge (need messages under 14 days old).');
        const deleted = await ctx.channel.bulkDelete(list, true).catch(() => null);
        if (!deleted) return ctx.reply('Purge failed — check bot Manage Messages + channel perms.');
        const n = deleted.size || 0;
        await logCase(ctx.guild, config, {
          action: 'purge',
          targetId: user?.id || ctx.channel.id,
          targetTag: user?.tag || `#${ctx.channel.name}`,
          modId: ctx.user.id,
          modTag: ctx.user.tag,
          reason: `${n} messages`,
        });
        return ctx.reply(`Purged **${n}** messages.`);
      },
    });

    registry.register({
      name: 'nick',
      description: 'Change a member nickname',
      module: 'moderation',
      fakePerm: 'manage_nicknames',
      options: [
        { name: 'user', description: 'Target', type: 6, required: true },
        { name: 'nickname', description: 'New nick (empty to reset)', type: 3, required: false },
      ],
      async run(ctx) {
        const gate = canRunCommand(ctx, { fakePerm: 'manage_nicknames' });
        if (!gate.ok) return ctx.reply(`Denied: ${gate.reason}`);
        const user = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
        if (!user) return ctx.reply('Mention a user.');
        const member = await ctx.guild.members.fetch(user.id).catch(() => null);
        if (!member) return ctx.reply('Member not found.');
        const nick = ctx.getString?.('nickname') ?? ctx.args?.slice(1).join(' ') ?? null;
        await member.setNickname(nick || null, `by ${ctx.user.tag}`);
        return ctx.reply(`Nickname updated for **${user.tag}**.`);
      },
    });

    registry.register({
      name: 'role',
      description: 'Add or remove a role from a member',
      module: 'moderation',
      fakePerm: 'manage_roles',
      options: [
        { name: 'action', description: 'add|remove', type: 3, required: true },
        { name: 'user', description: 'Target', type: 6, required: true },
        { name: 'role', description: 'Role', type: 8, required: true },
      ],
      async run(ctx) {
        const gate = canRunCommand(ctx, { fakePerm: 'manage_roles' });
        if (!gate.ok) return ctx.reply(`Denied: ${gate.reason}`);
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'add').toLowerCase();
        const user = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
        const role = ctx.interaction?.options?.getRole?.('role') || ctx.message?.mentions?.roles?.first?.();
        if (!user || !role) return ctx.reply('Usage: ,role add|remove @user @role');
        const member = await ctx.guild.members.fetch(user.id).catch(() => null);
        if (!member) return ctx.reply('Member not found.');
        if (action === 'remove') await member.roles.remove(role, `by ${ctx.user.tag}`);
        else await member.roles.add(role, `by ${ctx.user.tag}`);
        await logCase(ctx.guild, config, {
          action: `role_${action}`,
          targetId: user.id,
          targetTag: user.tag,
          modId: ctx.user.id,
          modTag: ctx.user.tag,
          reason: role.name,
        });
        return ctx.reply(`${action === 'remove' ? 'Removed' : 'Added'} ${role} ${action === 'remove' ? 'from' : 'to'} **${user.tag}**.`);
      },
    });

    registry.register({
      name: 'modlog',
      description: 'Set moderation case log channel',
      module: 'moderation',
      permission: 'Administrator',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'Administrator' }).ok) return ctx.reply('Need Administrator.');
        const ch = ctx.message?.mentions?.channels?.first?.() || ctx.channel;
        config.update(ctx.guild.id, (c) => {
          c.moderation.caseLogChannelId = ch.id;
          c.security.logChannelId = c.security.logChannelId || ch.id;
          return c;
        });
        return ctx.reply(`Case log → ${ch}`);
      },
    });
  }

  return { register };
}

module.exports = { createModeration, parseDurationMs };
