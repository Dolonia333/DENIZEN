'use strict';

/**
 * Weekly "who hung out" recap — voice minutes leaderboard posted to a channel.
 * Manual: /hangout report | setup | enable | disable
 */

const { ChannelType } = require('discord.js');
const { isoWeekKey } = require('../../tracker');

function createHangoutModule(deps) {
  const { config, tracker, registry, client } = deps;
  let timer = null;

  function publicUrl() {
    return String(process.env.DENIZEN_PUBLIC_URL || process.env.DENIZEN_URL || '').replace(/\/$/, '');
  }

  function formatReport(guild, board) {
    const lines = board.rows.length
      ? board.rows.map((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`${i + 1}.\``;
        return `${medal} **${r.displayName}** — ${r.minutes} min`;
      })
      : ['_No voice hangouts logged this week yet (need 30s+ in VC)._'];

    const share = publicUrl()
      ? `${publicUrl()}/discord-map/?guildId=${encodeURIComponent(guild.id)}&view=public`
      : null;

    return {
      embeds: [{
        color: 0x5865f2,
        title: `Who hung out · ${board.week}`,
        description: [
          `Top voice time in **${guild.name}** this week:`,
          '',
          ...lines,
          '',
          share ? `🗺️ [Open the public map](${share})` : '🗺️ Open `/discord-map/` to see the live office.',
          '',
          '_Tracked by Denizen Spaces · boost for a golden headset ✨_',
        ].join('\n'),
        footer: { text: 'Denizen Spaces · weekly hangout' },
        timestamp: new Date().toISOString(),
      }],
    };
  }

  async function postReport(guild, { force = false } = {}) {
    if (!guild?.id) return { ok: false, reason: 'no guild' };
    const cfg = config.get(guild.id);
    const h = cfg.hangout || {};
    if (!force && !h.enabled) return { ok: false, reason: 'disabled' };
    if (!h.channelId) return { ok: false, reason: 'no channel' };

    const board = tracker.hangoutLeaderboard(guild.id, { limit: 10 });
    const week = board.week;
    if (!force && h.lastPostedWeek === week) {
      return { ok: false, reason: 'already posted this week' };
    }

    const ch = await guild.channels.fetch(h.channelId).catch(() => null);
    if (!ch?.isTextBased?.()) return { ok: false, reason: 'bad channel' };

    await ch.send(formatReport(guild, board));
    config.update(guild.id, (c) => {
      c.hangout = c.hangout || {};
      c.hangout.lastPostedWeek = week;
      return c;
    });
    return { ok: true, week, count: board.rows.length };
  }

  function checkSchedule() {
    if (!client?.guilds) return;
    const now = new Date();
    const day = now.getUTCDay();
    const hour = now.getUTCHours();
    for (const guild of client.guilds.cache.values()) {
      try {
        const h = config.get(guild.id).hangout || {};
        if (!h.enabled || !h.channelId) continue;
        const wantDay = Number(h.weekday ?? 1);
        const wantHour = Number(h.hourUtc ?? 17);
        if (day !== wantDay || hour !== wantHour) continue;
        postReport(guild, { force: false }).catch((err) => {
          console.warn('[hangout] post failed', guild.id, err.message || err);
        });
      } catch (err) {
        console.warn('[hangout] schedule', err.message || err);
      }
    }
  }

  function startScheduler() {
    if (timer) return;
    // Check every 15 minutes
    timer = setInterval(checkSchedule, 15 * 60 * 1000);
    if (timer.unref) timer.unref();
  }

  function register(reg) {
    reg.register({
      name: 'hangout',
      description: 'Weekly who-hung-out voice recap',
      module: 'hangout',
      options: [
        {
          type: 1,
          name: 'setup',
          description: 'Set the channel for weekly recaps',
          options: [
            {
              type: 7,
              name: 'channel',
              description: 'Text channel for reports',
              required: true,
              channel_types: [ChannelType.GuildText],
            },
          ],
        },
        {
          type: 1,
          name: 'enable',
          description: 'Enable automatic weekly posts (Mon 17:00 UTC by default)',
        },
        {
          type: 1,
          name: 'disable',
          description: 'Disable automatic weekly posts',
        },
        {
          type: 1,
          name: 'report',
          description: 'Post this week’s hangout leaderboard now',
        },
        {
          type: 1,
          name: 'status',
          description: 'Show hangout tracker settings',
        },
      ],
      async run(ctx) {
        const sub = ctx.interaction?.options?.getSubcommand?.(false)
          || ctx.args?.[0]
          || 'status';
        const guild = ctx.guild;
        if (!guild) return ctx.reply('Guild only.');

        if (sub === 'setup') {
          const ch = ctx.getChannel?.('channel')
            || ctx.message?.mentions?.channels?.first?.();
          if (!ch) return ctx.reply('Pick a text channel.');
          config.update(guild.id, (c) => {
            c.hangout = c.hangout || {};
            c.hangout.channelId = ch.id;
            c.hangout.enabled = true;
            return c;
          });
          return ctx.reply({
            content: `Hangout recaps → <#${ch.id}> (auto enabled). Use \`/hangout report\` anytime.`,
            ephemeral: true,
          });
        }

        if (sub === 'enable') {
          config.update(guild.id, (c) => {
            c.hangout = c.hangout || {};
            c.hangout.enabled = true;
            return c;
          });
          return ctx.reply({ content: 'Weekly hangout posts **enabled**.', ephemeral: true });
        }

        if (sub === 'disable') {
          config.update(guild.id, (c) => {
            c.hangout = c.hangout || {};
            c.hangout.enabled = false;
            return c;
          });
          return ctx.reply({ content: 'Weekly hangout posts **disabled**.', ephemeral: true });
        }

        if (sub === 'report') {
          const result = await postReport(guild, { force: true });
          if (!result.ok && result.reason === 'no channel') {
            return ctx.reply('Run `/hangout setup` with a channel first.');
          }
          if (!result.ok) return ctx.reply(`Could not post: ${result.reason}`);
          return ctx.reply({ content: `Posted hangout report for **${result.week}**.`, ephemeral: true });
        }

        // status
        const h = config.get(guild.id).hangout || {};
        const board = tracker.hangoutLeaderboard(guild.id, { limit: 5 });
        const top = board.rows.map((r) => `• ${r.displayName}: ${r.minutes}m`).join('\n') || '(empty)';
        return ctx.reply({
          content: [
            `**Hangout** · week ${board.week}`,
            `enabled: **${!!h.enabled}** · channel: ${h.channelId ? `<#${h.channelId}>` : '_none_'}`,
            `schedule: weekday **${h.weekday ?? 1}** (0=Sun) · hour UTC **${h.hourUtc ?? 17}**`,
            `last posted: ${h.lastPostedWeek || '_never_'}`,
            '',
            'Top so far:',
            top,
          ].join('\n'),
          ephemeral: true,
        });
      },
    });
  }

  // Kick scheduler when module loads; client may not be ready yet — interval is fine
  startScheduler();

  return { register, postReport, startScheduler };
}

module.exports = { createHangoutModule };
