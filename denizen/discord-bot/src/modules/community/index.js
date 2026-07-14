'use strict';

const { canRunCommand } = require('../../core/permissions');

function createCommunity(deps) {
  const { config, hub } = deps;
  const xpCooldown = new Map();
  const memberXp = new Map(); // guildId:userId -> xp

  function xpKey(gid, uid) { return `${gid}:${uid}`; }

  async function onMemberAdd(member) {
    const w = config.get(member.guild.id).community.welcome;
    if (!w.enabled || !w.channelId) return;
    const ch = await member.guild.channels.fetch(w.channelId).catch(() => null);
    if (!ch?.isTextBased?.()) return;
    const msg = String(w.message || 'Welcome {user}!')
      .replace('{user}', `<@${member.id}>`)
      .replace('{server}', member.guild.name);
    await ch.send(msg).catch(() => {});
  }

  async function onMemberRemove(member) {
    const g = config.get(member.guild.id).community.goodbye;
    if (!g.enabled || !g.channelId) return;
    const ch = await member.guild.channels.fetch(g.channelId).catch(() => null);
    if (!ch?.isTextBased?.()) return;
    const msg = String(g.message || '{user} left.')
      .replace('{user}', member.user?.tag || member.id)
      .replace('{server}', member.guild.name);
    await ch.send(msg).catch(() => {});
  }

  async function onMessage(message) {
    if (!message.guild || message.author.bot) return;
    const cfg = config.get(message.guild.id).community;

    for (const ar of cfg.autoresponders || []) {
      if (!ar.trigger) continue;
      if (message.content.toLowerCase().includes(String(ar.trigger).toLowerCase())) {
        await message.channel.send(String(ar.response || '').slice(0, 1900)).catch(() => {});
        break;
      }
    }

    if (cfg.levels?.enabled) {
      const key = xpKey(message.guild.id, message.author.id);
      const now = Date.now();
      const last = xpCooldown.get(key) || 0;
      if (now - last >= (cfg.levels.cooldownMs || 60000)) {
        xpCooldown.set(key, now);
        const xp = (memberXp.get(key) || 0) + (cfg.levels.xpPerMsg || 15);
        memberXp.set(key, xp);
        hub.emit('community.xp', { guildId: message.guild.id, userId: message.author.id, xp });
      }
    }
  }

  async function onReactionAdd(reaction, user) {
    if (user.bot) return;
    const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
    if (!message?.guild) return;
    const cfg = config.get(message.guild.id).community;
    if (cfg.starboard?.enabled && cfg.starboard.channelId) {
      const count = reaction.emoji.name === '⭐' ? reaction.count : 0;
      if (count >= (cfg.starboard.threshold || 3)) {
        const ch = await message.guild.channels.fetch(cfg.starboard.channelId).catch(() => null);
        if (ch?.isTextBased?.()) {
          await ch.send(`⭐ **${count}** | ${message.author}: ${message.content?.slice(0, 500) || '[media]'}\n${message.url}`).catch(() => {});
        }
      }
    }
    for (const rr of cfg.reactionRoles || []) {
      if (rr.messageId === message.id && rr.emoji === reaction.emoji.name) {
        const member = await message.guild.members.fetch(user.id).catch(() => null);
        if (member && rr.roleId) await member.roles.add(rr.roleId).catch(() => {});
      }
    }
  }

  function register(registry) {
    registry.register({
      name: 'welcome',
      description: 'Configure welcome messages',
      module: 'community',
      permission: 'ManageGuild',
      options: [
        { name: 'action', description: 'on|off|channel|message', type: 3, required: true },
        { name: 'value', description: 'channel mention or message text', type: 3, required: false },
      ],
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
        const action = (ctx.getString?.('action') || ctx.args?.[0] || '').toLowerCase();
        if (action === 'on') {
          config.update(ctx.guild.id, (c) => { c.community.welcome.enabled = true; return c; });
          return ctx.reply('Welcome on.');
        }
        if (action === 'off') {
          config.update(ctx.guild.id, (c) => { c.community.welcome.enabled = false; return c; });
          return ctx.reply('Welcome off.');
        }
        if (action === 'channel') {
          const ch = ctx.getChannel?.('value') || ctx.message?.mentions?.channels?.first?.() || ctx.channel;
          config.update(ctx.guild.id, (c) => { c.community.welcome.channelId = ch.id; return c; });
          return ctx.reply(`Welcome channel → ${ch}`);
        }
        if (action === 'message') {
          const text = ctx.getString?.('value') || ctx.args?.slice(1).join(' ');
          config.update(ctx.guild.id, (c) => { c.community.welcome.message = text; return c; });
          return ctx.reply('Welcome message updated.');
        }
        return ctx.reply('welcome on|off|channel|message');
      },
    });

    registry.register({
      name: 'autoresponder',
      description: 'Add an autoresponder trigger',
      aliases: ['ar'],
      module: 'community',
      permission: 'ManageGuild',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
        const trigger = ctx.args?.[0];
        const response = ctx.args?.slice(1).join(' ');
        if (!trigger || !response) return ctx.reply('Usage: ,autoresponder <trigger> <response>');
        config.update(ctx.guild.id, (c) => {
          c.community.autoresponders.push({ trigger, response });
          return c;
        });
        return ctx.reply(`Autoresponder added for \`${trigger}\`.`);
      },
    });

    registry.register({
      name: 'levels',
      description: 'Toggle leveling / check XP',
      module: 'community',
      async run(ctx) {
        const action = (ctx.args?.[0] || 'rank').toLowerCase();
        if (action === 'on' || action === 'off') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
          config.update(ctx.guild.id, (c) => { c.community.levels.enabled = action === 'on'; return c; });
          return ctx.reply(`Levels ${action}.`);
        }
        const xp = memberXp.get(xpKey(ctx.guild.id, ctx.user.id)) || 0;
        return ctx.reply(`You have **${xp}** XP.`);
      },
    });

    registry.register({
      name: 'starboard',
      description: 'Configure starboard',
      module: 'community',
      permission: 'ManageGuild',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
        const action = (ctx.args?.[0] || 'status').toLowerCase();
        if (action === 'on') {
          const ch = ctx.message?.mentions?.channels?.first?.() || ctx.channel;
          config.update(ctx.guild.id, (c) => {
            c.community.starboard.enabled = true;
            c.community.starboard.channelId = ch.id;
            return c;
          });
          return ctx.reply(`Starboard → ${ch}`);
        }
        if (action === 'off') {
          config.update(ctx.guild.id, (c) => { c.community.starboard.enabled = false; return c; });
          return ctx.reply('Starboard off.');
        }
        const s = config.get(ctx.guild.id).community.starboard;
        return ctx.reply(`starboard=${s.enabled} channel=${s.channelId} threshold=${s.threshold}`);
      },
    });

    registry.register({
      name: 'giveaway',
      description: 'Start a simple giveaway',
      module: 'community',
      permission: 'ManageGuild',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
        const prize = ctx.args?.join(' ') || 'a prize';
        const msg = await ctx.channel.send(`🎉 **GIVEAWAY** — ${prize}\nReact with 🎉 to enter!`);
        await msg.react('🎉');
        config.update(ctx.guild.id, (c) => {
          c.community.giveaways.push({ messageId: msg.id, channelId: ctx.channel.id, prize, ts: Date.now() });
          return c;
        });
        return ctx.reply('Giveaway started.');
      },
    });

    registry.register({
      name: 'bump',
      description: 'Disboard bump reminder on/off',
      module: 'community',
      permission: 'ManageGuild',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
        const action = (ctx.args?.[0] || 'status').toLowerCase();
        if (action === 'on') {
          config.update(ctx.guild.id, (c) => {
            c.community.bumpReminder = { enabled: true, channelId: ctx.channel.id, lastBumpAt: 0 };
            return c;
          });
          return ctx.reply('Bump reminder on in this channel — I will nudge ~2h after someone says `/bump` or `,bumped`.');
        }
        if (action === 'off') {
          config.update(ctx.guild.id, (c) => {
            c.community.bumpReminder = { enabled: false }; return c;
          });
          return ctx.reply('Bump reminder off.');
        }
        const b = config.get(ctx.guild.id).community.bumpReminder || {};
        return ctx.reply(`bumpReminder=${!!b.enabled} channel=${b.channelId || '—'}`);
      },
    });

    registry.register({
      name: 'counter',
      description: 'Create a member-count voice channel',
      module: 'community',
      permission: 'ManageChannels',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageChannels' }).ok) return ctx.reply('Need Manage Channels.');
        const { ChannelType } = require('discord.js');
        const name = `Members: ${ctx.guild.memberCount}`;
        const ch = await ctx.guild.channels.create({
          name,
          type: ChannelType.GuildVoice,
          permissionOverwrites: [{ id: ctx.guild.id, deny: ['Connect'] }],
        });
        config.update(ctx.guild.id, (c) => {
          c.community.counters = c.community.counters || [];
          c.community.counters.push({ channelId: ch.id, type: 'members' });
          return c;
        });
        return ctx.reply(`Counter channel: ${ch}`);
      },
    });
  }

  // Hook bump detection into onMessage
  const _onMessage = onMessage;
  async function onMessageWrapped(message) {
    await _onMessage(message);
    if (!message.guild || message.author.bot) return;
    const br = config.get(message.guild.id).community.bumpReminder;
    if (!br?.enabled) return;
    const text = (message.content || '').toLowerCase();
    if (text.includes('/bump') || text === 'bumped' || text.startsWith(',bumped')) {
      config.update(message.guild.id, (c) => {
        c.community.bumpReminder.lastBumpAt = Date.now();
        return c;
      });
      setTimeout(async () => {
        const ch = await message.guild.channels.fetch(br.channelId).catch(() => null);
        if (ch?.isTextBased?.()) {
          await ch.send('⏰ Time to `/bump` the server on Disboard!').catch(() => {});
        }
      }, 2 * 60 * 60 * 1000);
    }
  }

  return {
    register,
    onMemberAdd,
    onMemberRemove,
    onMessage: onMessageWrapped,
    onReactionAdd,
    memberXp,
  };
}

module.exports = { createCommunity };
