'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { canRunCommand } = require('../../core/permissions');
const { renderTemplate, sendRendered } = require('../../core/embed-vars');
const { rankCardEmbed, successEmbed, infoEmbed } = require('../../core/ui-kit');
const fs = require('fs');
const path = require('path');

const XP_DIR = path.join(__dirname, '..', '..', '..', 'data', 'xp');

function createCommunity(deps) {
  const { config, hub } = deps;
  const xpCooldown = new Map();
  fs.mkdirSync(XP_DIR, { recursive: true });

  function xpFile(guildId) {
    return path.join(XP_DIR, `${guildId}.json`);
  }

  function loadXp(guildId) {
    try {
      return JSON.parse(fs.readFileSync(xpFile(guildId), 'utf8'));
    } catch {
      return {};
    }
  }

  function saveXp(guildId, data) {
    fs.writeFileSync(xpFile(guildId), JSON.stringify(data), 'utf8');
  }

  function getXp(guildId, userId) {
    return loadXp(guildId)[userId] || 0;
  }

  function addXp(guildId, userId, amount) {
    const data = loadXp(guildId);
    data[userId] = (data[userId] || 0) + amount;
    saveXp(guildId, data);
    return data[userId];
  }

  function levelFromXp(xp) {
    return Math.floor(0.1 * Math.sqrt(xp));
  }

  async function onMemberAdd(member) {
    const cfg = config.get(member.guild.id).community;
    const w = cfg.welcome;
    if (w?.enabled && w.channelId) {
      const ch = await member.guild.channels.fetch(w.channelId).catch(() => null);
      if (ch?.isTextBased?.()) {
        await sendRendered(ch, w.message || 'Welcome {user}!', {
          user: member.user,
          guild: member.guild,
          member,
        }).catch(() => {});
      }
    }
    // Booster role is applied on guildMemberUpdate, not join
    // Vanity check
    if (cfg.vanity?.enabled && cfg.vanity.roleId && cfg.vanity.substring) {
      const presence = member.presence?.activities || [];
      const custom = presence.find((a) => a.type === 4); // Custom
      const text = custom?.state || '';
      if (text.toLowerCase().includes(String(cfg.vanity.substring).toLowerCase())) {
        await member.roles.add(cfg.vanity.roleId).catch(() => {});
      }
    }
  }

  async function onMemberRemove(member) {
    const g = config.get(member.guild.id).community.goodbye;
    if (!g?.enabled || !g.channelId) return;
    const ch = await member.guild.channels.fetch(g.channelId).catch(() => null);
    if (!ch?.isTextBased?.()) return;
    const msg = renderTemplate(g.message || '{user} left.', {
      user: member.user,
      guild: member.guild,
    });
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

    for (const rt of cfg.reactionTriggers || []) {
      if (rt.trigger && message.content.toLowerCase().includes(String(rt.trigger).toLowerCase())) {
        await message.react(rt.emoji || '👍').catch(() => {});
      }
    }

    if (cfg.levels?.enabled) {
      const ignoreRole = message.member?.roles?.cache
        && (cfg.levels.ignoreRoles || []).some((r) => message.member.roles.cache.has(r));
      if ((cfg.levels.ignoreChannels || []).includes(message.channel.id) || ignoreRole) {
        // skip xp
      } else {
      const key = `${message.guild.id}:${message.author.id}`;
      const now = Date.now();
      const last = xpCooldown.get(key) || 0;
      if (now - last >= (cfg.levels.cooldownMs || 60000)) {
        xpCooldown.set(key, now);
        const before = getXp(message.guild.id, message.author.id);
        const gain = Math.round((cfg.levels.xpPerMsg || 15) * (cfg.levels.multiplier || 1));
        const after = addXp(message.guild.id, message.author.id, gain);
        const oldLvl = levelFromXp(before);
        const newLvl = levelFromXp(after);
        hub.emit('community.xp', {
          guildId: message.guild.id,
          userId: message.author.id,
          xp: after,
        });
        if (newLvl > oldLvl) {
          // Level rewards
          for (const r of cfg.levels.rewards || []) {
            if (r.level === newLvl && r.roleId) {
              const member = await message.guild.members.fetch(message.author.id).catch(() => null);
              if (member) await member.roles.add(r.roleId).catch(() => {});
            }
          }
          await message.channel.send(
            `🎉 <@${message.author.id}> reached **level ${newLvl}**!`,
          ).catch(() => {});
        }
      }
      }
    }
  }

  async function onReactionAdd(reaction, user) {
    if (user.bot) return;
    const message = reaction.message.partial
      ? await reaction.message.fetch().catch(() => null)
      : reaction.message;
    if (!message?.guild) return;
    const cfg = config.get(message.guild.id).community;

    if (cfg.starboard?.enabled && cfg.starboard.channelId) {
      const emoji = reaction.emoji.name;
      if (emoji === '⭐' || emoji === '🌟') {
        const count = reaction.count || 0;
        if (count >= (cfg.starboard.threshold || 3)) {
          const posted = cfg.starboard.posted || {};
          if (!posted[message.id]) {
            const ch = await message.guild.channels.fetch(cfg.starboard.channelId).catch(() => null);
            if (ch?.isTextBased?.()) {
              const m = await ch.send(
                `⭐ **${count}** | ${message.author}: ${message.content?.slice(0, 500) || '[media]'}\n${message.url}`,
              ).catch(() => null);
              if (m) {
                config.update(message.guild.id, (c) => {
                  c.community.starboard.posted = c.community.starboard.posted || {};
                  c.community.starboard.posted[message.id] = m.id;
                  return c;
                });
              }
            }
          }
        }
      }
    }

    for (const rr of cfg.reactionRoles || []) {
      const emojiMatch = rr.emoji === reaction.emoji.name
        || rr.emoji === reaction.emoji.id
        || rr.emoji === `<:${reaction.emoji.name}:${reaction.emoji.id}>`;
      if (rr.messageId === message.id && emojiMatch) {
        const member = await message.guild.members.fetch(user.id).catch(() => null);
        if (member && rr.roleId) await member.roles.add(rr.roleId).catch(() => {});
      }
    }
  }

  async function onGuildMemberUpdate(oldMember, newMember) {
    const cfg = config.get(newMember.guild.id).community;
    // Booster role
    if (cfg.boosterRoleId) {
      const wasBoost = !!oldMember.premiumSince;
      const isBoost = !!newMember.premiumSince;
      if (!wasBoost && isBoost) {
        await newMember.roles.add(cfg.boosterRoleId).catch(() => {});
      } else if (wasBoost && !isBoost) {
        await newMember.roles.remove(cfg.boosterRoleId).catch(() => {});
      }
    }
  }

  function register(registry) {
    registry.register({
      name: 'welcome',
      description: 'Configure welcome messages ({user} {server} {memberCount})',
      module: 'community',
      permission: 'ManageGuild',
      options: [
        { name: 'action', description: 'on|off|channel|message|test', type: 3, required: true },
        { name: 'value', description: 'channel or message text', type: 3, required: false },
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
          return ctx.reply(
            'Welcome updated. Vars: {user} {user.name} {server} {memberCount}. '
            + 'Embed script: `{embed}$v{title: Welcome}$v{description: Hi {user}}`',
          );
        }
        if (action === 'test') {
          const w = config.get(ctx.guild.id).community.welcome;
          const msg = renderTemplate(w.message, { user: ctx.user, guild: ctx.guild });
          return ctx.reply(msg || '(empty)');
        }
        return ctx.reply('welcome on|off|channel|message|test');
      },
    });

    registry.register({
      name: 'goodbye',
      description: 'Configure goodbye messages',
      module: 'community',
      permission: 'ManageGuild',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
        const action = (ctx.args?.[0] || '').toLowerCase();
        if (action === 'on') {
          config.update(ctx.guild.id, (c) => { c.community.goodbye.enabled = true; return c; });
          return ctx.reply('Goodbye on.');
        }
        if (action === 'off') {
          config.update(ctx.guild.id, (c) => { c.community.goodbye.enabled = false; return c; });
          return ctx.reply('Goodbye off.');
        }
        if (action === 'channel') {
          const ch = ctx.message?.mentions?.channels?.first?.() || ctx.channel;
          config.update(ctx.guild.id, (c) => { c.community.goodbye.channelId = ch.id; return c; });
          return ctx.reply(`Goodbye channel → ${ch}`);
        }
        if (action === 'message') {
          const text = ctx.args?.slice(1).join(' ');
          config.update(ctx.guild.id, (c) => { c.community.goodbye.message = text; return c; });
          return ctx.reply('Goodbye message set.');
        }
        return ctx.reply('goodbye on|off|channel|message');
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
        const action = (ctx.args?.[0] || '').toLowerCase();
        if (action === 'list') {
          const list = config.get(ctx.guild.id).community.autoresponders || [];
          return ctx.reply(list.length
            ? list.map((a, i) => `${i + 1}. \`${a.trigger}\` → ${a.response.slice(0, 80)}`).join('\n')
            : 'No autoresponders.');
        }
        if (action === 'remove') {
          const idx = Number(ctx.args?.[1]) - 1;
          config.update(ctx.guild.id, (c) => {
            c.community.autoresponders.splice(idx, 1);
            return c;
          });
          return ctx.reply('Removed.');
        }
        const trigger = ctx.args?.[0];
        const response = ctx.args?.slice(1).join(' ');
        if (!trigger || !response) return ctx.reply('Usage: ,autoresponder <trigger> <response> | list | remove N');
        config.update(ctx.guild.id, (c) => {
          c.community.autoresponders.push({ trigger, response });
          return c;
        });
        return ctx.reply(`Autoresponder added for \`${trigger}\`.`);
      },
    });

    registry.register({
      name: 'levels',
      description: 'Toggle leveling / rank / rewards / leaderboard',
      module: 'community',
      async run(ctx) {
        const action = (ctx.args?.[0] || 'rank').toLowerCase();
        if (action === 'on' || action === 'off') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
          config.update(ctx.guild.id, (c) => { c.community.levels.enabled = action === 'on'; return c; });
          return ctx.reply(`Levels ${action}.`);
        }
        if (action === 'reward') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
          const level = Number(ctx.args?.[1]);
          const role = ctx.message?.mentions?.roles?.first?.();
          if (!level || !role) return ctx.reply('Usage: ,levels reward <level> @role');
          config.update(ctx.guild.id, (c) => {
            c.community.levels.rewards = c.community.levels.rewards || [];
            c.community.levels.rewards.push({ level, roleId: role.id });
            return c;
          });
          return ctx.reply(`Level ${level} → ${role}`);
        }
        if (action === 'leaderboard' || action === 'lb' || action === 'top') {
          const data = loadXp(ctx.guild.id);
          const top = Object.entries(data)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
          if (!top.length) return ctx.reply('No XP yet.');
          const lines = await Promise.all(top.map(async ([id, xp], i) => {
            const u = await ctx.client.users.fetch(id).catch(() => null);
            return `**${i + 1}.** ${u?.tag || id} — ${xp} XP (lvl ${levelFromXp(xp)})`;
          }));
          return ctx.reply(`**XP Leaderboard**\n${lines.join('\n')}`);
        }
        if (action === 'multiplier') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
          const n = Number(ctx.args?.[1]);
          if (!n || n < 0.1 || n > 10) return ctx.reply('Usage: ,levels multiplier 1.5');
          config.update(ctx.guild.id, (c) => {
            c.community.levels.multiplier = n;
            return c;
          });
          return ctx.reply(`XP multiplier → **${n}x**`);
        }
        if (action === 'ignore') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
          const ch = ctx.message?.mentions?.channels?.first?.() || ctx.channel;
          config.update(ctx.guild.id, (c) => {
            c.community.levels.ignoreChannels = c.community.levels.ignoreChannels || [];
            const id = ch.id;
            if (c.community.levels.ignoreChannels.includes(id)) {
              c.community.levels.ignoreChannels = c.community.levels.ignoreChannels.filter((x) => x !== id);
            } else c.community.levels.ignoreChannels.push(id);
            return c;
          });
          return ctx.reply(`Toggled levels ignore for ${ch}.`);
        }
        if (action === 'rank' || action === 'card') {
          const target = ctx.message?.mentions?.users?.first?.() || ctx.user;
          const xp = getXp(ctx.guild.id, target.id);
          const lvl = levelFromXp(xp);
          const nextXp = Math.pow((lvl + 1) * 10, 2);
          const prevXp = Math.pow(lvl * 10, 2);
          const data = loadXp(ctx.guild.id);
          const rank = Object.entries(data).sort((a, b) => b[1] - a[1]).findIndex(([id]) => id === target.id) + 1;
          const avatarUrl = target.displayAvatarURL?.({ size: 256 }) || target.avatarURL?.({ size: 256 });
          return ctx.reply({
            embeds: [rankCardEmbed({
              user: target,
              xp,
              level: lvl,
              rank,
              nextXp,
              prevXp,
              avatarUrl,
            })],
          });
        }
        if (action === 'ignorerole') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
          const role = ctx.message?.mentions?.roles?.first?.();
          if (!role) return ctx.reply('Usage: ,levels ignorerole @role');
          config.update(ctx.guild.id, (c) => {
            c.community.levels.ignoreRoles = c.community.levels.ignoreRoles || [];
            if (c.community.levels.ignoreRoles.includes(role.id)) {
              c.community.levels.ignoreRoles = c.community.levels.ignoreRoles.filter((id) => id !== role.id);
            } else c.community.levels.ignoreRoles.push(role.id);
            return c;
          });
          return ctx.reply(`Toggled levels ignore for ${role}.`);
        }
        const target = ctx.message?.mentions?.users?.first?.() || ctx.user;
        const xp = getXp(ctx.guild.id, target.id);
        return ctx.reply(`**${target.tag || target.username}** — ${xp} XP · level **${levelFromXp(xp)}** · \`,levels rank\``);
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
        if (action === 'threshold') {
          const n = Number(ctx.args?.[1]) || 3;
          config.update(ctx.guild.id, (c) => { c.community.starboard.threshold = n; return c; });
          return ctx.reply(`Starboard threshold → ${n}`);
        }
        const s = config.get(ctx.guild.id).community.starboard;
        return ctx.reply(`starboard=${s.enabled} channel=${s.channelId} threshold=${s.threshold}`);
      },
    });

    registry.register({
      name: 'reactionrole',
      description: 'Bind emoji reaction → role on a message',
      aliases: ['rr'],
      module: 'community',
      permission: 'ManageRoles',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageRoles' }).ok) return ctx.reply('Need Manage Roles.');
        // ,reactionrole <messageId> <emoji> @role
        const messageId = ctx.args?.[0];
        const emoji = ctx.args?.[1];
        const role = ctx.message?.mentions?.roles?.first?.();
        if (!messageId || !emoji || !role) {
          return ctx.reply('Usage: ,reactionrole <messageId> <emoji> @role');
        }
        config.update(ctx.guild.id, (c) => {
          c.community.reactionRoles = c.community.reactionRoles || [];
          c.community.reactionRoles.push({ messageId, emoji, roleId: role.id });
          return c;
        });
        try {
          const msg = await ctx.channel.messages.fetch(messageId);
          await msg.react(emoji);
        } catch (_) {}
        return ctx.reply(`Reaction role: ${emoji} → ${role} on \`${messageId}\``);
      },
    });

    registry.register({
      name: 'buttonrole',
      description: 'Post a button that grants a role',
      module: 'community',
      permission: 'ManageRoles',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageRoles' }).ok) return ctx.reply('Need Manage Roles.');
        const role = ctx.message?.mentions?.roles?.first?.();
        const label = ctx.args?.filter((a) => !a.startsWith('<@&')).join(' ') || role?.name || 'Get role';
        if (!role) return ctx.reply('Usage: ,buttonrole @role [label]');
        const customId = `denizen_brole_${role.id}`;
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(customId).setLabel(label.slice(0, 80)).setStyle(ButtonStyle.Primary),
        );
        const msg = await ctx.channel.send({
          content: `Click for ${role}:`,
          components: [row],
        });
        config.update(ctx.guild.id, (c) => {
          c.community.buttonRoles = c.community.buttonRoles || [];
          c.community.buttonRoles.push({ messageId: msg.id, roleId: role.id, customId });
          return c;
        });
        return ctx.reply({ content: 'Button role posted.', ephemeral: true }).catch(() => ctx.reply('Posted.'));
      },
    });

    registry.register({
      name: 'boosterrole',
      description: 'Auto-role for server boosters',
      module: 'community',
      permission: 'ManageRoles',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageRoles' }).ok) return ctx.reply('Need Manage Roles.');
        const role = ctx.message?.mentions?.roles?.first?.();
        if (!role) return ctx.reply('Usage: ,boosterrole @role | off');
        if ((ctx.args?.[0] || '').toLowerCase() === 'off') {
          config.update(ctx.guild.id, (c) => { c.community.boosterRoleId = null; return c; });
          return ctx.reply('Booster role cleared.');
        }
        config.update(ctx.guild.id, (c) => { c.community.boosterRoleId = role.id; return c; });
        return ctx.reply(`Booster role → ${role}`);
      },
    });

    registry.register({
      name: 'vanityrole',
      description: 'Role for members with server vanity in status',
      module: 'community',
      permission: 'ManageRoles',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageRoles' }).ok) return ctx.reply('Need Manage Roles.');
        // ,vanityrole .gg/foo @role
        const sub = ctx.args?.[0];
        const role = ctx.message?.mentions?.roles?.first?.();
        if (!sub || !role) return ctx.reply('Usage: ,vanityrole <substring> @role | off');
        if (sub.toLowerCase() === 'off') {
          config.update(ctx.guild.id, (c) => {
            c.community.vanity = { enabled: false, substring: '', roleId: null };
            return c;
          });
          return ctx.reply('Vanity role off.');
        }
        config.update(ctx.guild.id, (c) => {
          c.community.vanity = { enabled: true, substring: sub, roleId: role.id };
          return c;
        });
        return ctx.reply(`Vanity role: status contains \`${sub}\` → ${role}`);
      },
    });

    registry.register({
      name: 'giveaway',
      description: 'Start a simple giveaway',
      module: 'community',
      permission: 'ManageGuild',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
        const action = (ctx.args?.[0] || '').toLowerCase();
        async function pickWinners(g, count = 1) {
          const ch = await ctx.guild.channels.fetch(g.channelId).catch(() => null);
          const msg = await ch?.messages?.fetch(g.messageId).catch(() => null);
          const reaction = msg?.reactions?.cache?.get('🎉');
          const users = reaction ? await reaction.users.fetch().catch(() => null) : null;
          let entrants = users ? [...users.values()].filter((u) => !u.bot) : [];
          if (g.roleId) {
            const role = ctx.guild.roles.cache.get(g.roleId);
            if (role) {
              entrants = entrants.filter((u) => role.members.has(u.id));
            }
          }
          if (!entrants.length) return [];
          const winners = [];
          const pool = [...entrants];
          const n = Math.min(count, pool.length);
          for (let i = 0; i < n; i += 1) {
            const idx = Math.floor(Math.random() * pool.length);
            winners.push(pool.splice(idx, 1)[0]);
          }
          return winners;
        }

        if (action === 'end' || action === 'reroll') {
          const msgId = ctx.args?.[1];
          const g = (config.get(ctx.guild.id).community.giveaways || []).find((x) => x.messageId === msgId);
          if (!g) return ctx.reply('Giveaway not found. Usage: ,giveaway end <messageId>');
          const winners = await pickWinners(g, g.winners || 1);
          if (!winners.length) return ctx.reply('No entrants.');
          const label = action === 'reroll' ? 'Reroll winners' : 'Winners';
          await ctx.channel.send(
            `🎉 **${label}** of **${g.prize}**: ${winners.map((w) => `<@${w.id}>`).join(', ')}!`,
          );
          return;
        }
        // ,giveaway [winners] prize...
        let winners = 1;
        let prizeParts = ctx.args || [];
        if (prizeParts[0] && /^\d+$/.test(prizeParts[0])) {
          winners = Math.min(10, Math.max(1, Number(prizeParts[0])));
          prizeParts = prizeParts.slice(1);
        }
        const role = ctx.message?.mentions?.roles?.first?.();
        const prize = prizeParts.filter((a) => !a.startsWith('<@&')).join(' ') || 'a prize';
        const req = role ? `\nRequirement: ${role}` : '';
        const msg = await ctx.channel.send(
          `🎉 **GIVEAWAY** — ${prize}${req}\nWinners: **${winners}** · React 🎉 to enter!\n_End: \`,giveaway end ${'{id}'}\` · Reroll: \`,giveaway reroll ${'{id}'}\``.replace(/\{id\}/g, '…'),
        );
        await msg.react('🎉');
        await msg.edit(
          `🎉 **GIVEAWAY** — ${prize}${req}\nWinners: **${winners}** · React 🎉 to enter!\n_End: \`,giveaway end ${msg.id}\` · Reroll: \`,giveaway reroll ${msg.id}\``,
        ).catch(() => {});
        config.update(ctx.guild.id, (c) => {
          c.community.giveaways.push({
            messageId: msg.id,
            channelId: ctx.channel.id,
            prize,
            winners,
            roleId: role?.id || null,
            ts: Date.now(),
          });
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
          return ctx.reply('Bump reminder on — nudge ~2h after `/bump` or `,bumped`.');
        }
        if (action === 'off') {
          config.update(ctx.guild.id, (c) => {
            c.community.bumpReminder = { enabled: false };
            return c;
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
        const name = `Members: ${ctx.guild.memberCount}`;
        const ch = await ctx.guild.channels.create({
          name,
          type: ChannelType.GuildVoice,
          permissionOverwrites: [{ id: ctx.guild.id, deny: [PermissionFlagsBits.Connect] }],
        });
        config.update(ctx.guild.id, (c) => {
          c.community.counters = c.community.counters || [];
          c.community.counters.push({ channelId: ch.id, type: 'members' });
          return c;
        });
        return ctx.reply(`Counter channel: ${ch}`);
      },
    });

    // Logging commands live in modules/logging (embeds + event toggles)
  }

  async function onInteraction(interaction) {
    if (!interaction.isButton()) return false;
    if (!interaction.customId?.startsWith('denizen_brole_')) return false;
    const roleId = interaction.customId.replace('denizen_brole_', '');
    const member = interaction.member;
    try {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        await interaction.reply({ content: 'Role removed.', ephemeral: true });
      } else {
        await member.roles.add(roleId);
        await interaction.reply({ content: 'Role added.', ephemeral: true });
      }
    } catch (err) {
      await interaction.reply({ content: `Failed: ${err.message}`, ephemeral: true }).catch(() => {});
    }
    return true;
  }

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

  // Counter updater
  function startCounterLoop(client) {
    setInterval(async () => {
      for (const guild of client.guilds.cache.values()) {
        const counters = config.get(guild.id).community.counters || [];
        for (const c of counters) {
          if (c.type !== 'members') continue;
          const ch = await guild.channels.fetch(c.channelId).catch(() => null);
          if (ch) await ch.setName(`Members: ${guild.memberCount}`).catch(() => {});
        }
      }
    }, 10 * 60 * 1000).unref?.();
  }

  return {
    register,
    onMemberAdd,
    onMemberRemove,
    onMessage: onMessageWrapped,
    onReactionAdd,
    onGuildMemberUpdate,
    onInteraction,
    startCounterLoop,
    getXp,
  };
}

module.exports = { createCommunity };
