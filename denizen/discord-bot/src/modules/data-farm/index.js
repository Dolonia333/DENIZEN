'use strict';

/**
 * Discord data farm module — harvests guild chat into Denizen learning lake.
 * Writes under denizen/data/discord-farm/ (shared with office harness).
 */

const path = require('path');
const { canRunCommand } = require('../../core/permissions');
const { infoEmbed, successEmbed, dangerEmbed, baseEmbed, BRAND } = require('../../core/ui-kit');

// Resolve farm from monorepo denizen root (bot lives in denizen/discord-bot)
// data-farm → modules → src → discord-bot → denizen/src
let farm;
try {
  farm = require(path.join(__dirname, '..', '..', '..', '..', 'src', 'denizen-discord-farm.js'));
} catch (err) {
  console.warn('[data-farm] core module missing:', err.message);
  farm = null;
}

function createDataFarm(deps) {
  const { config, hub } = deps;
  let enabledOverride = null; // null = env default

  function isOn(guildId) {
    if (enabledOverride === false) return false;
    if (enabledOverride === true) return true;
    if (guildId) {
      const g = config.get(guildId);
      if (g?.farm?.enabled === false) return false;
      if (g?.farm?.enabled === true) return true;
    }
    return farm ? farm.farmEnabled() : false;
  }

  function onMessage(message) {
    if (!farm || !message?.guild) return;
    if (!isOn(message.guild.id)) return;
    if (message.author?.bot) return;
    if (message.system) return;

    const gcfg = config.get(message.guild.id)?.farm || {};
    if (Array.isArray(gcfg.channelAllow) && gcfg.channelAllow.length) {
      if (!gcfg.channelAllow.includes(message.channel.id)) return;
    }
    if (Array.isArray(gcfg.channelDeny) && gcfg.channelDeny.includes(message.channel.id)) return;

    const content = message.content || '';
    // Attachments note
    let text = content;
    if (!text && message.attachments?.size) {
      text = `[attachment x${message.attachments.size}]`;
    }
    if (!text) return;

    const result = farm.ingestChatEvent({
      source: 'discord',
      ts: message.createdTimestamp || Date.now(),
      guildId: message.guild.id,
      guildName: message.guild.name,
      channelId: message.channel.id,
      channelName: message.channel.name,
      userId: message.author.id,
      displayName: message.member?.displayName || message.author.username,
      content: text,
      messageId: message.id,
      isDm: false,
      bot: false,
      keepCommands: true,
    });

    if (result.ok && result.signals?.length) {
      hub.emit('farm.signal', {
        guildId: message.guild.id,
        channelId: message.channel.id,
        signals: result.signals,
        topics: result.topics,
      });
    }
  }

  function register(registry) {
    registry.register({
      name: 'farm',
      description: 'Discord data farm status / controls (learn from chats)',
      aliases: ['datafarm', 'harvest'],
      module: 'farm',
      options: [
        { name: 'action', description: 'status|on|off|allow|deny|topics', type: 3, required: false },
      ],
      async run(ctx) {
        if (!farm) {
          return ctx.reply({ embeds: [dangerEmbed('Farm offline', 'denizen-discord-farm.js not loaded')] });
        }
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'status').toLowerCase();

        if (action === 'on' || action === 'off') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) {
            return ctx.reply({ embeds: [dangerEmbed('Denied', 'Need Manage Guild')] });
          }
          const on = action === 'on';
          enabledOverride = on;
          config.update(ctx.guild.id, (c) => {
            c.farm = c.farm || {};
            c.farm.enabled = on;
            return c;
          });
          return ctx.reply({
            embeds: [successEmbed(
              on ? 'Data farm ON' : 'Data farm OFF',
              on
                ? 'Denizen will harvest this server’s chats into the learning lake (redacted).'
                : 'Farming paused for this bot process override + guild flag.',
            )],
          });
        }

        if (action === 'allow' || action === 'deny') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) {
            return ctx.reply({ embeds: [dangerEmbed('Denied', 'Need Manage Guild')] });
          }
          const ch = ctx.message?.mentions?.channels?.first?.() || ctx.channel;
          config.update(ctx.guild.id, (c) => {
            c.farm = c.farm || {};
            if (action === 'allow') {
              c.farm.channelAllow = c.farm.channelAllow || [];
              if (!c.farm.channelAllow.includes(ch.id)) c.farm.channelAllow.push(ch.id);
              c.farm.channelDeny = (c.farm.channelDeny || []).filter((id) => id !== ch.id);
            } else {
              c.farm.channelDeny = c.farm.channelDeny || [];
              if (!c.farm.channelDeny.includes(ch.id)) c.farm.channelDeny.push(ch.id);
              c.farm.channelAllow = (c.farm.channelAllow || []).filter((id) => id !== ch.id);
            }
            return c;
          });
          return ctx.reply({
            embeds: [successEmbed(
              action === 'allow' ? 'Channel allowed' : 'Channel denied',
              `${ch} ${action === 'allow' ? 'will be farmed' : 'excluded from farm'}`,
            )],
          });
        }

        if (action === 'topics') {
          const sc = farm.buildDiscordFarmScorecard();
          const lines = (sc.topicsHot || []).slice(0, 12)
            .map((t, i) => `**${i + 1}.** \`${t.topic}\` ×${t.count}`
              + (t.friction ? ` · ⚠${t.friction}` : '')
              + (t.questions ? ` · ?${t.questions}` : ''));
          return ctx.reply({
            embeds: [baseEmbed({
              color: BRAND.primary,
              title: 'Farm topics (hot)',
              description: lines.join('\n') || '_No topics yet — talk more in farmed channels._',
              footerExtra: 'discord data farm',
            })],
          });
        }

        const sc = farm.buildDiscordFarmScorecard();
        const g = config.get(ctx.guild.id)?.farm || {};
        return ctx.reply({
          embeds: [baseEmbed({
            color: sc.enabled && isOn(ctx.guild.id) ? BRAND.success : BRAND.warn,
            title: 'Discord data farm',
            description: [
              'Denizen learns from **server chat patterns** (not model weight training):',
              'topics · questions · friction · commands → `data/discord-farm/` + harness lessons.',
              '',
              ...(sc.notes || []),
            ].join('\n'),
            fields: [
              { name: 'Status', value: isOn(ctx.guild.id) ? '🟢 farming' : '🔴 paused', inline: true },
              { name: 'Msgs 24h', value: String(sc.messages24h || 0), inline: true },
              { name: 'Questions', value: String(sc.questions24h || 0), inline: true },
              { name: 'Friction', value: String(sc.friction24h || 0), inline: true },
              { name: 'Praise', value: String(sc.praise24h || 0), inline: true },
              { name: 'Commands', value: String(sc.commands24h || 0), inline: true },
              {
                name: 'Hot topics',
                value: (sc.topicsHot || []).slice(0, 5).map((t) => `\`${t.topic}\`(${t.count})`).join(' · ') || '—',
              },
              {
                name: 'Guild filters',
                value: [
                  `allow: ${(g.channelAllow || []).length || 'all'}`,
                  `deny: ${(g.channelDeny || []).length || 'none'}`,
                ].join(' · '),
              },
            ],
            footerExtra: 'privacy: bodies redacted · user ids hashed',
          })],
        });
      },
    });
  }

  return { register, onMessage, isOn };
}

module.exports = { createDataFarm };
