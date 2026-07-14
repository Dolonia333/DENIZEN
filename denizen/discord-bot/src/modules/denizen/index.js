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
      description: 'Create or open your Denizen Discord map profile',
      module: 'denizen',
      options: [
        {
          name: 'action',
          description: 'signup, link, or map',
          type: 3,
          required: false,
          choices: [
            { name: 'signup — create Denizen account', value: 'signup' },
            { name: 'link — link Discord to Denizen', value: 'link' },
            { name: 'map — open the pixel map', value: 'map' },
          ],
        },
      ],
      async run(ctx) {
        const action = ctx.getString?.('action')
          || ctx.args?.[0]
          || 'signup';
        const mode = action === 'link' ? 'link' : 'signup';
        const mapUrl = `${publicUrl()}/discord-map/`;

        if (action === 'map') {
          return ctx.reply({
            content: `**Discord Spaces map**\n${mapUrl}\n\nJoin a voice channel after connecting — you'll appear on the map.`,
            ephemeral: true,
          });
        }

        const url = connectPath(mode);
        const verb = mode === 'link' ? 'Link' : 'Create';
        return ctx.reply({
          content: [
            `**${verb} your Denizen profile**`,
            'Sign in with Discord — same account on the pixel map.',
            '',
            url,
            '',
            '_Only you can see this link. It expires in 15 minutes._',
          ].join('\n'),
          ephemeral: true,
        });
      },
    });

    registry.register({
      name: 'signup',
      description: 'Create a Denizen account with your Discord profile',
      aliases: ['join', 'account'],
      module: 'denizen',
      async run(ctx) {
        const url = connectPath('signup');
        return ctx.reply({
          content: `**Denizen signup**\nTap to create your profile (matches your Discord on the map):\n${url}`,
          ephemeral: true,
        });
      },
    });

    registry.register({
      name: 'link',
      description: 'Link Discord to an existing Denizen profile',
      module: 'denizen',
      async run(ctx) {
        const url = connectPath('link');
        return ctx.reply({
          content: `**Link Discord**\nOpen while logged into Denizen, or use \`,signup\` to create a new profile:\n${url}`,
          ephemeral: true,
        });
      },
    });
  }

  return { register };
}

module.exports = { createDenizenAccount };
