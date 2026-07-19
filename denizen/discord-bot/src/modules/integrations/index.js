'use strict';

/**
 * Platform integrations — Last.fm live API + social notify (YouTube live; Twitter/Spotify reserved).
 *
 * Env:
 *   LASTFM_API_KEY — https://www.last.fm/api/account/create
 *   YOUTUBE_API_KEY — YouTube Data API for upload polls
 *   FORTNITE_API_KEY — fortnite-api.com
 */

const { canRunCommand } = require('../../core/permissions');
const { infoEmbed, dangerEmbed, baseEmbed, BRAND } = require('../../core/ui-kit');

function lastfmSetupHelp() {
  return [
    'Get an API key: https://www.last.fm/api/account/create',
    'Set `LASTFM_API_KEY` on the bot host, then restart.',
    'Link your account: `,lastfm set <username>`',
  ].join('\n');
}

function createIntegrations(deps) {
  const { config, hub } = deps;
  const pollTimers = new Map();

  async function lastfmNowPlaying(username) {
    const key = process.env.LASTFM_API_KEY;
    if (!key) throw new Error('LASTFM_API_KEY not set');
    const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(username)}&api_key=${key}&format=json&limit=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Last.fm HTTP ${r.status}`);
    const data = await r.json();
    const track = data?.recenttracks?.track?.[0];
    if (!track) throw new Error('No recent tracks');
    const artist = track.artist?.['#text'] || track.artist || '?';
    const name = track.name || '?';
    const now = track['@attr']?.nowplaying === 'true';
    const album = track.album?.['#text'] || '';
    const image = track.image?.[2]?.['#text'] || track.image?.[1]?.['#text'] || '';
    return { artist, name, now, album, image, url: track.url };
  }

  async function fortniteShop() {
    const key = process.env.FORTNITE_API_KEY;
    if (!key) throw new Error('FORTNITE_API_KEY not set');
    const r = await fetch('https://fortnite-api.com/v2/shop/br', {
      headers: { Authorization: key },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`Fortnite HTTP ${r.status}`);
    const data = await r.json();
    const entries = data?.data?.entries || data?.data?.featured?.entries || [];
    return entries.slice(0, 8).map((e) => e.bundle?.name || e.items?.[0]?.name || 'item');
  }

  function register(registry) {
    registry.register({
      name: 'social',
      description: 'Social notification status / bind channel',
      module: 'integrations',
      permission: 'ManageGuild',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) {
          return ctx.reply('Need Manage Guild.');
        }
        const action = (ctx.args?.[0] || 'status').toLowerCase();
        if (action === 'bind') {
          const platform = (ctx.args?.[1] || '').toLowerCase();
          const handle = ctx.args?.[2];
          if (!platform || !handle) {
            return ctx.reply('Usage: `,social bind youtube <channelId>` (Twitter notify is not available yet)');
          }
          if (platform === 'twitter' || platform === 'x') {
            return ctx.reply(
              'Twitter/X notify is **not available yet** — bind accepted nowhere. Use `,social bind youtube <channelId>` for live polls.',
            );
          }
          if (platform === 'spotify') {
            return ctx.reply('Spotify notify is **not available yet**. Keys are reserved for a future release.');
          }
          if (platform !== 'youtube') {
            return ctx.reply('Supported bind today: **youtube**. Twitter/Spotify are not live.');
          }
          if (!process.env.YOUTUBE_API_KEY) {
            return ctx.reply('Set `YOUTUBE_API_KEY` before binding YouTube.');
          }
          config.update(ctx.guild.id, (c) => {
            c.integrations.notify = c.integrations.notify || [];
            c.integrations.notify.push({
              platform: 'youtube',
              handle,
              channelId: ctx.channel.id,
              lastId: null,
            });
            return c;
          });
          return ctx.reply(`Bound **youtube/${handle}** → ${ctx.channel}. Polling every ~15m.`);
        }
        if (action === 'list') {
          const list = config.get(ctx.guild.id).integrations.notify || [];
          return ctx.reply(list.length
            ? list.map((n, i) => `${i + 1}. ${n.platform}/${n.handle} → <#${n.channelId}>`).join('\n')
            : 'No binds. `,social bind youtube <channelId>`');
        }
        const live = {
          youtube: !!process.env.YOUTUBE_API_KEY,
          lastfm: !!process.env.LASTFM_API_KEY,
          fortnite: !!process.env.FORTNITE_API_KEY,
        };
        const lines = [
          `${live.youtube ? '✅' : '❌'} youtube — live poll when keyed + bound`,
          `${live.lastfm ? '✅' : '❌'} lastfm — \`,lastfm\` / WhoKnows`,
          `${live.fortnite ? '✅' : '❌'} fortnite — \`,fortnite\``,
          '⏳ twitter — not available yet (no poller)',
          '⏳ spotify — not available yet',
        ];
        return ctx.reply(`**Integrations**\n${lines.join('\n')}\n\`,social bind youtube <id>\` · \`,social list\``);
      },
    });

    async function lastfmTop(username, method = 'user.gettopartists') {
      const key = process.env.LASTFM_API_KEY;
      if (!key) throw new Error('LASTFM_API_KEY not set');
      const url = `https://ws.audioscrobbler.com/2.0/?method=${method}&user=${encodeURIComponent(username)}&api_key=${key}&format=json&limit=5&period=7day`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`Last.fm HTTP ${r.status}`);
      return r.json();
    }

    registry.register({
      name: 'lastfm',
      description: 'Last.fm now playing / tops / set username',
      aliases: ['fm', 'npfm'],
      module: 'integrations',
      options: [
        { name: 'action', description: 'set|np|remove|artists|tracks|recent', type: 3, required: false },
        { name: 'username', description: 'Last.fm username', type: 3, required: false },
      ],
      async run(ctx) {
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'np').toLowerCase();
        if (action === 'set') {
          const username = ctx.getString?.('username') || ctx.args?.[1];
          if (!username) return ctx.reply('Usage: ,lastfm set <username>');
          config.update(ctx.guild.id, (c) => {
            c.integrations.lastfm = c.integrations.lastfm || { users: {} };
            c.integrations.lastfm.users[ctx.user.id] = username;
            return c;
          });
          const keyed = !!process.env.LASTFM_API_KEY;
          return ctx.reply({
            embeds: [infoEmbed(
              'Last.fm linked',
              keyed
                ? `Linked as **${username}**. Try \`,lastfm\` / \`,npfm\`.`
                : `Linked as **${username}**.\n\n_API key still missing — scrobbles won’t load until you set it:_\n${lastfmSetupHelp()}`,
            )],
          });
        }
        if (action === 'remove') {
          config.update(ctx.guild.id, (c) => {
            if (c.integrations.lastfm?.users) delete c.integrations.lastfm.users[ctx.user.id];
            return c;
          });
          return ctx.reply('Last.fm unlinked.');
        }

        // collage is a deep-link only — no API key required
        const needsKey = !['collage', 'chart'].includes(action);
        if (needsKey && !process.env.LASTFM_API_KEY) {
          return ctx.reply({
            embeds: [dangerEmbed('Last.fm not configured', lastfmSetupHelp())],
          });
        }

        const stored = config.get(ctx.guild.id).integrations.lastfm?.users?.[ctx.user.id];
        const mentioned = ctx.message?.mentions?.users?.first?.();
        const otherStored = mentioned
          ? config.get(ctx.guild.id).integrations.lastfm?.users?.[mentioned.id]
          : null;
        const actionIsVerb = [
          'np', 'artists', 'tracks', 'recent', 'top', 'collage', 'chart',
          'plays', 'playcount', 'whoknows', 'wk',
        ].includes(action);
        const username = ctx.getString?.('username')
          || (actionIsVerb ? null : action)
          || otherStored
          || stored;
        if (!username) return ctx.reply('Set username first: `,lastfm set <name>`');

        try {
          if (action === 'artists' || action === 'top') {
            const data = await lastfmTop(username, 'user.gettopartists');
            const list = data?.topartists?.artist || [];
            if (!list.length) return ctx.reply('No top artists.');
            return ctx.reply({
              embeds: [baseEmbed({
                color: BRAND.primary,
                title: `Top artists (7d) · ${username}`,
                description: list.map((a, i) => `\`${i + 1}.\` **${a.name}** — ${a.playcount} plays`).join('\n'),
              })],
            });
          }
          if (action === 'tracks') {
            const data = await lastfmTop(username, 'user.gettoptracks');
            const list = data?.toptracks?.track || [];
            if (!list.length) return ctx.reply('No top tracks.');
            return ctx.reply({
              embeds: [baseEmbed({
                color: BRAND.primary,
                title: `Top tracks (7d) · ${username}`,
                description: list.map((t, i) => `\`${i + 1}.\` **${t.name}** — ${t.artist?.name || t.artist} (${t.playcount})`).join('\n'),
              })],
            });
          }
          if (action === 'recent') {
            const key = process.env.LASTFM_API_KEY;
            const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(username)}&api_key=${key}&format=json&limit=5`;
            const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
            const data = await r.json();
            const list = data?.recenttracks?.track || [];
            return ctx.reply({
              embeds: [baseEmbed({
                color: BRAND.info,
                title: `Recent · ${username}`,
                description: list.map((t) => `• **${t.name}** — ${t.artist?.['#text'] || t.artist}`).join('\n') || '_none_',
              })],
            });
          }
          if (action === 'collage' || action === 'chart') {
            // Third-party collage services (no API key required for link)
            const size = ctx.args?.[1] || '3x3';
            const period = ctx.args?.[2] || '7day';
            const link = `https://www.tapmusic.net/collage.php?user=${encodeURIComponent(username)}&type=${encodeURIComponent(period)}&size=${encodeURIComponent(size)}&caption=true`;
            return ctx.reply(`**Collage** for **${username}** (${size} · ${period})\n${link}`);
          }
          if (action === 'plays' || action === 'playcount') {
            const key = process.env.LASTFM_API_KEY;
            const url = `https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=${encodeURIComponent(username)}&api_key=${key}&format=json`;
            const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
            const data = await r.json();
            const u = data?.user;
            if (!u) return ctx.reply('User not found.');
            return ctx.reply({
              embeds: [baseEmbed({
                color: BRAND.primary,
                title: u.name,
                description: `**${u.playcount}** scrobbles · **${u.artist_count}** artists`,
                footerExtra: u.registered?.unixtime
                  ? `registered · ${new Date(Number(u.registered.unixtime) * 1000).toISOString().slice(0, 10)}`
                  : 'Last.fm',
              })],
            });
          }
          if (action === 'whoknows' || action === 'wk') {
            const artist = (ctx.args || [])
              .filter((a, i) => !(i === 0 && /^(whoknows|wk)$/i.test(a)))
              .join(' ')
              .trim();
            if (!artist) {
              return ctx.reply('Usage: `,lastfm whoknows <artist>` — guild leaderboard of linked Last.fm users');
            }
            const key = process.env.LASTFM_API_KEY;
            const linked = config.get(ctx.guild.id).integrations.lastfm?.users || {};
            const entries = Object.entries(linked);
            if (!entries.length) {
              return ctx.reply('No linked Last.fm users yet. `,lastfm set <username>`');
            }
            const rows = [];
            await Promise.all(entries.map(async ([discordId, lfmUser]) => {
              try {
                const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(artist)}&username=${encodeURIComponent(lfmUser)}&api_key=${key}&format=json`;
                const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
                const data = await r.json();
                const plays = Number(data?.artist?.stats?.userplaycount || 0);
                const name = data?.artist?.name || artist;
                if (plays > 0) {
                  rows.push({ discordId, lfmUser, plays, name });
                }
              } catch (_) { /* skip user */ }
            }));
            rows.sort((a, b) => b.plays - a.plays);
            if (!rows.length) {
              return ctx.reply(`Nobody in this server has plays of **${artist}** (among linked Last.fm users).`);
            }
            const label = rows[0].name || artist;
            const lines = rows.slice(0, 15).map((r, i) => {
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`${i + 1}.\``;
              return `${medal} <@${r.discordId}> (**${r.lfmUser}**) — **${r.plays}** plays`;
            });
            return ctx.reply({
              embeds: [baseEmbed({
                color: BRAND.primary,
                title: `WhoKnows — ${label}`,
                description: lines.join('\n'),
              })],
            });
          }
          const t = await lastfmNowPlaying(username);
          return ctx.reply({
            embeds: [baseEmbed({
              color: BRAND.primary,
              author: { name: t.now ? '♪ Now playing' : '♪ Last played' },
              title: t.name.slice(0, 200),
              url: t.url && String(t.url).startsWith('http') ? t.url : undefined,
              description: [
                `**${t.artist}**`,
                t.album ? `_${t.album}_` : null,
              ].filter(Boolean).join('\n'),
              thumbnail: t.image || undefined,
              footerExtra: username,
            })],
          });
        } catch (err) {
          const msg = String(err.message || err);
          if (/LASTFM_API_KEY/i.test(msg)) {
            return ctx.reply({
              embeds: [dangerEmbed('Last.fm not configured', lastfmSetupHelp())],
            });
          }
          return ctx.reply({
            embeds: [dangerEmbed('Last.fm error', msg)],
          });
        }
      },
    });

    registry.register({
      name: 'fortnite',
      description: 'Fortnite shop snapshot (requires FORTNITE_API_KEY)',
      module: 'integrations',
      async run(ctx) {
        try {
          const items = await fortniteShop();
          return ctx.reply(`**Fortnite shop (sample)**\n${items.map((i) => `• ${i}`).join('\n') || '(empty)'}`);
        } catch (err) {
          return ctx.reply(`Fortnite: ${err.message}`);
        }
      },
    });

    registry.register({
      name: 'youtube',
      description: 'Bind YouTube channel notifications (needs YOUTUBE_API_KEY)',
      module: 'integrations',
      permission: 'ManageGuild',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) {
          return ctx.reply('Need Manage Guild.');
        }
        const channelId = ctx.args?.[0];
        if (!channelId) return ctx.reply('Usage: ,youtube <channelId> — posts new uploads here');
        config.update(ctx.guild.id, (c) => {
          c.integrations.notify = c.integrations.notify || [];
          c.integrations.notify.push({
            platform: 'youtube',
            handle: channelId,
            channelId: ctx.channel.id,
            lastId: null,
          });
          return c;
        });
        return ctx.reply(`YouTube **${channelId}** → ${ctx.channel}`);
      },
    });
  }

  async function pollYoutube(entry, client) {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) return;
    const url = `https://www.googleapis.com/youtube/v3/search?key=${key}&channelId=${encodeURIComponent(entry.handle)}&part=snippet,id&order=date&maxResults=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return;
    const data = await r.json();
    const item = data.items?.[0];
    const videoId = item?.id?.videoId;
    if (!videoId || videoId === entry.lastId) return;
    entry.lastId = videoId;
    const ch = await client.channels.fetch(entry.channelId).catch(() => null);
    if (ch?.isTextBased?.()) {
      await ch.send(
        `📺 **New upload** from ${item.snippet?.channelTitle || entry.handle}\n**${item.snippet?.title}**\nhttps://youtu.be/${videoId}`,
      ).catch(() => {});
    }
  }

  function startWorkers(client) {
    const timer = setInterval(async () => {
      for (const guild of client.guilds.cache.values()) {
        const list = config.get(guild.id).integrations.notify || [];
        let dirty = false;
        for (const entry of list) {
          try {
            if (entry.platform === 'youtube') {
              const before = entry.lastId;
              await pollYoutube(entry, client);
              if (entry.lastId !== before) dirty = true;
            }
          } catch (err) {
            console.warn('[integrations] poll', err.message);
          }
        }
        if (dirty) {
          config.update(guild.id, (c) => {
            c.integrations.notify = list;
            return c;
          });
        }
      }
    }, 15 * 60 * 1000);
    timer.unref?.();
    pollTimers.set('main', timer);
  }

  return { register, startWorkers, lastfmNowPlaying };
}

module.exports = { createIntegrations };
