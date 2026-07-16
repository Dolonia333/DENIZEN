'use strict';

/**
 * Denizen account + Discord map linking commands.
 */
function createDenizenAccount(deps) {
  function publicUrl() {
    return String(
      process.env.DENIZEN_PUBLIC_URL
      || process.env.DENIZEN_URL
      || 'http://127.0.0.1:8888',
    ).replace(/\/$/, '');
  }

  function connectPath(mode = 'signup') {
    const params = new URLSearchParams({
      mode,
      return: '/discord-map/',
    });
    return `${publicUrl()}/api/visitor/auth/discord/connect?${params.toString()}`;
  }

  function register(registry) {
    registry.register({
      name: 'denizen',
      description: 'Discord Spaces map link or account signup/link',
      module: 'denizen',
      options: [
        {
          name: 'action',
          description: 'What to open',
          type: 3,
          required: false,
          choices: [
            { name: 'map — open the live pixel map', value: 'map' },
            { name: 'signup — create Denizen account', value: 'signup' },
            { name: 'link — link Discord to Denizen', value: 'link' },
          ],
        },
      ],
      async run(ctx) {
        const action = ctx.getString?.('action')
          || ctx.args?.[0]
          || 'map';
        const mode = action === 'link' ? 'link' : 'signup';
        const gid = ctx.guild?.id;
        const mapUrl = gid
          ? `${publicUrl()}/discord-map/?guildId=${encodeURIComponent(gid)}`
          : `${publicUrl()}/discord-map/`;
        const publicMap = gid
          ? `${publicUrl()}/discord-map/?guildId=${encodeURIComponent(gid)}&view=public`
          : `${publicUrl()}/discord-map/?view=public`;

        if (action === 'map' || action === 'open') {
          return ctx.reply({
            content: [
              '**Discord Spaces map**',
              mapUrl,
              '',
              '1. Open the link',
              '2. Join a **voice channel** — you appear in that room',
              '3. `/avatar` — customize look · **Boost** — golden headset',
              '',
              `Public share (read-only): ${publicMap}`,
            ].join('\n'),
            ephemeral: true,
          });
        }

        const url = connectPath(mode);
        const verb = mode === 'link' ? 'Link' : 'Create';
        return ctx.reply({
          content: [
            `**${verb} your Denizen profile**`,
            'Sign in with Discord so the map knows which avatar is **you** (green tag).',
            '',
            url,
            '',
            `_Only you can see this · expires in 15 minutes_`,
            `Map anytime: ${mapUrl}`,
          ].join('\n'),
          ephemeral: true,
        });
      },
    });

    registry.register({
      name: 'signup',
      description: 'Create a Denizen profile (shows as you on the map)',
      aliases: ['join', 'account'],
      module: 'denizen',
      async run(ctx) {
        const url = connectPath('signup');
        const mapUrl = `${publicUrl()}/discord-map/`;
        return ctx.reply({
          content: [
            '**Create your Denizen profile**',
            'Links Discord → pixel map identity.',
            url,
            '',
            `Then open the map: ${mapUrl}`,
          ].join('\n'),
          ephemeral: true,
        });
      },
    });

    registry.register({
      name: 'link',
      description: 'Link Discord to an existing Denizen login',
      module: 'denizen',
      async run(ctx) {
        const url = connectPath('link');
        return ctx.reply({
          content: [
            '**Link Discord to Denizen**',
            'Use while already signed into Denizen, or run `/signup` for a new profile.',
            url,
          ].join('\n'),
          ephemeral: true,
        });
      },
    });
  }

  return { register };
}

module.exports = { createDenizenAccount };
