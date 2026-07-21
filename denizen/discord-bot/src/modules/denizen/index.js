'use strict';

/**
 * Denizen account + Discord map linking / team-code gate commands.
 */

const { canRunCommand } = require('../../core/permissions');

function createDenizenAccount(deps) {
  const config = deps.config;

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
            `**Discord Spaces map**`,
            url,
            '',
            'Map is open. Join a voice channel to appear.',
            'Admins can lock it to a Denizen team with `,teamlink <team code>`.',
            'Create an account anytime: `,signup`',
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
          const codeBlock = [
            `**${data.org_display_name || 'Team'}** — Spaces map`,
            data.team_code ? `Team code: \`${data.team_code}\`` : 'Team code unavailable — check Denizen team settings.',
            `Map: ${mapUrl(ctx.guild.id)}`,
            'Members enter this code on the map page after `,signup`.',
          ].join('\n');
          // Ephemeral replies are easy to lose (esp. on mobile, or once you
          // switch to a browser to paste the code) — DM it too so there's a
          // copy you can scroll back to.
          let dmSent = false;
          if (ctx.user?.send) {
            try {
              await ctx.user.send(codeBlock);
              dmSent = true;
            } catch (_) { /* DMs closed — fall back to the in-channel reply below */ }
          }
          return ctx.reply({
            content: dmSent
              ? `${codeBlock}\n\n(Also sent to your DMs, so you have it even if this message disappears.)`
              : codeBlock,
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

    const THEME_CHOICES = [
      'plain', 'cafe', 'gamer', 'hospital', 'museum', 'police', 'fire', 'halloween',
      'voice', 'winterzone', 'digzone',
    ];
    const KIT_CHOICES = [
      'library', 'office', 'cafe', 'kitchen', 'reception', 'lounge', 'cozy', 'gallery',
    ];
    const COLOR_CHOICES = [
      'blue', 'teal', 'green', 'mint', 'orange', 'red', 'pink', 'purple', 'lavender', 'yellow', 'brown', 'slate',
    ];

    function resolveChannel(ctx, ref) {
      const guild = ctx.guild;
      if (!guild || !ref) return null;
      const raw = String(ref).trim();
      const mention = raw.match(/^<#(\d+)>$/);
      const id = mention ? mention[1] : (/^\d{16,22}$/.test(raw) ? raw : null);
      if (id) {
        return guild.channels?.cache?.get(id)
          || guild.channels?.cache?.find((c) => String(c.id) === id)
          || null;
      }
      const name = raw.replace(/^#/, '').toLowerCase();
      const list = guild.channels?.cache;
      if (!list) return null;
      return list.find((c) => String(c.name || '').toLowerCase() === name)
        || list.find((c) => String(c.name || '').toLowerCase().includes(name))
        || null;
    }

    function formatOverride(ov) {
      if (!ov || !Object.keys(ov).length) return '(defaults)';
      return Object.entries(ov).map(([k, v]) => `${k}=${v}`).join(', ');
    }

    registry.register({
      name: 'room',
      description: 'Customize a Spaces map room (theme, color, furniture, name)',
      aliases: ['maproom', 'spacesroom'],
      module: 'denizen',
      async run(ctx) {
        if (!ctx.guild?.id) {
          return ctx.reply({ content: 'Use this in a Discord server.', ephemeral: true });
        }
        if (!hasManageServer(ctx)) {
          return ctx.reply({
            content: 'Need **Manage Server** to customize map rooms.',
            ephemeral: true,
          });
        }
        if (!config?.update) {
          return ctx.reply({ content: 'Config store unavailable.', ephemeral: true });
        }

        const args = [...(ctx.args || [])];
        const action = String(args[0] || '').toLowerCase();
        const help = [
          '**Customize Spaces map rooms** (Manage Server)',
          '`,room show #channel`',
          '`,room theme #channel <plain|cafe|hospital|museum|police|fire|gamer|halloween|voice>`',
          '`,room color #channel <blue|teal|green|mint|orange|red|pink|purple|lavender|yellow|brown|slate>`',
          '`,room kit #channel <library|office|cafe|kitchen|reception|lounge|cozy|gallery>`',
          '`,room name #channel Custom plaque text`',
          '`,room title #channel Building Title`  (category building name)',
          '`,room clear #channel`',
          'Hard-refresh the map after changes.',
        ].join('\n');

        if (!action || action === 'help') {
          return ctx.reply({ content: help, ephemeral: true });
        }

        // `,room #channel` → show
        let field = action;
        let chRef = args[1];
        let rest = args.slice(2);
        if (action.startsWith('<#') || action.startsWith('#') || /^\d{16,22}$/.test(action)) {
          field = 'show';
          chRef = action;
          rest = args.slice(1);
        }

        const ch = resolveChannel(ctx, chRef);
        if (!ch) {
          return ctx.reply({
            content: `Channel not found. Usage:\n${help}`,
            ephemeral: true,
          });
        }

        const channelId = String(ch.id);
        const categoryId = ch.parentId ? String(ch.parentId) : null;
        const gid = ctx.guild.id;

        if (field === 'show') {
          const sp = config.get(gid)?.spaces || {};
          const roomOv = sp.rooms?.[channelId] || {};
          const catOv = categoryId ? (sp.categories?.[categoryId] || {}) : {};
          return ctx.reply({
            content: [
              `**Map room** #${ch.name}`,
              `Room overrides: ${formatOverride(roomOv)}`,
              categoryId ? `Category overrides: ${formatOverride(catOv)}` : 'No category',
              `Map: ${mapUrl(gid)}`,
            ].join('\n'),
            ephemeral: true,
          });
        }

        if (field === 'clear') {
          config.update(gid, (c) => {
            c.spaces = c.spaces || {};
            c.spaces.rooms = c.spaces.rooms || {};
            c.spaces.categories = c.spaces.categories || {};
            delete c.spaces.rooms[channelId];
            if (categoryId && c.spaces.categories[categoryId]) {
              // Keep category title/theme unless `--all`
              if (String(rest[0] || '').toLowerCase() === 'all') {
                delete c.spaces.categories[categoryId];
              }
            }
            return c;
          });
          return ctx.reply({
            content: `Cleared room overrides for #${ch.name}. Hard-refresh the map.`,
            ephemeral: true,
          });
        }

        const value = rest.join(' ').trim();
        if (!value && field !== 'clear') {
          return ctx.reply({ content: `Missing value.\n${help}`, ephemeral: true });
        }

        if (field === 'theme') {
          const theme = value.toLowerCase().replace(/\s+/g, '');
          if (!THEME_CHOICES.includes(theme)) {
            return ctx.reply({
              content: `Unknown theme \`${theme}\`.\nChoose: ${THEME_CHOICES.join(', ')}`,
              ephemeral: true,
            });
          }
          config.update(gid, (c) => {
            c.spaces = c.spaces || {};
            c.spaces.rooms = c.spaces.rooms || {};
            c.spaces.categories = c.spaces.categories || {};
            c.spaces.rooms[channelId] = { ...(c.spaces.rooms[channelId] || {}), theme };
            if (categoryId) {
              c.spaces.categories[categoryId] = {
                ...(c.spaces.categories[categoryId] || {}),
                theme,
              };
            }
            return c;
          });
          return ctx.reply({
            content: [
              `Set **theme=${theme}** for #${ch.name}${categoryId ? ' (and its category building)' : ''}.`,
              'Hard-refresh the Spaces map to see it.',
            ].join('\n'),
            ephemeral: true,
          });
        }

        if (field === 'color') {
          const color = value.toLowerCase().replace(/^#/, '');
          if (!COLOR_CHOICES.includes(color) && !/^[0-9a-f]{6}$/i.test(color)) {
            return ctx.reply({
              content: `Unknown color. Choose: ${COLOR_CHOICES.join(', ')} — or a hex like \`c8f0e0\`.`,
              ephemeral: true,
            });
          }
          config.update(gid, (c) => {
            c.spaces = c.spaces || {};
            c.spaces.rooms = c.spaces.rooms || {};
            c.spaces.rooms[channelId] = { ...(c.spaces.rooms[channelId] || {}), color };
            return c;
          });
          return ctx.reply({
            content: `Set **color=${color}** for #${ch.name}. Hard-refresh the map.`,
            ephemeral: true,
          });
        }

        if (field === 'kit') {
          const kit = value.toLowerCase().replace(/\s+/g, '');
          if (!KIT_CHOICES.includes(kit)) {
            return ctx.reply({
              content: `Unknown kit \`${kit}\`.\nChoose: ${KIT_CHOICES.join(', ')}`,
              ephemeral: true,
            });
          }
          config.update(gid, (c) => {
            c.spaces = c.spaces || {};
            c.spaces.rooms = c.spaces.rooms || {};
            c.spaces.rooms[channelId] = { ...(c.spaces.rooms[channelId] || {}), kit };
            return c;
          });
          return ctx.reply({
            content: `Set **kit=${kit}** for #${ch.name}. Hard-refresh the map.`,
            ephemeral: true,
          });
        }

        if (field === 'name' || field === 'label') {
          const label = value.slice(0, 40);
          config.update(gid, (c) => {
            c.spaces = c.spaces || {};
            c.spaces.rooms = c.spaces.rooms || {};
            c.spaces.rooms[channelId] = { ...(c.spaces.rooms[channelId] || {}), label };
            return c;
          });
          return ctx.reply({
            content: `Set plaque **name="${label}"** for #${ch.name}. Hard-refresh the map.`,
            ephemeral: true,
          });
        }

        if (field === 'title' || field === 'sign') {
          if (!categoryId) {
            return ctx.reply({
              content: `#${ch.name} has no Discord category — put it under a category to set a building title.`,
              ephemeral: true,
            });
          }
          const title = value.slice(0, 40);
          config.update(gid, (c) => {
            c.spaces = c.spaces || {};
            c.spaces.categories = c.spaces.categories || {};
            c.spaces.categories[categoryId] = {
              ...(c.spaces.categories[categoryId] || {}),
              title,
            };
            return c;
          });
          return ctx.reply({
            content: `Set building **title="${title}"** for #${ch.name}'s category. Hard-refresh the map.`,
            ephemeral: true,
          });
        }

        return ctx.reply({ content: help, ephemeral: true });
      },
    });
  }

  return { register };
}

module.exports = { createDenizenAccount };
