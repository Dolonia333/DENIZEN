'use strict';

/**
 * Music module — queue + optional Lavalink / @discordjs/voice playback.
 *
 * Playback backends (first available wins):
 * 1. LAVALINK_HOST + LAVALINK_PORT (+ LAVALINK_PASSWORD) REST/WS
 * 2. @discordjs/voice + play-dl if installed
 * 3. Queue-only mode with clear setup hints
 */

const { canRunCommand } = require('../../core/permissions');

function createMusic(deps) {
  const { config, hub } = deps;
  /** guildId -> { tracks, playing, textChannelId } */
  const queues = new Map();

  function q(guildId) {
    if (!queues.has(guildId)) {
      queues.set(guildId, { tracks: [], playing: null, textChannelId: null, volume: 80 });
    }
    return queues.get(guildId);
  }

  function hasLavalink() {
    return !!(process.env.LAVALINK_HOST || process.env.LAVALINK_URL);
  }

  async function resolveTrack(query) {
    // Prefer Lavalink loadtracks if configured
    if (hasLavalink()) {
      try {
        const host = process.env.LAVALINK_HOST || '127.0.0.1';
        const port = process.env.LAVALINK_PORT || '2333';
        const pass = process.env.LAVALINK_PASSWORD || 'youshallnotpass';
        const base = process.env.LAVALINK_URL || `http://${host}:${port}`;
        const url = `${base}/v4/loadtracks?identifier=${encodeURIComponent(query)}`;
        const r = await fetch(url, {
          headers: { Authorization: pass },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const data = await r.json();
          const track = data?.data?.[0] || data?.tracks?.[0];
          if (track) {
            return {
              title: track.info?.title || track.title || query,
              uri: track.info?.uri || track.uri || query,
              author: track.info?.author || '',
              length: track.info?.length || 0,
              encoded: track.encoded || track.track,
              source: 'lavalink',
            };
          }
        }
      } catch (err) {
        console.warn('[music] lavalink resolve failed:', err.message);
      }
    }

    // play-dl optional
    try {
      // eslint-disable-next-line import/no-extraneous-dependencies, global-require
      const play = require('play-dl');
      if (play.yt_validate(query) === 'video' || !query.startsWith('http')) {
        const searched = query.startsWith('http')
          ? [{ url: query }]
          : await play.search(query, { limit: 1 });
        const first = searched[0];
        if (first) {
          const info = await play.video_info(first.url || query).catch(() => null);
          return {
            title: info?.video_details?.title || first.title || query,
            uri: first.url || query,
            author: info?.video_details?.channel?.name || '',
            length: Number(info?.video_details?.durationInSec || 0) * 1000,
            source: 'play-dl',
          };
        }
      }
    } catch (_) { /* not installed */ }

    return {
      title: query.slice(0, 120),
      uri: query,
      author: '',
      length: 0,
      source: 'queued',
    };
  }

  async function tryPlay(guild, voiceChannel, track) {
    // Lavalink player session is complex — we signal hub for external worker
    if (track.source === 'lavalink' && track.encoded) {
      hub.emit('music.play', {
        guildId: guild.id,
        channelId: voiceChannel.id,
        track,
      });
      return { ok: true, mode: 'lavalink' };
    }

    try {
      // eslint-disable-next-line import/no-extraneous-dependencies, global-require
      const {
        joinVoiceChannel,
        createAudioPlayer,
        createAudioResource,
        AudioPlayerStatus,
        entersState,
        VoiceConnectionStatus,
      } = require('@discordjs/voice');
      // eslint-disable-next-line import/no-extraneous-dependencies, global-require
      const play = require('play-dl');

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
      });
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      const stream = await play.stream(track.uri);
      const resource = createAudioResource(stream.stream, { inputType: stream.type });
      const player = createAudioPlayer();
      connection.subscribe(player);
      player.play(resource);
      player.on(AudioPlayerStatus.Idle, () => {
        const queue = q(guild.id);
        queue.playing = null;
        if (queue.tracks.length) {
          const next = queue.tracks.shift();
          queue.playing = next;
          tryPlay(guild, voiceChannel, next).catch(() => {});
        }
      });
      return { ok: true, mode: 'voice' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function register(registry) {
    registry.register({
      name: 'play',
      description: 'Play / queue a track (YouTube URL or search)',
      aliases: ['p'],
      module: 'music',
      options: [{ name: 'query', description: 'Song URL or search', type: 3, required: true }],
      async run(ctx) {
        const query = ctx.getString?.('query') || ctx.args?.join(' ');
        if (!query) return ctx.reply('Provide a query or URL.');
        const voice = ctx.member?.voice?.channel;
        if (!voice) return ctx.reply('Join a voice channel first.');

        config.update(ctx.guild.id, (c) => { c.music.enabled = true; return c; });
        const track = await resolveTrack(query);
        const queue = q(ctx.guild.id);
        queue.textChannelId = ctx.channel.id;

        if (queue.playing) {
          queue.tracks.push(track);
          return ctx.reply(`➕ Queued **${track.title}** (#${queue.tracks.length})`);
        }

        queue.playing = track;
        const result = await tryPlay(ctx.guild, voice, track);
        if (!result.ok) {
          queue.playing = null;
          return ctx.reply(
            [
              `Queued **${track.title}** (metadata only).`,
              `Playback backend missing: \`${result.error || 'none'}\``,
              'Enable one of:',
              '• `LAVALINK_HOST` + `LAVALINK_PASSWORD`',
              '• `npm i @discordjs/voice play-dl` in discord-bot/',
            ].join('\n'),
          );
        }
        return ctx.reply(`▶️ Playing **${track.title}** (${result.mode})`);
      },
    });

    registry.register({
      name: 'queue',
      description: 'Show music queue',
      aliases: ['q'],
      module: 'music',
      async run(ctx) {
        const queue = q(ctx.guild.id);
        if (!queue.playing && !queue.tracks.length) return ctx.reply('Queue empty.');
        const lines = [];
        if (queue.playing) lines.push(`**Now:** ${queue.playing.title}`);
        queue.tracks.slice(0, 15).forEach((t, i) => lines.push(`${i + 1}. ${t.title}`));
        if (queue.tracks.length > 15) lines.push(`…+${queue.tracks.length - 15} more`);
        return ctx.reply(lines.join('\n'));
      },
    });

    registry.register({
      name: 'skip',
      description: 'Skip current track',
      aliases: ['s'],
      module: 'music',
      async run(ctx) {
        const queue = q(ctx.guild.id);
        if (!queue.playing) return ctx.reply('Nothing playing.');
        const skipped = queue.playing;
        queue.playing = null;
        hub.emit('music.skip', { guildId: ctx.guild.id });
        const voice = ctx.member?.voice?.channel;
        if (queue.tracks.length && voice) {
          const next = queue.tracks.shift();
          queue.playing = next;
          await tryPlay(ctx.guild, voice, next);
          return ctx.reply(`Skipped **${skipped.title}** → **${next.title}**`);
        }
        return ctx.reply(`Skipped **${skipped.title}**. Queue empty.`);
      },
    });

    registry.register({
      name: 'stop',
      description: 'Stop playback and clear queue',
      module: 'music',
      async run(ctx) {
        const queue = q(ctx.guild.id);
        queue.tracks = [];
        queue.playing = null;
        hub.emit('music.stop', { guildId: ctx.guild.id });
        return ctx.reply('Stopped and cleared queue.');
      },
    });

    registry.register({
      name: 'pause',
      description: 'Pause / resume (backend dependent)',
      module: 'music',
      async run(ctx) {
        hub.emit('music.pause', { guildId: ctx.guild.id });
        return ctx.reply('Pause toggled (if backend supports it).');
      },
    });

    registry.register({
      name: 'volume',
      description: 'Set volume 1-100',
      module: 'music',
      options: [{ name: 'level', description: '1-100', type: 4, required: true }],
      async run(ctx) {
        const n = ctx.getInteger?.('level') || Number(ctx.args?.[0]);
        if (!n || n < 1 || n > 100) return ctx.reply('Volume 1–100.');
        q(ctx.guild.id).volume = n;
        config.update(ctx.guild.id, (c) => { c.music.volume = n; return c; });
        hub.emit('music.volume', { guildId: ctx.guild.id, volume: n });
        return ctx.reply(`Volume → **${n}%**`);
      },
    });

    registry.register({
      name: 'np',
      description: 'Now playing',
      aliases: ['nowplaying'],
      module: 'music',
      async run(ctx) {
        const track = q(ctx.guild.id).playing;
        if (!track) return ctx.reply('Nothing playing.');
        return ctx.reply(`🎵 **${track.title}**${track.author ? ` — ${track.author}` : ''}\n${track.uri || ''}`);
      },
    });
  }

  return { register, queues };
}

module.exports = { createMusic };
