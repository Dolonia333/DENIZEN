'use strict';

/**
 * Conversation sense module — Discord as a way for Denizen to improve how it talks.
 *
 * Learns communication styles (not demographics) so replies feel real across
 * different kinds of people. User-facing name: "sense" / "voice" (not "farm").
 */

const path = require('path');
const { canRunCommand } = require('../../core/permissions');
const { successEmbed, dangerEmbed, baseEmbed, BRAND } = require('../../core/ui-kit');

const ROOT_SRC = path.join(__dirname, '..', '..', '..', '..', 'src');

let harvest;
let sense;
try {
  harvest = require(path.join(ROOT_SRC, 'denizen-discord-farm.js'));
} catch (err) {
  console.warn('[sense] harvest module missing:', err.message);
  harvest = null;
}
try {
  sense = require(path.join(ROOT_SRC, 'denizen-conversation-sense.js'));
} catch (err) {
  console.warn('[sense] conversation-sense missing:', err.message);
  sense = null;
}

function createDataFarm(deps) {
  const { config, hub } = deps;
  let enabledOverride = null;

  function isOn(guildId) {
    if (enabledOverride === false) return false;
    if (enabledOverride === true) return true;
    if (guildId) {
      const g = config.get(guildId);
      // prefer sense.* then legacy farm.*
      if (g?.sense?.enabled === false || g?.farm?.enabled === false) return false;
      if (g?.sense?.enabled === true || g?.farm?.enabled === true) return true;
    }
    if (sense?.senseEnabled) return sense.senseEnabled();
    return harvest ? harvest.farmEnabled() : false;
  }

  function channelFilters(guildId) {
    const g = config.get(guildId) || {};
    const s = g.sense || {};
    const f = g.farm || {};
    return {
      channelAllow: s.channelAllow?.length ? s.channelAllow : (f.channelAllow || []),
      channelDeny: s.channelDeny?.length ? s.channelDeny : (f.channelDeny || []),
    };
  }

  function onMessage(message) {
    if (!harvest || !message?.guild) return;
    if (!isOn(message.guild.id)) return;
    if (message.author?.bot) return;
    if (message.system) return;

    const filters = channelFilters(message.guild.id);
    if (Array.isArray(filters.channelAllow) && filters.channelAllow.length) {
      if (!filters.channelAllow.includes(message.channel.id)) return;
    }
    if (Array.isArray(filters.channelDeny) && filters.channelDeny.includes(message.channel.id)) return;

    const content = message.content || '';
    let text = content;
    if (!text && message.attachments?.size) {
      text = `[attachment x${message.attachments.size}]`;
    }
    if (!text) return;

    const result = harvest.ingestChatEvent({
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

    if (result.ok && (result.signals?.length || result.sense?.ok)) {
      hub.emit('sense.signal', {
        guildId: message.guild.id,
        channelId: message.channel.id,
        signals: result.signals,
        topics: result.topics,
        style: result.sense?.primary || null,
      });
    }
  }

  function setEnabled(guildId, on) {
    enabledOverride = on;
    config.update(guildId, (c) => {
      c.sense = c.sense || {};
      c.sense.enabled = on;
      c.farm = c.farm || {};
      c.farm.enabled = on; // keep legacy in sync
      return c;
    });
  }

  function register(registry) {
    registry.register({
      name: 'sense',
      description: 'How Denizen learns conversation styles for better replies',
      aliases: ['voice', 'learn', 'farm', 'datafarm', 'harvest'],
      module: 'sense',
      options: [
        { name: 'action', description: 'status|on|off|types|me|allow|deny|topics', type: 3, required: false },
      ],
      async run(ctx) {
        if (!harvest && !sense) {
          return ctx.reply({
            embeds: [dangerEmbed('Sense offline', 'Conversation learning modules not loaded')],
          });
        }
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'status').toLowerCase();

        if (action === 'on' || action === 'off') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) {
            return ctx.reply({ embeds: [dangerEmbed('Denied', 'Need Manage Guild')] });
          }
          const on = action === 'on';
          setEnabled(ctx.guild.id, on);
          return ctx.reply({
            embeds: [successEmbed(
              on ? 'Conversation sense ON' : 'Conversation sense OFF',
              on
                ? 'Denizen will learn how people in this server talk — so replies feel more real and fit different styles.'
                : 'Paused learning conversation styles in this server (and theme harvest).',
            )],
          });
        }

        if (action === 'allow' || action === 'deny') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) {
            return ctx.reply({ embeds: [dangerEmbed('Denied', 'Need Manage Guild')] });
          }
          const ch = ctx.message?.mentions?.channels?.first?.() || ctx.channel;
          config.update(ctx.guild.id, (c) => {
            c.sense = c.sense || { channelAllow: [], channelDeny: [] };
            c.farm = c.farm || {};
            if (action === 'allow') {
              c.sense.channelAllow = c.sense.channelAllow || [];
              if (!c.sense.channelAllow.includes(ch.id)) c.sense.channelAllow.push(ch.id);
              c.sense.channelDeny = (c.sense.channelDeny || []).filter((id) => id !== ch.id);
            } else {
              c.sense.channelDeny = c.sense.channelDeny || [];
              if (!c.sense.channelDeny.includes(ch.id)) c.sense.channelDeny.push(ch.id);
              c.sense.channelAllow = (c.sense.channelAllow || []).filter((id) => id !== ch.id);
            }
            c.farm.channelAllow = c.sense.channelAllow;
            c.farm.channelDeny = c.sense.channelDeny;
            return c;
          });
          return ctx.reply({
            embeds: [successEmbed(
              action === 'allow' ? 'Channel included' : 'Channel excluded',
              `${ch} ${action === 'allow' ? 'helps train conversation sense' : 'skipped for learning'}`,
            )],
          });
        }

        if (action === 'me' || action === 'style') {
          if (!sense) {
            return ctx.reply({ embeds: [dangerEmbed('Sense offline', 'Style classifier not loaded')] });
          }
          const person = sense.getPersonStyle(ctx.user?.id || ctx.author?.id);
          const guide = person.guidance?.how || 'Still learning.';
          return ctx.reply({
            embeds: [baseEmbed({
              color: BRAND.primary,
              title: 'How Denizen reads your chat style',
              description: [
                person.known
                  ? `Primary style: **${person.primary}**`
                  : 'Still getting to know how you write — chat more and this fills in.',
                person.types?.length ? `Also sees: ${person.types.map((t) => `\`${t}\``).join(' · ')}` : '',
                '',
                `**When talking to you:** ${guide}`,
                '',
                '_Styles are about how you message (short, technical, social…) — not who you are offline._',
              ].filter(Boolean).join('\n'),
              fields: person.n
                ? [{ name: 'Samples', value: String(person.n), inline: true }]
                : [],
              footerExtra: 'hashed id · no raw dossier',
            })],
          });
        }

        if (action === 'types' || action === 'people') {
          if (!sense) {
            return ctx.reply({ embeds: [dangerEmbed('Sense offline', 'Style classifier not loaded')] });
          }
          const sc = sense.buildSenseScorecard();
          const mix = (sc.typeMix || []).slice(0, 10)
            .map((t, i) => `**${i + 1}.** \`${t.type}\` ×${t.count}`);
          const community = ctx.guild && sense.getCommunityVoice(ctx.guild.id);
          return ctx.reply({
            embeds: [baseEmbed({
              color: BRAND.primary,
              title: 'People styles Denizen is learning',
              description: [
                'Different people talk differently. Denizen learns **communication styles** so experiences feel better for each person.',
                '',
                mix.join('\n') || '_Chat more in this server — styles appear as patterns show up._',
                community
                  ? `\n**This server leans:** \`${community.primary}\` · mix ${community.mix?.join(', ') || '—'}`
                  : '',
              ].join('\n'),
              fields: [
                { name: 'Styles tracked', value: String(sc.peopleKnown || 0), inline: true },
                { name: 'Communities', value: String(sc.communities || 0), inline: true },
              ],
              footerExtra: 'concise · expressive · technical · social · analytical · …',
            })],
          });
        }

        if (action === 'topics') {
          if (!harvest) {
            return ctx.reply({ embeds: [dangerEmbed('Offline', 'Theme harvest not loaded')] });
          }
          const sc = harvest.buildDiscordFarmScorecard();
          const lines = (sc.topicsHot || []).slice(0, 12)
            .map((t, i) => `**${i + 1}.** \`${t.topic}\` ×${t.count}`
              + (t.friction ? ` · stuck×${t.friction}` : '')
              + (t.questions ? ` · ?${t.questions}` : ''));
          return ctx.reply({
            embeds: [baseEmbed({
              color: BRAND.primary,
              title: 'What people are talking about',
              description: lines.join('\n') || '_No themes yet — keep chatting._',
              footerExtra: 'themes feed better answers',
            })],
          });
        }

        // status (default)
        const h = harvest ? harvest.buildDiscordFarmScorecard() : null;
        const s = sense ? sense.buildSenseScorecard() : null;
        const community = (sense && ctx.guild) ? sense.getCommunityVoice(ctx.guild.id) : null;
        const filters = channelFilters(ctx.guild?.id);
        const myStyle = sense ? sense.getPersonStyle(ctx.user?.id || ctx.author?.id) : null;

        return ctx.reply({
          embeds: [baseEmbed({
            color: isOn(ctx.guild?.id) ? BRAND.success : BRAND.warn,
            title: 'Conversation sense',
            description: [
              'Denizen uses real Discord conversation to **get better at talking to different people** —',
              'not to train a creepy model copy of the server.',
              '',
              '• **Styles** — concise, technical, social, expressive…',
              '• **Themes** — what the room cares about / gets stuck on',
              '• **Replies** — length, energy, and tone adapt to *you*',
              '',
              ...(s?.notes || []),
            ].join('\n'),
            fields: [
              { name: 'Status', value: isOn(ctx.guild?.id) ? '🟢 learning' : '🔴 paused', inline: true },
              { name: 'People styles', value: String(s?.peopleKnown || 0), inline: true },
              { name: 'Msgs 24h', value: String(h?.messages24h || 0), inline: true },
              {
                name: 'Style mix',
                value: (s?.typeMix || []).slice(0, 5).map((t) => `\`${t.type}\`(${t.count})`).join(' · ') || '—',
              },
              {
                name: 'This server',
                value: community
                  ? `\`${community.primary}\` · ${community.mix?.slice(0, 4).join(', ') || 'warming up'}`
                  : 'warming up',
              },
              {
                name: 'You',
                value: myStyle
                  ? (myStyle.known ? `\`${myStyle.primary}\`` : 'still learning your style')
                  : '—',
                inline: true,
              },
              {
                name: 'Hot themes',
                value: (h?.topicsHot || []).slice(0, 5).map((t) => `\`${t.topic}\``).join(' · ') || '—',
              },
              {
                name: 'Channels',
                value: `include: ${filters.channelAllow.length || 'all'} · exclude: ${filters.channelDeny.length || 'none'}`,
              },
              {
                name: 'Commands',
                value: '`,sense` · `,sense me` · `,sense types` · `,sense topics` · `,sense on|off`',
              },
            ],
            footerExtra: 'privacy: hashed users · redacted secrets · not weight training',
          })],
        });
      },
    });
  }

  return { register, onMessage, isOn };
}

module.exports = { createDataFarm };
