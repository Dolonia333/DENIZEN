'use strict';

/**
 * Music module — queue stub. Full Lavalink/discord-player can plug in later.
 * Degrades gracefully without external deps.
 */

function createMusic(deps) {
  const { config, hub } = deps;
  const queues = new Map(); // guildId -> { tracks: [], playing: null }

  function register(registry) {
    registry.register({
      name: 'play',
      description: 'Queue a track (requires music backend)',
      module: 'music',
      options: [{ name: 'query', description: 'Song URL or search', type: 3, required: true }],
      async run(ctx) {
        const q = ctx.getString?.('query') || ctx.args?.join(' ');
        if (!q) return ctx.reply('Provide a query.');
        const voice = ctx.member?.voice?.channel;
        if (!voice) return ctx.reply('Join a voice channel first.');
        const cfg = config.get(ctx.guild.id).music;
        if (!cfg.enabled) {
          config.update(ctx.guild.id, (c) => { c.music.enabled = true; return c; });
        }
        if (!process.env.LAVALINK_URL && !process.env.DISCORD_MUSIC_ENABLED) {
          return ctx.reply(
            `Queued **${q}** locally (no Lavalink — set \`LAVALINK_URL\` or \`DISCORD_MUSIC_ENABLED=1\` with a player backend for audio).`,
          );
        }
        const queue = queues.get(ctx.guild.id) || { tracks: [], playing: null };
        queue.tracks.push({ query: q, by: ctx.user.id });
        queues.set(ctx.guild.id, queue);
        hub.emit('music.queue', { guildId: ctx.guild.id, query: q });
        return ctx.reply(`Added to queue: **${q}** (position ${queue.tracks.length}).`);
      },
    });

    registry.register({
      name: 'queue',
      description: 'Show music queue',
      module: 'music',
      async run(ctx) {
        const queue = queues.get(ctx.guild.id);
        if (!queue?.tracks?.length) return ctx.reply('Queue empty.');
        return ctx.reply(queue.tracks.map((t, i) => `${i + 1}. ${t.query}`).join('\n').slice(0, 1900));
      },
    });

    registry.register({
      name: 'skip',
      description: 'Skip current track',
      module: 'music',
      async run(ctx) {
        const queue = queues.get(ctx.guild.id);
        if (!queue?.tracks?.length) return ctx.reply('Nothing to skip.');
        const skipped = queue.tracks.shift();
        return ctx.reply(`Skipped **${skipped.query}**.`);
      },
    });
  }

  return { register, queues };
}

module.exports = { createMusic };
