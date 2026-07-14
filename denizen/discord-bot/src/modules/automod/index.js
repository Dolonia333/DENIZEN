'use strict';

const { canRunCommand } = require('../../core/permissions');

function createAutomod(deps) {
  const { config, hub } = deps;
  const recent = new Map(); // channelId:userId -> timestamps
  const snipes = new Map(); // channelId -> { content, author, ts }
  const editSnipes = new Map();

  function onMessageDelete(message) {
    if (!message.guild || message.author?.bot) return;
    snipes.set(message.channel.id, {
      content: message.content || '[embed/attachment]',
      author: message.author?.tag || 'unknown',
      ts: Date.now(),
    });
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

  async function onMessage(message) {
    if (!message.guild || message.author?.bot) return;
    const cfg = config.get(message.guild.id).automod;
    if (!cfg.enabled) return;
    const content = message.content || '';
    let hit = null;
    if (cfg.invites && /(discord\.gg|discord\.com\/invite)/i.test(content)) hit = 'invite';
    if (!hit && cfg.links && /https?:\/\//i.test(content)) hit = 'link';
    if (!hit && cfg.words?.length) {
      const lower = content.toLowerCase();
      if (cfg.words.some((w) => lower.includes(String(w).toLowerCase()))) hit = 'word';
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
    await message.delete().catch(() => {});
    hub.emit('automod.hit', { guildId: message.guild.id, userId: message.author.id, hit });
  }

  function register(registry) {
    registry.register({
      name: 'automod',
      description: 'Configure automod filters',
      module: 'automod',
      permission: 'ManageGuild',
      options: [
        { name: 'action', description: 'on|off|status|invites|links', type: 3, required: true },
        { name: 'value', description: 'on|off for toggles', type: 3, required: false },
      ],
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'status').toLowerCase();
        const value = (ctx.getString?.('value') || ctx.args?.[1] || '').toLowerCase();
        if (action === 'on') {
          config.update(ctx.guild.id, (c) => { c.automod.enabled = true; return c; });
          return ctx.reply('Automod on.');
        }
        if (action === 'off') {
          config.update(ctx.guild.id, (c) => { c.automod.enabled = false; return c; });
          return ctx.reply('Automod off.');
        }
        if (action === 'invites' || action === 'links') {
          const on = value !== 'off';
          config.update(ctx.guild.id, (c) => { c.automod[action] = on; return c; });
          return ctx.reply(`${action} filter ${on ? 'on' : 'off'}.`);
        }
        const a = config.get(ctx.guild.id).automod;
        return ctx.reply(`automod=${a.enabled} invites=${a.invites} links=${a.links} words=${a.words.length}`);
      },
    });

    registry.register({
      name: 'snipe',
      description: 'Show last deleted message in channel',
      module: 'automod',
      async run(ctx) {
        const s = snipes.get(ctx.channel.id);
        if (!s) return ctx.reply('Nothing to snipe.');
        return ctx.reply(`**${s.author}**: ${s.content.slice(0, 1800)}`);
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
  }

  return { register, onMessage, onMessageDelete, onMessageUpdate };
}

module.exports = { createAutomod };
