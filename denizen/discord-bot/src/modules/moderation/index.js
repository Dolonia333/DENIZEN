'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { canRunCommand } = require('../../core/permissions');
const { logCase } = require('../../core/cases');

function createModeration(deps) {
  const { config } = deps;

  async function applyMuteOverwrite(guild, role) {
    for (const ch of guild.channels.cache.values()) {
      try {
        if (ch.isTextBased?.()) {
          await ch.permissionOverwrites.edit(role, { SendMessages: false, AddReactions: false });
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
        if (!jailRole) {
          jailRole = await guild.roles.create({ name: 'Jailed', reason: 'Denizen setup' });
        }
        let log = guild.channels.cache.find((c) => c.name === 'denizen-mod-log');
        if (!log) {
          log = await guild.channels.create({
            name: 'denizen-mod-log',
            type: ChannelType.GuildText,
            permissionOverwrites: [
              { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            ],
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
          try {
            await ch.permissionOverwrites.edit(jailRole, { ViewChannel: false }).catch(() => {});
          } catch (_) {}
        }
        config.update(guild.id, (c) => {
          c.moderation.jailRoleId = jailRole.id;
          c.moderation.jailChannelId = jail.id;
          c.moderation.caseLogChannelId = log.id;
          c.security.logChannelId = c.security.logChannelId || log.id;
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
        const make = async (name) => {
          let r = guild.roles.cache.find((x) => x.name === name);
          if (!r) r = await guild.roles.create({ name, reason: 'Denizen setupmute' });
          await applyMuteOverwrite(guild, r);
          return r;
        };
        const muted = await make('Muted');
        const image = await make('Image Muted');
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

    const modAction = (name, fakePerm, fn) => {
      registry.register({
        name,
        description: `${name} a member`,
        module: 'moderation',
        fakePerm,
        options: [
          { name: 'user', description: 'Target', type: 6, required: true },
          { name: 'reason', description: 'Reason', type: 3, required: false },
        ],
        async run(ctx) {
          const gate = canRunCommand(ctx, { fakePerm });
          if (!gate.ok) return ctx.reply(`Missing permission (${gate.reason}). Use fakepermissions or Discord Admin.`);
          const user = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
          if (!user) return ctx.reply('Mention a user.');
          const reason = ctx.getString?.('reason') || ctx.args?.slice(1).join(' ') || 'No reason';
          const member = await ctx.guild.members.fetch(user.id).catch(() => null);
          try {
            await fn(ctx, member, user, reason);
            const logged = await logCase(ctx.guild, config, {
              action: name,
              targetId: user.id,
              targetTag: user.tag,
              modId: ctx.user.id,
              modTag: ctx.user.tag,
              reason,
            });
            return ctx.reply(`👍 Case #${logged.caseId}`);
          } catch (err) {
            return ctx.reply(`Failed: ${err.message}`);
          }
        },
      });
    };

    modAction('ban', 'ban_members', async (ctx, member, user, reason) => {
      await ctx.guild.members.ban(user.id, { reason: `${ctx.user.tag}: ${reason}` });
    });
    modAction('softban', 'ban_members', async (ctx, member, user, reason) => {
      await ctx.guild.members.ban(user.id, { reason: `${ctx.user.tag}: softban ${reason}`, deleteMessageSeconds: 60 * 60 * 24 });
      await ctx.guild.members.unban(user.id, 'softban complete').catch(() => {});
    });
    modAction('kick', 'kick_members', async (ctx, member, user, reason) => {
      if (!member) throw new Error('Member not in server');
      await member.kick(`${ctx.user.tag}: ${reason}`);
    });
    modAction('timeout', 'moderate_members', async (ctx, member, user, reason) => {
      if (!member) throw new Error('Member not in server');
      await member.timeout(60 * 60 * 1000, `${ctx.user.tag}: ${reason}`);
    });
    modAction('warn', 'moderate_members', async (ctx, member, user, reason) => {
      try {
        await user.send(`You were warned in **${ctx.guild.name}**: ${reason}`).catch(() => {});
      } catch (_) {}
    });
    modAction('jail', 'moderate_members', async (ctx, member, user, reason) => {
      if (!member) throw new Error('Member not in server');
      const rid = config.get(ctx.guild.id).moderation.jailRoleId;
      if (!rid) throw new Error('Run /setup first');
      await member.roles.add(rid, reason);
    });
    modAction('mute', 'moderate_members', async (ctx, member, user, reason) => {
      if (!member) throw new Error('Member not in server');
      const rid = config.get(ctx.guild.id).moderation.muteRoleId;
      if (!rid) throw new Error('Run /setupmute first');
      await member.roles.add(rid, reason);
    });
  }

  return { register };
}

module.exports = { createModeration };
