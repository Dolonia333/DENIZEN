'use strict';

const { canRunCommand } = require('../../core/permissions');

function createAutomod(deps) {
  const { config, hub } = deps;
  const recent = new Map();
  const snipes = new Map();
  const editSnipes = new Map();
  const snipeHistory = new Map();
  const reactionSnipes = new Map(); // channelId -> last reaction remove

  function onMessageDelete(message) {
    if (!message.guild || message.author?.bot) return;
    const entry = {
      content: message.content || '[embed/attachment]',
      author: message.author?.tag || 'unknown',
      authorId: message.author?.id,
      attachments: [...(message.attachments?.values?.() || [])].map((a) => a.url),
      ts: Date.now(),
    };
    snipes.set(message.channel.id, entry);
    const arr = snipeHistory.get(message.channel.id) || [];
    arr.unshift(entry);
    while (arr.length > 10) arr.pop();
    snipeHistory.set(message.channel.id, arr);
  }

  function onMessageUpdate(oldMsg, newMsg) {
    if (!newMsg.guild || newMsg.author?.bot) return;
    if (oldMsg.content === newMsg.content) return;
    editSnipes.set(newMsg.channel.id, {
      before: oldMsg.content || '',
      after: newMsg.content || '',
      author: newMsg.author?.tag || 'unknown',
      ts: Date.now(),
    });
  }

  function hasZalgo(text) {
    const marks = (text.match(/[\u0300-\u036f]/g) || []).length;
    return marks > 6 || marks / Math.max(text.length, 1) > 0.3;
  }

  async function punishMessage(message, hit, cfg) {
    await message.delete().catch(() => {});
    hub.emit('automod.hit', { guildId: message.guild.id, userId: message.author.id, hit });
    if (cfg.action === 'timeout') {
      await message.member?.timeout(5 * 60 * 1000, `automod:${hit}`).catch(() => {});
    } else if (cfg.action === 'warn') {
      await message.channel.send(`⚠️ <@${message.author.id}> — filtered (${hit}).`).then((m) => {
        setTimeout(() => m.delete().catch(() => {}), 5000);
      }).catch(() => {});
    }
  }

  async function onMessage(message) {
    if (!message.guild || message.author?.bot) return;
    const cfg = config.get(message.guild.id).automod;
    if (!cfg.enabled) return;
    if (message.member?.permissions?.has?.('ManageMessages')) return;
    if ((cfg.immuneChannels || []).includes(message.channel.id)) return;
    if (message.member?.roles?.cache && (cfg.immuneRoles || []).some((r) => message.member.roles.cache.has(r))) {
      return;
    }

    const content = message.content || '';
    let hit = null;

    if (cfg.invites && /(discord\.gg|discord(?:app)?\.com\/invite)/i.test(content)) {
      const codes = [...content.matchAll(/(?:discord\.gg|discord(?:app)?\.com\/invite)\/([a-zA-Z0-9-]+)/gi)]
        .map((m) => m[1].toLowerCase());
      const wl = (cfg.inviteWhitelist || []).map((c) => String(c).toLowerCase());
      if (!codes.length || codes.some((c) => !wl.includes(c))) hit = 'invite';
    }
    if (!hit && cfg.links && /https?:\/\/\S+/i.test(content)) hit = 'link';
    if (!hit && cfg.words?.length) {
      const lower = content.toLowerCase();
      if (cfg.words.some((w) => lower.includes(String(w).toLowerCase()))) hit = 'word';
    }
    if (!hit && cfg.caps?.enabled && content.length >= (cfg.caps.minLen || 12)) {
      const letters = content.replace(/[^a-zA-Z]/g, '');
      if (letters.length) {
        const up = (letters.match(/[A-Z]/g) || []).length;
        if (up / letters.length >= (cfg.caps.ratio || 0.7)) hit = 'caps';
      }
    }
    if (!hit && cfg.mentions?.enabled) {
      const count = message.mentions.users.size + message.mentions.roles.size;
      if (count > (cfg.mentions.max || 5)) hit = 'mentions';
    }
    if (!hit && cfg.zalgo?.enabled && hasZalgo(content)) hit = 'zalgo';
    if (!hit && cfg.images?.enabled && message.attachments?.size > 0) {
      const onlyImage = [...message.attachments.values()].every((a) =>
        (a.contentType || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.name || ''));
      if (onlyImage && !content.trim()) hit = 'images';
    }
    if (!hit && cfg.spam?.enabled) {
      const key = `${message.channel.id}:${message.author.id}`;
      const now = Date.now();
      const arr = recent.get(key) || [];
      arr.push(now);
      const windowMs = cfg.spam.windowMs || 3000;
      while (arr.length && now - arr[0] > windowMs) arr.shift();
      recent.set(key, arr);
      if (arr.length >= (cfg.spam.maxMsgs || 5)) hit = 'spam';
    }
    if (!hit) return;
    await punishMessage(message, hit, cfg);
  }

  function register(registry) {
    registry.register({
      name: 'automod',
      description: 'Configure automod filters',
      module: 'automod',
      permission: 'ManageGuild',
      options: [
        { name: 'action', description: 'on|off|status|invites|links|spam|caps|mentions|zalgo|words|action|immune', type: 3, required: true },
        { name: 'value', description: 'on|off|word|delete|timeout|warn', type: 3, required: false },
      ],
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'status').toLowerCase();
        const value = (ctx.getString?.('value') || ctx.args?.[1] || '').toLowerCase();

        if (action === 'on') {
          config.update(ctx.guild.id, (c) => { c.automod.enabled = true; return c; });
          return ctx.reply('Automod **on**. Enable filters: invites links spam caps mentions zalgo words.');
        }
        if (action === 'off') {
          config.update(ctx.guild.id, (c) => { c.automod.enabled = false; return c; });
          return ctx.reply('Automod **off**.');
        }
        if (['invites', 'links'].includes(action)) {
          const on = value !== 'off';
          config.update(ctx.guild.id, (c) => { c.automod[action] = on; return c; });
          return ctx.reply(`${action} filter **${on ? 'on' : 'off'}**.`);
        }
        if (['spam', 'caps', 'mentions', 'zalgo', 'images'].includes(action)) {
          const on = value !== 'off';
          config.update(ctx.guild.id, (c) => {
            c.automod[action] = c.automod[action] || {};
            if (typeof c.automod[action] === 'object') c.automod[action].enabled = on;
            return c;
          });
          return ctx.reply(`${action} filter **${on ? 'on' : 'off'}**.`);
        }
        if (action === 'words') {
          if (value === 'clear') {
            config.update(ctx.guild.id, (c) => { c.automod.words = []; return c; });
            return ctx.reply('Word list cleared.');
          }
          const word = ctx.getString?.('value') || ctx.args?.slice(1).join(' ');
          if (!word) return ctx.reply('Usage: ,automod words <word> | ,automod words clear');
          config.update(ctx.guild.id, (c) => {
            c.automod.words = c.automod.words || [];
            if (!c.automod.words.includes(word)) c.automod.words.push(word);
            return c;
          });
          return ctx.reply(`Added blocked word \`${word}\`.`);
        }
        if (action === 'action') {
          if (!['delete', 'timeout', 'warn'].includes(value)) {
            return ctx.reply('Usage: ,automod action delete|timeout|warn');
          }
          config.update(ctx.guild.id, (c) => { c.automod.action = value; return c; });
          return ctx.reply(`Automod action → \`${value}\`.`);
        }
        if (action === 'immune') {
          const role = ctx.message?.mentions?.roles?.first?.();
          const ch = ctx.message?.mentions?.channels?.first?.();
          if (role) {
            config.update(ctx.guild.id, (c) => {
              c.automod.immuneRoles = c.automod.immuneRoles || [];
              if (c.automod.immuneRoles.includes(role.id)) {
                c.automod.immuneRoles = c.automod.immuneRoles.filter((id) => id !== role.id);
              } else c.automod.immuneRoles.push(role.id);
              return c;
            });
            return ctx.reply(`Toggled immune role ${role}.`);
          }
          const channel = ch || (value === 'channel' ? ctx.channel : null);
          if (channel) {
            config.update(ctx.guild.id, (c) => {
              c.automod.immuneChannels = c.automod.immuneChannels || [];
              if (c.automod.immuneChannels.includes(channel.id)) {
                c.automod.immuneChannels = c.automod.immuneChannels.filter((id) => id !== channel.id);
              } else c.automod.immuneChannels.push(channel.id);
              return c;
            });
            return ctx.reply(`Toggled immune channel ${channel}.`);
          }
          return ctx.reply('Usage: ,automod immune @role | ,automod immune #channel');
        }
        if (action === 'whitelist' || action === 'invitewhitelist') {
          const code = value || ctx.args?.[1];
          if (!code) return ctx.reply('Usage: ,automod whitelist <inviteCode>');
          config.update(ctx.guild.id, (c) => {
            c.automod.inviteWhitelist = c.automod.inviteWhitelist || [];
            if (!c.automod.inviteWhitelist.includes(code)) c.automod.inviteWhitelist.push(code);
            return c;
          });
          return ctx.reply(`Invite code \`${code}\` whitelisted.`);
        }
        const a = config.get(ctx.guild.id).automod;
        return ctx.reply([
          `**Automod** ${a.enabled ? 'ON' : 'OFF'} action=${a.action || 'delete'}`,
          `invites=${a.invites} links=${a.links} words=${(a.words || []).length}`,
          `spam=${a.spam?.enabled} caps=${a.caps?.enabled} mentions=${a.mentions?.enabled}`,
          `zalgo=${a.zalgo?.enabled} images=${a.images?.enabled}`,
          `immune roles=${(a.immuneRoles || []).length} channels=${(a.immuneChannels || []).length}`,
        ].join('\n'));
      },
    });

    registry.register({
      name: 'snipe',
      description: 'Show deleted message(s) in channel',
      module: 'automod',
      options: [{ name: 'index', description: '1-10 history index', type: 4, required: false }],
      async run(ctx) {
        const idx = Math.max(0, (ctx.getInteger?.('index') || Number(ctx.args?.[0]) || 1) - 1);
        const hist = snipeHistory.get(ctx.channel.id) || [];
        const s = hist[idx] || snipes.get(ctx.channel.id);
        if (!s) return ctx.reply('Nothing to snipe.');
        const att = s.attachments?.length ? `\n${s.attachments.join('\n')}` : '';
        return ctx.reply(`**${s.author}** (${idx + 1}/${hist.length || 1}): ${s.content.slice(0, 1600)}${att}`);
      },
    });

    registry.register({
      name: 'editsnipe',
      description: 'Show last edited message in channel',
      module: 'automod',
      async run(ctx) {
        const s = editSnipes.get(ctx.channel.id);
        if (!s) return ctx.reply('Nothing to editsnipe.');
        return ctx.reply(`**${s.author}**\nBefore: ${s.before.slice(0, 800)}\nAfter: ${s.after.slice(0, 800)}`);
      },
    });

    registry.register({
      name: 'reactionsnipe',
      description: 'Show last removed reaction in channel',
      aliases: ['rsnipe'],
      module: 'automod',
      async run(ctx) {
        const s = reactionSnipes.get(ctx.channel.id);
        if (!s) return ctx.reply('Nothing to reaction-snipe.');
        return ctx.reply(
          `**${s.userTag}** removed ${s.emoji} on message by **${s.messageAuthor}**\n${s.jump || ''}`.slice(0, 1900),
        );
      },
    });
  }

  function onReactionRemove(reaction, user) {
    try {
      const msg = reaction.message;
      if (!msg?.guild || user?.bot) return;
      reactionSnipes.set(msg.channel.id, {
        emoji: reaction.emoji?.name || reaction.emoji?.id || '?',
        userTag: user.tag || user.id,
        messageAuthor: msg.author?.tag || 'unknown',
        jump: msg.url,
        ts: Date.now(),
      });
    } catch (_) {}
  }

  return {
    register,
    onMessage,
    onMessageDelete,
    onMessageUpdate,
    onReactionRemove,
  };
}

module.exports = { createAutomod };
