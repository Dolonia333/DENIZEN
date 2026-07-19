'use strict';

/**
 * Music module — Lavalink v4 (preferred) or optional @discordjs/voice + play-dl.
 *
 * @see https://github.com/lavalink-devs/Lavalink
 *
 * Env:
 *   LAVALINK_HOST / LAVALINK_PORT / LAVALINK_PASSWORD (defaults: 127.0.0.1:2333 / youshallnotpass)
 *   or LAVALINK_URL=http://host:2333
 *   LAVALINK_DISABLE=1 — skip auto-connect
 */

const { GatewayDispatchEvents } = require('discord.js');
const { LavalinkClient, filterPreset } = require('../../music/lavalink-client');
const { canRunCommand } = require('../../core/permissions');
const {
  musicNowPlayingEmbed,
  musicControlRows,
  successEmbed,
  dangerEmbed,
  infoEmbed,
  baseEmbed,
  BRAND,
} = require('../../core/ui-kit');

function createMusic(deps) {
  const { config, hub, client } = deps;
  /** guildId -> queue state */
  const queues = new Map();
  /** @type {LavalinkClient|null} */
  let lavalink = null;
  let voiceHooked = false;

  function q(guildId) {
    if (!queues.has(guildId)) {
      queues.set(guildId, {
        tracks: [],
        playing: null,
        textChannelId: null,
        volume: 80,
        loop: 'off',
        filter: 'none',
        voiceChannelId: null,
      });
    }
    return queues.get(guildId);
  }

  /**
   * DJ / control gate: Manage Server, configured DJ role, or same VC as the bot.
   * Play stays open so anyone can queue; destructive controls need this.
   */
  function canControlMusic(ctx) {
    if (!ctx?.guild) return false;
    if (canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return true;
    const djRoleId = config.get(ctx.guild.id).music?.djRoleId;
    if (djRoleId && ctx.member?.roles?.cache?.has?.(djRoleId)) return true;
    const queue = q(ctx.guild.id);
    const voice = ctx.member?.voice?.channel;
    if (!queue.voiceChannelId) return true; // nothing playing yet
    if (voice?.id === queue.voiceChannelId) return true;
    return false;
  }

  function denyDj(ctx) {
    return ctx.reply({
      content: 'Join the listening voice channel, or ask staff for the DJ role / Manage Server.',
      ephemeral: true,
    }).catch(() => ctx.reply('Join the listening VC (or need DJ role / Manage Server).'));
  }

  /** Auto-connect to local defaults unless explicitly disabled. */
  function hasLavalinkEnv() {
    if (/^(1|true|yes)$/i.test(String(process.env.LAVALINK_DISABLE || ''))) return false;
    return true;
  }

  function musicSetupHelp() {
    return [
      'Start Lavalink (required for reliable YouTube/search playback):',
      '```',
      'cd denizen/discord-bot',
      'docker compose -f docker-compose.lavalink.yml up -d',
      '```',
      'Defaults: `127.0.0.1:2333` · password `youshallnotpass`',
      'Optional: `LAVALINK_HOST` · `LAVALINK_PASSWORD` · `LAVALINK_URL`',
      'Disable auto-connect: `LAVALINK_DISABLE=1`',
      'Status: `,lavalink`',
    ].join('\n');
  }

  function ensureLavalink() {
    if (lavalink) return lavalink;
    if (!client?.user?.id) return null;
    if (!hasLavalinkEnv()) return null;

    lavalink = new LavalinkClient({ userId: client.user.id });
    lavalink.on((evt) => {
      if (evt.type === 'event') {
        const e = evt.payload;
        if (e?.type === 'TrackEndEvent' && e.guildId) {
          onTrackEnd(e.guildId, e.reason).catch(() => {});
        }
        if (e?.type === 'TrackExceptionEvent') {
          console.warn('[music] track exception', e.guildId, e.exception?.message || e);
        }
      }
    });
    try {
      lavalink.connect();
      console.log(`[music] Lavalink connecting → ${lavalink.httpBase}`);
    } catch (err) {
      console.warn('[music] lavalink connect failed:', err.message);
    }
    hookVoice(client);
    return lavalink;
  }

  function hookVoice(c) {
    if (voiceHooked || !c) return;
    voiceHooked = true;

    // Raw gateway for VOICE_SERVER_UPDATE + session id
    c.on('raw', (packet) => {
      try {
        if (!lavalink) return;
        if (packet.t === GatewayDispatchEvents.VoiceServerUpdate || packet.t === 'VOICE_SERVER_UPDATE') {
          const d = packet.d;
          if (!d?.guild_id) return;
          lavalink.updateVoice(d.guild_id, {
            token: d.token,
            endpoint: d.endpoint,
          }).catch((err) => console.warn('[lavalink] voice server update:', err.message));
        }
        if (packet.t === GatewayDispatchEvents.VoiceStateUpdate || packet.t === 'VOICE_STATE_UPDATE') {
          const d = packet.d;
          if (!d?.guild_id || d.user_id !== c.user?.id) return;
          lavalink.updateVoice(d.guild_id, {
            sessionId: d.session_id,
          }).catch((err) => console.warn('[lavalink] voice state update:', err.message));
        }
      } catch (err) {
        console.warn('[music] raw voice hook:', err.message);
      }
    });
  }

  /**
   * Resolve a playable track. Returns null when nothing can actually play
   * (never invents a silent title-only "queued" stub).
   */
  async function resolveTrack(query) {
    const ll = ensureLavalink();
    if (ll) {
      try {
        for (let i = 0; i < 30 && !ll.ready; i += 1) {
          await new Promise((r) => setTimeout(r, 100));
        }
        if (ll.ready) {
          const { tracks } = await ll.loadTracks(query);
          const track = tracks[0];
          if (track?.encoded) {
            return {
              title: track.info?.title || query,
              uri: track.info?.uri || query,
              author: track.info?.author || '',
              length: track.info?.length || 0,
              encoded: track.encoded,
              source: 'lavalink',
              raw: track,
            };
          }
        }
      } catch (err) {
        console.warn('[music] lavalink resolve failed:', err.message);
      }
    }

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
    } catch (_) { /* not installed / YouTube blocked */ }

    return null;
  }

  async function joinBotVoice(guild, voiceChannel) {
    // discord.js: bot joins VC via @discordjs/voice so Discord sends voice updates to Lavalink
    try {
      // eslint-disable-next-line import/no-extraneous-dependencies, global-require
      const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
      });
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      return { ok: true, mode: 'discordjs-voice' };
    } catch (err) {
      // Fallback: shard voice state update (works without @discordjs/voice in some setups)
      try {
        if (guild.members.me?.voice) {
          await guild.members.me.voice.setChannel(voiceChannel).catch(() => {});
        }
        return { ok: true, mode: 'voice-state', warn: err.message };
      } catch (e2) {
        return { ok: false, error: err.message || String(err) };
      }
    }
  }

  async function playOnLavalink(guild, voiceChannel, track) {
    const ll = ensureLavalink();
    if (!ll) return { ok: false, error: 'Lavalink not configured' };
    for (let i = 0; i < 30 && !ll.ready; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!ll.ready) return { ok: false, error: 'Lavalink session not ready — is the node running?' };

    const join = await joinBotVoice(guild, voiceChannel);
    if (!join.ok) return join;

    // Give Discord a moment to send VOICE_SERVER_UPDATE
    await new Promise((r) => setTimeout(r, 400));

    const queue = q(guild.id);
    const filters = filterPreset(queue.filter);
    try {
      await ll.play(guild.id, {
        encodedTrack: track.encoded,
        volume: queue.volume,
        filters: Object.keys(filters).length ? filters : undefined,
      });
      return { ok: true, mode: 'lavalink' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function tryPlayLocal(guild, voiceChannel, track) {
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
        onTrackEnd(guild.id, 'finished').catch(() => {});
      });
      return { ok: true, mode: 'voice' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function tryPlay(guild, voiceChannel, track) {
    q(guild.id).voiceChannelId = voiceChannel.id;
    if (track.source === 'lavalink' && track.encoded) {
      return playOnLavalink(guild, voiceChannel, track);
    }
    return tryPlayLocal(guild, voiceChannel, track);
  }

  async function onTrackEnd(guildId, reason) {
    const queue = q(guildId);
    if (reason === 'replaced') return;
    const finished = queue.playing;
    if (!finished) return;

    if (queue.loop === 'track') {
      // replay same
    } else if (queue.loop === 'queue' && finished) {
      queue.tracks.push(finished);
      queue.playing = null;
    } else {
      queue.playing = null;
    }

    if (queue.loop === 'track' && finished) {
      queue.playing = finished;
    } else if (queue.tracks.length) {
      queue.playing = queue.tracks.shift();
    } else {
      queue.playing = null;
      try { await lavalink?.stop(guildId); } catch (_) {}
      return;
    }

    const guild = client?.guilds?.cache?.get(guildId);
    const chId = queue.voiceChannelId;
    const voice = chId ? guild?.channels?.cache?.get(chId) : null;
    if (guild && voice) {
      await tryPlay(guild, voice, queue.playing);
      await refreshPanel(guild.id).catch(() => {});
      if (queue.textChannelId && !queue.panelMessageId) {
        const text = await guild.channels.fetch(queue.textChannelId).catch(() => null);
        if (text?.isTextBased?.()) {
          await postOrUpdatePanel(text, guild.id).catch(() => {});
        }
      }
    }
  }

  function playerPayload(guildId, guildName) {
    const queue = q(guildId);
    return {
      embeds: [musicNowPlayingEmbed({
        track: queue.playing,
        queue,
        guildName,
      })],
      components: musicControlRows(!queue.playing && !queue.tracks.length),
    };
  }

  async function postOrUpdatePanel(channel, guildId) {
    const queue = q(guildId);
    const payload = playerPayload(guildId, channel.guild?.name);
    if (queue.panelMessageId) {
      const msg = await channel.messages.fetch(queue.panelMessageId).catch(() => null);
      if (msg) {
        await msg.edit(payload).catch(() => {});
        return msg;
      }
    }
    const msg = await channel.send(payload);
    queue.panelMessageId = msg.id;
    queue.panelChannelId = channel.id;
    return msg;
  }

  async function refreshPanel(guildId) {
    const queue = q(guildId);
    if (!queue.panelChannelId || !queue.panelMessageId || !client) return;
    const ch = await client.channels.fetch(queue.panelChannelId).catch(() => null);
    if (!ch?.isTextBased?.()) return;
    const msg = await ch.messages.fetch(queue.panelMessageId).catch(() => null);
    if (!msg) return;
    await msg.edit(playerPayload(guildId, ch.guild?.name)).catch(() => {});
  }

  function register(registry) {
    // Connect Lavalink when client is ready
    if (client) {
      if (client.isReady?.() || client.readyAt) {
        ensureLavalink();
      } else {
        client.once?.('ready', () => ensureLavalink());
        client.once?.('clientReady', () => ensureLavalink());
      }
    }

    registry.register({
      name: 'play',
      description: 'Play / queue a track (YouTube URL or search via Lavalink)',
      aliases: ['p'],
      module: 'music',
      public: true,
      options: [{ name: 'query', description: 'Song URL or search', type: 3, required: true }],
      async run(ctx) {
        const query = ctx.getString?.('query') || ctx.args?.join(' ');
        if (!query) return ctx.reply('Provide a query or URL.');
        const voice = ctx.member?.voice?.channel;
        if (!voice) return ctx.reply('Join a voice channel first.');

        ensureLavalink();
        config.update(ctx.guild.id, (c) => { c.music.enabled = true; return c; });

        const track = await resolveTrack(query);
        if (!track) {
          const ll = ensureLavalink();
          const why = !hasLavalinkEnv()
            ? 'Lavalink auto-connect is disabled (`LAVALINK_DISABLE`).'
            : !ll
              ? 'Bot user not ready yet — try again in a moment.'
              : !ll.ready
                ? 'Lavalink node is not reachable / session not ready.'
                : 'No matching track from Lavalink or play-dl.';
          return ctx.reply({
            embeds: [dangerEmbed('Cannot play', `${why}\n\n${musicSetupHelp()}`)],
          });
        }

        const queue = q(ctx.guild.id);
        queue.textChannelId = ctx.channel.id;
        queue.voiceChannelId = voice.id;

        if (queue.playing) {
          queue.tracks.push(track);
          await refreshPanel(ctx.guild.id).catch(() => {});
          return ctx.reply({
            embeds: [successEmbed('Queued', `**${track.title}** is #${queue.tracks.length} in line.`)],
          });
        }

        queue.playing = track;
        const result = await tryPlay(ctx.guild, voice, track);
        if (!result.ok) {
          queue.playing = null;
          return ctx.reply({
            embeds: [dangerEmbed(
              'Playback failed',
              [
                `**${track.title}**`,
                `\`${result.error || 'unknown'}\``,
                '',
                musicSetupHelp(),
              ].join('\n'),
            )],
          });
        }
        await postOrUpdatePanel(ctx.channel, ctx.guild.id);
        return ctx.reply({
          embeds: [successEmbed('Now playing', `**${track.title}** · \`${result.mode}\`\n_Player panel updated below / above._`)],
        });
      },
    });

    registry.register({
      name: 'player',
      description: 'Post the interactive music player panel',
      aliases: ['panel', 'now'],
      module: 'music',
      public: true,
      async run(ctx) {
        const msg = await postOrUpdatePanel(ctx.channel, ctx.guild.id);
        return ctx.reply({
          embeds: [infoEmbed('Player panel', `Live controls posted ${msg?.url ? `[here](${msg.url})` : 'in this channel'}.\nPin it in #music for a Bleed-beating UI.`)],
          ephemeral: true,
        }).catch(() => ctx.reply('Player panel posted.'));
      },
    });

    registry.register({
      name: 'queue',
      description: 'Show music queue',
      aliases: ['q'],
      module: 'music',
      public: true,
      async run(ctx) {
        const queue = q(ctx.guild.id);
        if (!queue.playing && !queue.tracks.length) {
          return ctx.reply({ embeds: [infoEmbed('Queue empty', 'Use `/play` or `,play <song>`.')] });
        }
        const lines = [];
        if (queue.playing) lines.push(`**Now:** ${queue.playing.title}`);
        queue.tracks.slice(0, 15).forEach((t, i) => lines.push(`\`${i + 1}.\` ${t.title}`));
        if (queue.tracks.length > 15) lines.push(`_…+${queue.tracks.length - 15} more_`);
        return ctx.reply({
          embeds: [baseEmbed({
            color: BRAND.primary,
            title: 'Queue',
            description: lines.join('\n'),
            fields: [
              { name: 'Loop', value: `\`${queue.loop}\``, inline: true },
              { name: 'Filter', value: `\`${queue.filter}\``, inline: true },
              { name: 'Volume', value: `\`${queue.volume}%\``, inline: true },
            ],
          })],
          components: musicControlRows(false),
        });
      },
    });

    registry.register({
      name: 'skip',
      description: 'Skip current track',
      aliases: ['s'],
      module: 'music',
      public: true,
      async run(ctx) {
        if (!canControlMusic(ctx)) return denyDj(ctx);
        const queue = q(ctx.guild.id);
        if (!queue.playing) return ctx.reply('Nothing playing.');
        const skipped = queue.playing;
        try { await lavalink?.stop(ctx.guild.id); } catch (_) {}
        queue.playing = null;
        hub.emit('music.skip', { guildId: ctx.guild.id });
        const voice = ctx.member?.voice?.channel;
        if (queue.tracks.length && voice) {
          const next = queue.tracks.shift();
          queue.playing = next;
          await tryPlay(ctx.guild, voice, next);
          await refreshPanel(ctx.guild.id).catch(() => {});
          return ctx.reply({
            embeds: [successEmbed('Skipped', `**${skipped.title}** → **${next.title}**`)],
          });
        }
        await refreshPanel(ctx.guild.id).catch(() => {});
        return ctx.reply({ embeds: [infoEmbed('Skipped', `**${skipped.title}** · queue empty`)] });
      },
    });

    registry.register({
      name: 'stop',
      description: 'Stop playback and clear queue',
      module: 'music',
      public: true,
      async run(ctx) {
        if (!canControlMusic(ctx)) return denyDj(ctx);
        const queue = q(ctx.guild.id);
        queue.tracks = [];
        queue.playing = null;
        try { await lavalink?.stop(ctx.guild.id); } catch (_) {}
        try { await lavalink?.destroy(ctx.guild.id); } catch (_) {}
        hub.emit('music.stop', { guildId: ctx.guild.id });
        return ctx.reply('Stopped and cleared queue.');
      },
    });

    registry.register({
      name: 'pause',
      description: 'Pause / resume',
      module: 'music',
      public: true,
      async run(ctx) {
        if (!canControlMusic(ctx)) return denyDj(ctx);
        const queue = q(ctx.guild.id);
        queue.paused = !queue.paused;
        try {
          await lavalink?.pause(ctx.guild.id, queue.paused);
        } catch (_) {}
        hub.emit('music.pause', { guildId: ctx.guild.id, paused: queue.paused });
        return ctx.reply(queue.paused ? 'Paused.' : 'Resumed.');
      },
    });

    registry.register({
      name: 'volume',
      description: 'Set volume 1-100',
      module: 'music',
      public: true,
      options: [{ name: 'level', description: '1-100', type: 4, required: true }],
      async run(ctx) {
        if (!canControlMusic(ctx)) return denyDj(ctx);
        const n = ctx.getInteger?.('level') || Number(ctx.args?.[0]);
        if (!n || n < 1 || n > 100) return ctx.reply('Volume 1–100.');
        q(ctx.guild.id).volume = n;
        config.update(ctx.guild.id, (c) => { c.music.volume = n; return c; });
        try { await lavalink?.setVolume(ctx.guild.id, n); } catch (_) {}
        hub.emit('music.volume', { guildId: ctx.guild.id, volume: n });
        return ctx.reply(`Volume → **${n}%**`);
      },
    });

    registry.register({
      name: 'np',
      description: 'Now playing',
      aliases: ['nowplaying'],
      module: 'music',
      public: true,
      async run(ctx) {
        const track = q(ctx.guild.id).playing;
        if (!track) return ctx.reply('Nothing playing.');
        return ctx.reply(`🎵 **${track.title}**${track.author ? ` — ${track.author}` : ''}\n${track.uri || ''}`);
      },
    });

    registry.register({
      name: 'shuffle',
      description: 'Shuffle the queue',
      module: 'music',
      public: true,
      async run(ctx) {
        if (!canControlMusic(ctx)) return denyDj(ctx);
        const queue = q(ctx.guild.id);
        for (let i = queue.tracks.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [queue.tracks[i], queue.tracks[j]] = [queue.tracks[j], queue.tracks[i]];
        }
        return ctx.reply(`Shuffled **${queue.tracks.length}** tracks.`);
      },
    });

    registry.register({
      name: 'remove',
      description: 'Remove a track from the queue by index',
      module: 'music',
      public: true,
      options: [{ name: 'index', description: '1-based index', type: 4, required: true }],
      async run(ctx) {
        if (!canControlMusic(ctx)) return denyDj(ctx);
        const idx = (ctx.getInteger?.('index') || Number(ctx.args?.[0]) || 0) - 1;
        const queue = q(ctx.guild.id);
        if (idx < 0 || idx >= queue.tracks.length) return ctx.reply('Invalid index.');
        const [t] = queue.tracks.splice(idx, 1);
        return ctx.reply(`Removed **${t.title}**.`);
      },
    });

    registry.register({
      name: 'loop',
      description: 'Toggle loop mode: off|track|queue',
      module: 'music',
      public: true,
      async run(ctx) {
        if (!canControlMusic(ctx)) return denyDj(ctx);
        const mode = (ctx.args?.[0] || 'track').toLowerCase();
        if (!['off', 'track', 'queue'].includes(mode)) return ctx.reply('Usage: ,loop off|track|queue');
        q(ctx.guild.id).loop = mode;
        return ctx.reply(`Loop → **${mode}**.`);
      },
    });

    registry.register({
      name: 'filter',
      description: 'Set Lavalink filter preset',
      module: 'music',
      public: true,
      async run(ctx) {
        if (!canControlMusic(ctx)) return denyDj(ctx);
        const name = (ctx.args?.[0] || 'list').toLowerCase();
        const presets = ['none', 'bassboost', 'nightcore', 'vaporwave', 'soft', '8d'];
        if (name === 'list') return ctx.reply(`Filters: ${presets.join(', ')}`);
        if (!presets.includes(name)) return ctx.reply(`Unknown filter. Try: ${presets.join(', ')}`);
        const queue = q(ctx.guild.id);
        queue.filter = name;
        try {
          await lavalink?.setFilters(ctx.guild.id, filterPreset(name));
        } catch (_) {}
        return ctx.reply(`Filter → **${name}**.`);
      },
    });

    registry.register({
      name: 'clearqueue',
      description: 'Clear upcoming tracks (keep current)',
      aliases: ['cq'],
      module: 'music',
      public: true,
      async run(ctx) {
        if (!canControlMusic(ctx)) return denyDj(ctx);
        const queue = q(ctx.guild.id);
        const n = queue.tracks.length;
        queue.tracks = [];
        return ctx.reply(`Cleared **${n}** upcoming tracks.`);
      },
    });

    registry.register({
      name: 'djrole',
      description: 'Set or clear the music DJ role (Manage Server)',
      aliases: ['dj'],
      module: 'music',
      options: [
        { name: 'role', description: 'DJ role (omit to clear)', type: 8, required: false },
      ],
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) {
          return ctx.reply('Need **Manage Server** to set the DJ role.');
        }
        const role = ctx.getRole?.('role') || ctx.message?.mentions?.roles?.first?.();
        const clear = ['clear', 'off', 'none', 'remove'].includes(
          String(ctx.args?.[0] || '').toLowerCase(),
        );
        if (clear) {
          config.update(ctx.guild.id, (c) => { c.music.djRoleId = null; return c; });
          return ctx.reply('DJ role cleared — listeners in the bot VC (or Manage Server) can control.');
        }
        if (!role) {
          const cur = config.get(ctx.guild.id).music?.djRoleId;
          return ctx.reply(
            cur
              ? `DJ role is <@&${cur}>. Clear with \`,djrole clear\` or set with \`,djrole @role\`.`
              : 'No DJ role set. Usage: `,djrole @role`',
          );
        }
        config.update(ctx.guild.id, (c) => { c.music.djRoleId = role.id; return c; });
        return ctx.reply(`DJ role → ${role} — they can skip/stop/volume without joining VC.`);
      },
    });

    registry.register({
      name: 'lavalink',
      description: 'Lavalink node status / help',
      aliases: ['ll'],
      module: 'music',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) {
          return ctx.reply('Need **Manage Server** to view Lavalink status.');
        }
        if (!hasLavalinkEnv()) {
          return ctx.reply({
            embeds: [infoEmbed('Lavalink disabled', `\`LAVALINK_DISABLE\` is set.\n\n${musicSetupHelp()}`)],
          });
        }
        const ll = ensureLavalink();
        if (!ll) {
          return ctx.reply({
            embeds: [dangerEmbed('Lavalink', `Bot not ready yet.\n\n${musicSetupHelp()}`)],
          });
        }
        let stats = null;
        try { stats = await ll.stats(); } catch (err) {
          return ctx.reply({
            embeds: [dangerEmbed(
              'Lavalink unreachable',
              [
                `\`${err.message}\``,
                `ready=${ll.ready} · session=${ll.sessionId || '—'} · ${ll.httpBase}`,
                '',
                musicSetupHelp(),
              ].join('\n'),
            )],
          });
        }
        return ctx.reply({
          embeds: [successEmbed(
            'Lavalink',
            [
              `ready=**${ll.ready}** · session=\`${ll.sessionId || '—'}\``,
              `HTTP: ${ll.httpBase}`,
              stats
                ? `Players: **${stats.players}** · Playing: **${stats.playingPlayers}** · Uptime: ${Math.round((stats.uptime || 0) / 1000)}s`
                : '',
            ].filter(Boolean).join('\n'),
          )],
        });
      },
    });
  }

  async function onInteraction(interaction) {
    if (!interaction.guild) return false;
    const id = interaction.customId || '';
    if (!id.startsWith('denizen_music_')) return false;

    const queue = q(interaction.guild.id);
    const member = interaction.member;
    const voice = member?.voice?.channel;
    const botCh = queue.voiceChannelId;

    // Anyone in the same VC, DJ role, or Manage Server can control
    const djRoleId = config.get(interaction.guild.id).music?.djRoleId;
    const hasDj = djRoleId && member?.roles?.cache?.has?.(djRoleId);
    const allowed = !botCh
      || voice?.id === botCh
      || member?.permissions?.has?.('ManageGuild')
      || hasDj;
    if (!allowed) {
      await interaction.reply({
        embeds: [dangerEmbed('Denied', 'Join the listening voice channel (or need DJ role / Manage Server).')],
        ephemeral: true,
      }).catch(() => {});
      return true;
    }

    try {
      if (id === 'denizen_music_refresh') {
        await interaction.update(playerPayload(interaction.guild.id, interaction.guild.name));
        return true;
      }

      if (id === 'denizen_music_pause') {
        queue.paused = !queue.paused;
        try { await lavalink?.pause(interaction.guild.id, queue.paused); } catch (_) {}
        await interaction.update(playerPayload(interaction.guild.id, interaction.guild.name));
        return true;
      }

      if (id === 'denizen_music_skip') {
        const skipped = queue.playing;
        try { await lavalink?.stop(interaction.guild.id); } catch (_) {}
        queue.playing = null;
        if (queue.tracks.length && voice) {
          queue.playing = queue.tracks.shift();
          await tryPlay(interaction.guild, voice, queue.playing);
        }
        await interaction.update(playerPayload(interaction.guild.id, interaction.guild.name));
        if (skipped) {
          await interaction.followUp({
            embeds: [infoEmbed('Skipped', skipped.title)],
            ephemeral: true,
          }).catch(() => {});
        }
        return true;
      }

      if (id === 'denizen_music_stop') {
        queue.tracks = [];
        queue.playing = null;
        try { await lavalink?.stop(interaction.guild.id); } catch (_) {}
        try { await lavalink?.destroy(interaction.guild.id); } catch (_) {}
        await interaction.update(playerPayload(interaction.guild.id, interaction.guild.name));
        return true;
      }

      if (id === 'denizen_music_shuffle') {
        for (let i = queue.tracks.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [queue.tracks[i], queue.tracks[j]] = [queue.tracks[j], queue.tracks[i]];
        }
        await interaction.update(playerPayload(interaction.guild.id, interaction.guild.name));
        return true;
      }

      if (id === 'denizen_music_vol_up' || id === 'denizen_music_vol_down') {
        const delta = id.endsWith('up') ? 10 : -10;
        queue.volume = Math.max(1, Math.min(100, (queue.volume || 80) + delta));
        try { await lavalink?.setVolume(interaction.guild.id, queue.volume); } catch (_) {}
        await interaction.update(playerPayload(interaction.guild.id, interaction.guild.name));
        return true;
      }

      if (id === 'denizen_music_loop') {
        const order = ['off', 'track', 'queue'];
        const i = order.indexOf(queue.loop || 'off');
        queue.loop = order[(i + 1) % order.length];
        await interaction.update(playerPayload(interaction.guild.id, interaction.guild.name));
        return true;
      }

      if (interaction.isStringSelectMenu() && id === 'denizen_music_filter') {
        const name = interaction.values[0];
        queue.filter = name;
        try { await lavalink?.setFilters(interaction.guild.id, filterPreset(name)); } catch (_) {}
        await interaction.update(playerPayload(interaction.guild.id, interaction.guild.name));
        return true;
      }
    } catch (err) {
      await interaction.reply({
        embeds: [dangerEmbed('Player error', err.message)],
        ephemeral: true,
      }).catch(() => {});
    }
    return true;
  }

  return {
    register,
    queues,
    ensureLavalink,
    onInteraction,
    postOrUpdatePanel,
    refreshPanel,
    async clearOrphanPlayers() {
      const ll = ensureLavalink();
      if (!ll) return 0;
      // Wait briefly for session handshake
      for (let i = 0; i < 20 && !ll.sessionId; i += 1) {
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!ll.sessionId) return 0;
      try {
        const n = await ll.destroyAllPlayers();
        if (n > 0) console.log(`[music] cleared ${n} orphan Lavalink player(s)`);
        queues.clear();
        return n;
      } catch (err) {
        console.warn('[music] orphan clear failed:', err.message || err);
        return 0;
      }
    },
    async shutdown() {
      try {
        if (lavalink) {
          await lavalink.destroyAllPlayers().catch(() => {});
          lavalink.close();
        }
      } catch (_) {}
      queues.clear();
    },
  };
}

module.exports = { createMusic };

