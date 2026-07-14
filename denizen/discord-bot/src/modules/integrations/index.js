'use strict';

/**
 * Social / platform integrations — stubs that activate when API keys exist.
 */

function createIntegrations(deps) {
  const { config, hub } = deps;

  function register(registry) {
    registry.register({
      name: 'social',
      description: 'Social notification status / stub bind',
      module: 'integrations',
      permission: 'ManageGuild',
      async run(ctx) {
        const keys = {
          twitter: !!process.env.TWITTER_BEARER_TOKEN,
          youtube: !!process.env.YOUTUBE_API_KEY,
          fortnite: !!process.env.FORTNITE_API_KEY,
          lastfm: !!process.env.LASTFM_API_KEY,
          spotify: !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET),
        };
        const lines = Object.entries(keys).map(([k, v]) => `• ${k}: ${v ? 'key present' : 'missing'}`);
        return ctx.reply(`Integration keys:\n${lines.join('\n')}\nUse env vars to enable feed workers.`);
      },
    });

    registry.register({
      name: 'fortnite',
      description: 'Fortnite shop (requires FORTNITE_API_KEY)',
      module: 'integrations',
      async run(ctx) {
        if (!process.env.FORTNITE_API_KEY) {
          return ctx.reply('Set `FORTNITE_API_KEY` to enable shop rotation.');
        }
        hub.emit('integrations.fortnite', { guildId: ctx.guild.id });
        return ctx.reply('Fortnite shop fetch not fully wired — key detected, worker stub acknowledged.');
      },
    });

    registry.register({
      name: 'lastfm',
      description: 'Last.fm now-playing stub',
      module: 'integrations',
      async run(ctx) {
        if (!process.env.LASTFM_API_KEY) return ctx.reply('Set `LASTFM_API_KEY`.');
        const user = ctx.args?.[0] || ctx.user.username;
        return ctx.reply(`Last.fm lookup for **${user}** — bind accounts in a future release.`);
      },
    });
  }

  return { register };
}

module.exports = { createIntegrations };
