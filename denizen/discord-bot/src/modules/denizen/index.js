'use strict';

/**
 * Denizen account + Discord map linking / team-code gate commands.
 */

const { canRunCommand } = require('../../core/permissions');

function createDenizenAccount(deps) {
  function publicUrl() {
    return String(
      process.env.DENIZEN_PUBLIC_URL
      || process.env.DENIZEN_URL
      || 'http://127.0.0.1:8888',
    ).replace(/\/$/, '');
  }

  function denizenApiBase() {
    return String(
      process.env.DENIZEN_URL
      || process.env.DENIZEN_PUBLIC_URL
      || 'http://127.0.0.1:8888',
    ).replace(/\/$/, '');
  }

  function bridgeSecret() {
    return String(process.env.DISCORD_BRIDGE_SECRET || '').trim();
  }

  function connectPath(mode = 'signup') {
    const params = new URLSearchParams({
      mode,
      return: '/discord-map/',
    });
    return `${publicUrl()}/api/visitor/auth/discord/connect?${params.toString()}`;
  }

  function mapUrl(guildId) {
    const base = publicUrl();
    const path = guildId
      ? `/discord-map/?guildId=${encodeURIComponent(guildId)}`
      : '/discord-map/';
    return `${base}${path}`;
  }

  function hasManageServer(ctx) {
    return canRunCommand(ctx, { permission: 'ManageGuild' }).ok;
  }

  async function apiPost(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const secret = bridgeSecret();
    if (secret) headers['x-denizen-secret'] = secret;
    const res = await fetch(`${denizenApiBase()}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, secret: secret || undefined }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  async function apiGet(path, { withSecret = false } = {}) {
    const headers = {};
    if (withSecret) {
      const secret = bridgeSecret();
      if (secret) headers['x-denizen-secret'] = secret;
    }
    const res = await fetch(`${denizenApiBase()}${path}`, {
      cache: 'no-store',
      headers,
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  async function mapCommand(ctx) {
    const guildId = ctx.guild?.id || null;
    const url = mapUrl(guildId);
    if (!guildId) {
      return ctx.reply({
        content: `**Discord Spaces map**\n${url}\n\nUse this inside a server after the owner runs \`,teamlink\`.`,
        ephemeral: true,
      });
    }
    try {
      const { data } = await apiGet(
        `/api/discord/map/access?guildId=${encodeURIComponent(guildId)}`,
      );
      if (data.setup_required || !data.linked) {
        return ctx.reply({
          content: [
            '**Map not set up yet**',
            'Ask a server admin to run `,teamlink <Denizen team code>`.',
            '',
            'Meanwhile you can `,signup` for a Denizen account.',
          ].join('\n'),
          ephemeral: true,
        });
      }
      return ctx.reply({
        content: [
          `**${data.org_display_name || 'Team'} Spaces map**`,
          url,
          '',
          '1. `,signup` (if you don’t have a Denizen account)',
          '2. Ask an admin for the **team code** (`,mapcode`)',
          '3. Enter the code on the map page, then join a voice channel',
        ].join('\n'),
        ephemeral: true,
      });
    } catch (_) {
      return ctx.reply({
        content: [
          '**Discord Spaces map**',
          url,
          '',
          'Ask an admin for the team code, then open the link and unlock the map.',
        ].join('\n'),
        ephemeral: true,
      });
    }
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

        if (action === 'map') {
          return mapCommand(ctx);
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
            '_To open a server map you still need that server’s team code from the owner._',
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
          content: [
            '**Denizen signup**',
            'Tap to create your profile (matches your Discord on the map):',
            url,
            '',
            'Then ask the server owner for the **team code** and enter it on the map page.',
          ].join('\n'),
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

    registry.register({
      name: 'map',
      description: 'Open this server’s Denizen Spaces map (needs team code)',
      aliases: ['spacesmap', 'openmap'],
      module: 'denizen',
      async run(ctx) {
        return mapCommand(ctx);
      },
    });

    registry.register({
      name: 'teamlink',
      description: 'Link this Discord server to a Denizen team (Manage Server)',
      module: 'denizen',
      async run(ctx) {
        if (!ctx.guild?.id) {
          return ctx.reply({ content: 'Use this in a Discord server.', ephemeral: true });
        }
        if (!hasManageServer(ctx)) {
          return ctx.reply({
            content: 'Need **Manage Server** to link this Discord to a Denizen team.',
            ephemeral: true,
          });
        }
        const code = String(ctx.args?.[0] || ctx.getString?.('code') || '').trim();
        if (!code) {
          return ctx.reply({
            content: [
              '**Link this server’s map to your Denizen team**',
              'Usage: `,teamlink <team code>`',
              'Get the code from Denizen team settings (or when you created the team).',
              'After linking, run `,mapcode` and share the code with members.',
            ].join('\n'),
            ephemeral: true,
          });
        }
        try {
          const { status, data } = await apiPost('/api/discord/map/teamlink', {
            guildId: ctx.guild.id,
            teamCode: code,
            discordUserId: ctx.user?.id || ctx.author?.id || null,
          });
          if (!data.ok) {
            const hint = data.error === 'invalid_team_code'
              ? 'That team code was not recognized.'
              : (data.message || data.error || `HTTP ${status}`);
            return ctx.reply({ content: `Could not link: ${hint}`, ephemeral: true });
          }
          return ctx.reply({
            content: [
              `**Linked** this Discord to **${data.org_display_name || data.org_slug || 'your team'}**.`,
              data.team_code ? `Team code (share with members): \`${data.team_code}\`` : null,
              `Map: ${mapUrl(ctx.guild.id)}`,
              'Members: `,signup` → open the map → enter the team code.',
            ].filter(Boolean).join('\n'),
            ephemeral: true,
          });
        } catch (err) {
          return ctx.reply({
            content: `Link failed — is Denizen online? (${err.message || err})`,
            ephemeral: true,
          });
        }
      },
    });

    registry.register({
      name: 'mapcode',
      description: 'Show this server’s team code + map URL (Manage Server)',
      aliases: ['teamcode'],
      module: 'denizen',
      async run(ctx) {
        if (!ctx.guild?.id) {
          return ctx.reply({ content: 'Use this in a Discord server.', ephemeral: true });
        }
        if (!hasManageServer(ctx)) {
          return ctx.reply({
            content: 'Need **Manage Server** to view the team code.',
            ephemeral: true,
          });
        }
        try {
          const { data } = await apiGet(
            `/api/discord/map/mapcode?guildId=${encodeURIComponent(ctx.guild.id)}`,
            { withSecret: true },
          );
          if (!data.ok) {
            if (data.error === 'setup_required' || data.code === 'SETUP_REQUIRED') {
              return ctx.reply({
                content: [
                  'This Discord is **not linked** to a Denizen team yet.',
                  'Run `,teamlink <team code>` with your Denizen org team code.',
                ].join('\n'),
                ephemeral: true,
              });
            }
            return ctx.reply({
              content: `Could not load map code (${data.error || 'error'})`,
              ephemeral: true,
            });
          }
          return ctx.reply({
            content: [
              `**${data.org_display_name || 'Team'}** — Spaces map`,
              data.team_code ? `Team code: \`${data.team_code}\`` : 'Team code unavailable — check Denizen team settings.',
              `Map: ${mapUrl(ctx.guild.id)}`,
              'Members enter this code on the map page after `,signup`.',
            ].join('\n'),
            ephemeral: true,
          });
        } catch (err) {
          return ctx.reply({
            content: `Could not load map code (${err.message || err})`,
            ephemeral: true,
          });
        }
      },
    });
  }

  return { register };
}

module.exports = { createDenizenAccount };
