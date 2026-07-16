'use strict';

/**
 * Platform integrations — Last.fm live + social notify stubs that activate with keys.
 */

const { canRunCommand } = require('../../core/permissions');

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
        const keys = {
          twitter: !!process.env.TWITTER_BEARER_TOKEN,
          youtube: !!process.env.YOUTUBE_API_KEY,
          fortnite: !!process.env.FORTNITE_API_KEY,
          lastfm: !!process.env.LASTFM_API_KEY,
          spotify: !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET),
        };
        if (action === 'bind') {
          const platform = (ctx.args?.[1] || '').toLowerCase();
          const handle = ctx.args?.[2];
          if (!platform || !handle) {
            return ctx.reply('Usage: ,social bind youtube|twitter <handle>  (posts to this channel)');
          }
          config.update(ctx.guild.id, (c) => {
            c.integrations.notify = c.integrations.notify || [];
            c.integrations.notify.push({
              platform,
              handle,
              channelId: ctx.channel.id,
              lastId: null,
            });
            return c;
          });
          return ctx.reply(`Bound **${platform}/${handle}** → ${ctx.channel}. Polling when API keys present.`);
        }
        if (action === 'list') {
          const list = config.get(ctx.guild.id).integrations.notify || [];
          return ctx.reply(list.length
            ? list.map((n, i) => `${i + 1}. ${n.platform}/${n.handle} → <#${n.channelId}>`).join('\n')
            : 'No binds. `,social bind youtube <channelId>`');
        }
        const lines = Object.entries(keys).map(([k, v]) => `${v ? '✅' : '❌'} ${k}`);
        return ctx.reply(`**Integration keys**\n${lines.join('\n')}\n\`,social bind|list\``);
      },
    });

    registry.register({
      name: 'lastfm',
      description: 'Last.fm now playing / set username',
      aliases: ['fm', 'npfm'],
      module: 'integrations',
      options: [
        { name: 'action', description: 'set|np|remove', type: 3, required: false },
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
          return ctx.reply(`Last.fm linked: **${username}**`);
        }
        if (action === 'remove') {
          config.update(ctx.guild.id, (c) => {
            if (c.integrations.lastfm?.users) delete c.integrations.lastfm.users[ctx.user.id];
            return c;
          });
          return ctx.reply('Last.fm unlinked.');
        }
        const stored = config.get(ctx.guild.id).integrations.lastfm?.users?.[ctx.user.id];
        const username = ctx.getString?.('username') || (action !== 'np' ? action : null) || stored;
        if (!username) return ctx.reply('Set username first: `,lastfm set <name>`');
        try {
          const t = await lastfmNowPlaying(username);
          const status = t.now ? '🎵 Now playing' : '🎧 Last played';
          return ctx.reply(
            `${status} for **${username}**\n**${t.name}** — ${t.artist}${t.album ? ` (${t.album})` : ''}${t.url ? `\n${t.url}` : ''}`,
          );
        } catch (err) {
          return ctx.reply(`Last.fm error: ${err.message}`);
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
