'use strict';

const { canRunCommand } = require('../../core/permissions');

function createMisc(deps) {
  const { config } = deps;

  function register(registry) {
    registry.register({
      name: 'alias',
      description: 'Create a command alias',
      module: 'misc',
      permission: 'ManageGuild',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
        const short = ctx.args?.[0];
        const target = ctx.args?.[1];
        if (!short || !target) return ctx.reply('Usage: ,alias <shortcut> <command>');
        config.update(ctx.guild.id, (c) => {
          c.aliases[short.toLowerCase()] = target.toLowerCase();
          return c;
        });
        return ctx.reply(`Alias \`,${short}\` → \`,${target}\``);
      },
    });

    registry.register({
      name: 'tts',
      description: 'Text to speech file (basic)',
      module: 'misc',
      async run(ctx) {
        const text = ctx.getString?.('query') || ctx.args?.join(' ');
        if (!text) return ctx.reply('Provide text.');
        // Discord has no built-in TTS file API — use message TTS flag as fallback.
        return ctx.channel.send({ content: text.slice(0, 200), tts: true });
      },
    });

    registry.register({
      name: 'translate',
      description: 'Translate stub (LibreTranslate if URL set)',
      module: 'misc',
      async run(ctx) {
        const text = ctx.args?.join(' ');
        if (!text) return ctx.reply('Usage: ,translate <text>');
        const base = process.env.LIBRETRANSLATE_URL;
        if (!base) return ctx.reply(`(no LIBRETRANSLATE_URL) Passthrough: ${text}`);
        try {
          const res = await fetch(`${base.replace(/\/$/, '')}/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: text, source: 'auto', target: 'en', format: 'text' }),
          });
          const json = await res.json();
          return ctx.reply(json.translatedText || JSON.stringify(json).slice(0, 500));
        } catch (err) {
          return ctx.reply(`Translate failed: ${err.message}`);
        }
      },
    });

    registry.register({
      name: 'tictactoe',
      description: 'Challenge someone to tic-tac-toe',
      aliases: ['ttt'],
      module: 'misc',
      async run(ctx) {
        const foe = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
        if (!foe) return ctx.reply('Mention an opponent.');
        return ctx.reply(`Tic-tac-toe: ${ctx.user} vs ${foe} — board UI coming; challenge noted.`);
      },
    });

    registry.register({
      name: 'webhook',
      description: 'Send a message as a webhook name',
      module: 'misc',
      permission: 'ManageWebhooks',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageWebhooks' }).ok) return ctx.reply('Need Manage Webhooks.');
        const name = ctx.args?.[0] || 'Denizen';
        const content = ctx.args?.slice(1).join(' ') || 'Hello';
        const hooks = await ctx.channel.fetchWebhooks().catch(() => null);
        let hook = hooks?.find((h) => h.name === 'Denizen Relay');
        if (!hook) {
          hook = await ctx.channel.createWebhook({ name: 'Denizen Relay' }).catch(() => null);
        }
        if (!hook) return ctx.reply('Could not create webhook.');
        await hook.send({ content, username: name.slice(0, 80) });
        return ctx.reply('Sent.');
      },
    });
  }

  return { register };
}

module.exports = { createMisc };
