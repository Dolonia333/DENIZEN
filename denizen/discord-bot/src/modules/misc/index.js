'use strict';

const { canRunCommand } = require('../../core/permissions');

/**
 * Fun + utility — aliases, TTS, translate, games, image helpers, web search stub.
 */
function createMisc(deps) {
  const { config } = deps;
  const blacktea = new Map(); // channelId -> { word, players, scores }

  function register(registry) {
    registry.register({
      name: 'alias',
      description: 'Create a command alias',
      module: 'misc',
      permission: 'ManageGuild',
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return ctx.reply('Need Manage Guild.');
        const action = (ctx.args?.[0] || '').toLowerCase();
        if (action === 'list') {
          const map = config.get(ctx.guild.id).aliases || {};
          const lines = Object.entries(map).map(([k, v]) => `\`,${k}\` → \`,${v}\``);
          return ctx.reply(lines.length ? lines.join('\n') : 'No aliases.');
        }
        if (action === 'remove') {
          const short = ctx.args?.[1];
          if (!short) return ctx.reply('Usage: ,alias remove <shortcut>');
          config.update(ctx.guild.id, (c) => {
            delete c.aliases[short.toLowerCase()];
            return c;
          });
          return ctx.reply(`Removed alias \`,${short}\`.`);
        }
        const short = ctx.args?.[0];
        const target = ctx.args?.[1];
        if (!short || !target) return ctx.reply('Usage: ,alias <shortcut> <command> | list | remove');
        config.update(ctx.guild.id, (c) => {
          c.aliases[short.toLowerCase()] = target.toLowerCase();
          return c;
        });
        return ctx.reply(`Alias \`,${short}\` → \`,${target}\``);
      },
    });

    registry.register({
      name: 'tts',
      description: 'Text to speech (Discord TTS or speak in VC if possible)',
      module: 'misc',
      options: [{ name: 'text', description: 'Text to speak', type: 3, required: true }],
      async run(ctx) {
        const text = ctx.getString?.('text') || ctx.args?.join(' ');
        if (!text) return ctx.reply('Provide text.');
        if (!config.get(ctx.guild.id).misc?.tts && config.get(ctx.guild.id).misc?.tts !== undefined) {
          return ctx.reply('TTS disabled.');
        }
        // Prefer channel TTS flag (works without voice deps)
        await ctx.channel.send({ content: text.slice(0, 200), tts: true });
        return ctx.reply({ content: 'Speaking…', ephemeral: true }).catch(() => {});
      },
    });

    registry.register({
      name: 'translate',
      description: 'Translate text (LibreTranslate or MyMemory free API)',
      module: 'misc',
      options: [
        { name: 'text', description: 'Text', type: 3, required: true },
        { name: 'to', description: 'Target language code (en, es, fr…)', type: 3, required: false },
      ],
      async run(ctx) {
        let text = ctx.getString?.('text');
        let to = ctx.getString?.('to') || 'en';
        if (!text) {
          // ,translate es hola mundo  OR ,translate hola mundo
          if (ctx.args?.[0] && /^[a-z]{2}$/i.test(ctx.args[0]) && ctx.args.length > 1) {
            to = ctx.args[0];
            text = ctx.args.slice(1).join(' ');
          } else {
            text = ctx.args?.join(' ');
          }
        }
        if (!text) return ctx.reply('Usage: ,translate [to] <text>');
        const base = process.env.LIBRETRANSLATE_URL;
        try {
          if (base) {
            const res = await fetch(`${base.replace(/\/$/, '')}/translate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ q: text, source: 'auto', target: to, format: 'text' }),
              signal: AbortSignal.timeout(10000),
            });
            const json = await res.json();
            return ctx.reply(json.translatedText || JSON.stringify(json).slice(0, 500));
          }
          // MyMemory free tier
          const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=autodetect|${encodeURIComponent(to)}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
          const json = await res.json();
          const out = json?.responseData?.translatedText;
          if (!out) return ctx.reply('Translate failed.');
          return ctx.reply(`**${to}:** ${out}`);
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
        if (!foe || foe.bot) return ctx.reply('Mention an opponent.');
        if (foe.id === ctx.user.id) return ctx.reply('Play someone else.');
        const board = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
        const render = () =>
          `\`${board[0]} | ${board[1]} | ${board[2]}\`\n\`${board[3]} | ${board[4]} | ${board[5]}\`\n\`${board[6]} | ${board[7]} | ${board[8]}\``;
        return ctx.reply(
          `Tic-tac-toe: ${ctx.user} (X) vs ${foe} (O)\n${render()}\n_Reply with a number 1-9 to play (honor system) — full interactive board later._`,
        );
      },
    });

    registry.register({
      name: 'blacktea',
      description: 'Word chain game (type a word starting with last letter)',
      module: 'misc',
      async run(ctx) {
        const action = (ctx.args?.[0] || 'start').toLowerCase();
        const key = ctx.channel.id;
        if (action === 'stop') {
          blacktea.delete(key);
          return ctx.reply('Blacktea stopped.');
        }
        if (action === 'start' || !blacktea.has(key)) {
          blacktea.set(key, { letter: 'a', last: null, scores: {} });
          return ctx.reply(
            '🍵 **Blacktea** started! Type a word starting with **a**.\n`,blacktea stop` to end. (Messages in this channel count.)',
          );
        }
        return ctx.reply(`Current letter: **${blacktea.get(key).letter}**`);
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

    registry.register({
      name: 'urban',
      description: 'Urban Dictionary lookup',
      module: 'misc',
      async run(ctx) {
        const q = ctx.args?.join(' ');
        if (!q) return ctx.reply('Usage: ,urban <term>');
        try {
          const r = await fetch(
            `https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(q)}`,
            { signal: AbortSignal.timeout(8000) },
          );
          const data = await r.json();
          const def = data.list?.[0];
          if (!def) return ctx.reply('No definition found.');
          return ctx.reply(
            `**${def.word}**\n${String(def.definition).replace(/\[|\]/g, '').slice(0, 800)}\n_👍 ${def.thumbs_up} · 👎 ${def.thumbs_down}_`,
          );
        } catch (err) {
          return ctx.reply(`Urban failed: ${err.message}`);
        }
      },
    });

    registry.register({
      name: 'define',
      description: 'Dictionary definition (Free Dictionary API)',
      module: 'misc',
      async run(ctx) {
        const word = ctx.args?.[0];
        if (!word) return ctx.reply('Usage: ,define <word>');
        try {
          const r = await fetch(
            `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
            { signal: AbortSignal.timeout(8000) },
          );
          if (!r.ok) return ctx.reply('No definition found.');
          const data = await r.json();
          const m = data[0]?.meanings?.[0];
          const def = m?.definitions?.[0]?.definition;
          return ctx.reply(`**${data[0].word}** (${m?.partOfSpeech || '?'})\n${def || '—'}`);
        } catch (err) {
          return ctx.reply(`Define failed: ${err.message}`);
        }
      },
    });

    registry.register({
      name: 'image',
      description: 'Image utilities: avatar, server icon, reverse search link',
      aliases: ['img'],
      module: 'misc',
      async run(ctx) {
        const action = (ctx.args?.[0] || 'avatar').toLowerCase();
        if (action === 'avatar' || action === 'av') {
          const user = ctx.message?.mentions?.users?.first?.() || ctx.user;
          return ctx.reply(user.displayAvatarURL({ size: 4096, extension: 'png' }));
        }
        if (action === 'server' || action === 'icon') {
          const url = ctx.guild.iconURL({ size: 4096, extension: 'png' });
          return ctx.reply(url || 'No server icon.');
        }
        if (action === 'reverse' || action === 'sauce') {
          const url = ctx.message?.attachments?.first()?.url
            || ctx.args?.[1]
            || ctx.message?.mentions?.users?.first()?.displayAvatarURL({ size: 1024, extension: 'png' });
          if (!url) return ctx.reply('Attach an image or pass a URL.');
          return ctx.reply(
            [
              '**Reverse image search**',
              `Google: https://www.google.com/searchbyimage?image_url=${encodeURIComponent(url)}`,
              `Yandex: https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(url)}`,
              `SauceNAO: https://saucenao.com/search.php?url=${encodeURIComponent(url)}`,
            ].join('\n'),
          );
        }
        return ctx.reply('Usage: ,image avatar [@user] | server | reverse [url|attachment]');
      },
    });

    registry.register({
      name: 'afk',
      description: 'Set an AFK message (shown when mentioned)',
      module: 'misc',
      async run(ctx) {
        const reason = ctx.args?.join(' ') || 'AFK';
        config.update(ctx.guild.id, (c) => {
          c.misc = c.misc || {};
          c.misc.afk = c.misc.afk || {};
          c.misc.afk[ctx.user.id] = { reason, ts: Date.now() };
          return c;
        });
        return ctx.reply(`AFK set: ${reason}`);
      },
    });
  }

  async function onMessage(message) {
    if (!message.guild || message.author.bot) return;
    // AFK mention
    const afkMap = config.get(message.guild.id).misc?.afk || {};
    for (const [id] of message.mentions.users) {
      if (afkMap[id]) {
        const a = afkMap[id];
        await message.channel.send(
          `💤 <@${id}> is AFK: ${a.reason} (<t:${Math.floor(a.ts / 1000)}:R>)`,
        ).catch(() => {});
      }
    }
    // Clear own AFK
    if (afkMap[message.author.id]) {
      config.update(message.guild.id, (c) => {
        if (c.misc?.afk) delete c.misc.afk[message.author.id];
        return c;
      });
    }
    // Blacktea
    const game = blacktea.get(message.channel.id);
    if (game && !message.content.startsWith(',')) {
      const word = message.content.trim().split(/\s+/)[0]?.toLowerCase();
      if (word && /^[a-z]+$/i.test(word) && word.startsWith(game.letter)) {
        game.letter = word.slice(-1).toLowerCase();
        game.last = word;
        game.scores[message.author.id] = (game.scores[message.author.id] || 0) + 1;
        await message.react('✅').catch(() => {});
      }
    }
  }

  return { register, onMessage };
}

module.exports = { createMisc };
