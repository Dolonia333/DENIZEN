'use strict';

/**
 * Discord chat — @mention / DM / opt-in open-channel replies.
 *
 * - Commands: help, rooms, who, status
 * - Freeform → LM Studio (local + remote mesh URLs)
 * - Injects Discord data-farm topics/friction into the system prompt
 * - Open channel mode: guild config chat.openChannels (no @ required)
 */

const path = require('path');
const { mentionHelp } = require('./help-copy');

const DEFAULT_LM = 'http://127.0.0.1:1234';

/** @type {Map<string, number>} channelId → last open-chat reply ts */
const openChatCooldown = new Map();

function stripMention(content, botId) {
  return String(content || '')
    .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
    .trim();
}

/**
 * Resolve LM Studio base URL(s). Prefer explicit opts, then LM_STUDIO_URL,
 * then first of LM_STUDIO_REMOTE_URLS (NAS → GPU host).
 * @returns {string[]}
 */
function resolveLmBases(opts = {}) {
  if (opts.baseUrl) return [String(opts.baseUrl).replace(/\/$/, '').replace(/\/v1\/?$/, '')];
  const out = [];
  const primary = String(process.env.LM_STUDIO_URL || '').trim();
  if (primary) out.push(primary.replace(/\/$/, '').replace(/\/v1\/?$/, ''));
  const remotes = String(process.env.LM_STUDIO_REMOTE_URLS || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/\/$/, '').replace(/\/v1\/?$/, ''));
  for (const r of remotes) {
    if (!out.includes(r)) out.push(r);
  }
  if (!out.length) out.push(DEFAULT_LM);
  return out;
}

function formatRooms(snapshot) {
  const rooms = snapshot?.rooms || [];
  if (!rooms.length) return 'No rooms tracked yet.';
  const lines = rooms
    .filter((r) => r.type === 'voice' || r.type === 'stage' || r.occupantCount > 0)
    .sort((a, b) => b.occupantCount - a.occupantCount || a.name.localeCompare(b.name))
    .map((r) => {
      const tag = r.type === 'voice' || r.type === 'stage' ? r.name : `#${r.name}`;
      return `• ${tag} — ${r.occupantCount}`;
    });
  return lines.length ? lines.join('\n') : 'All rooms empty right now.';
}

function formatWho(snapshot) {
  const members = (snapshot?.members || []).filter(
    (m) => m.voiceChannelId || m.textChannelId,
  );
  if (!members.length) return 'Nobody on my radar right now.';
  const byId = new Map((snapshot.rooms || []).map((r) => [r.id, r]));
  return members
    .map((m) => {
      const v = m.voiceChannelId ? byId.get(m.voiceChannelId)?.name : null;
      const t = m.textChannelId ? `#${byId.get(m.textChannelId)?.name || '?'}` : null;
      const where = [v && `VC:${v}`, t && `text:${t}`].filter(Boolean).join(', ');
      return `• ${m.displayName} — ${where || '?'}`;
    })
    .join('\n');
}

/**
 * Topics / community themes (what people talk about).
 */
function buildTopicContext() {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const farm = require(path.join(__dirname, '..', '..', 'src', 'denizen-discord-farm.js'));
    const sc = farm.buildDiscordFarmScorecard();
    const topics = (sc.topicsHot || []).slice(0, 8);
    const topicLine = topics.length
      ? topics.map((t) => {
        let s = `${t.topic}×${t.count || 0}`;
        if (t.friction) s += ` ⚠${t.friction}`;
        if (t.questions) s += ` ?${t.questions}`;
        return s;
      }).join(', ')
      : '(none yet)';
    const block = [
      'Community themes (what people are into / stuck on lately):',
      `- Messages 24h: ${sc.messages24h || 0}`,
      `- Questions 24h: ${sc.questions24h || 0}`,
      `- Friction 24h: ${sc.friction24h || 0}`,
      `- Praise 24h: ${sc.praise24h || 0}`,
      `- Hot topics: ${topicLine}`,
      'Sound aware of recurring themes. If friction is high, be helpful and concrete.',
      'Never invent private DMs, real names, or claim you stored secrets.',
    ].join('\n');
    return {
      block,
      topicsHot: topics,
      friction24h: sc.friction24h || 0,
      questions24h: sc.questions24h || 0,
      messages24h: sc.messages24h || 0,
    };
  } catch (_) {
    return null;
  }
}

/** @deprecated use buildTopicContext */
function buildFarmContext() {
  return buildTopicContext();
}

/**
 * How this person + community tend to talk → adapt replies.
 */
function buildPersonSenseContext(opts = {}) {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const sense = require(path.join(__dirname, '..', '..', 'src', 'denizen-conversation-sense.js'));
    // Learn from this message too (even if harvest already ran)
    try {
      sense.observeChat({
        userId: opts.userId,
        guildId: opts.guildId,
        content: opts.content,
        source: 'discord-chat',
      });
    } catch (_) { /* ignore */ }
    return sense.buildAdaptationBlock({
      userId: opts.userId,
      guildId: opts.guildId,
      content: opts.content,
    });
  } catch (_) {
    return null;
  }
}

function buildSystemPrompt(opts = {}) {
  const extras = [opts.senseBlock, opts.topicBlock, opts.farmBlock]
    .filter(Boolean)
    .map((b) => `\n\n${b}`)
    .join('');
  return (
    'You are Denizen — a real-feeling Discord companion for Denizen Spaces '
    + '(pixel map of voice/text rooms, music, tickets, community tools). '
    + 'Your job is to talk like a sharp, kind human in this server — not a corporate bot. '
    + 'Default: clear and natural. Length and energy should MATCH the person you are talking to '
    + '(see conversation sense below). '
    + 'If asked about rooms, use the status block. '
    + 'Useful commands when relevant: ,help ,sense ,chat on ,player ,avatar. '
    + 'Do not pretend to ban/nuke the server unless the user is clearly roleplaying.'
    + extras
  );
}

/**
 * @param {string} userText - what the human said
 * @param {{ baseUrl?: string, model?: string, timeoutMs?: number, statusBlock?: string, farmBlock?: string, topicBlock?: string, senseBlock?: string }} [opts]
 */
async function askLmStudio(userText, opts = {}) {
  const text = String(userText || '').trim();
  if (!text) return null;

  const bases = resolveLmBases(opts);
  const model = opts.model
    || process.env.DISCORD_CHAT_MODEL
    || process.env.LM_STUDIO_MODEL
    || 'local';
  const timeoutMs = opts.timeoutMs || 45_000;
  const system = buildSystemPrompt({
    farmBlock: opts.farmBlock,
    topicBlock: opts.topicBlock,
    senseBlock: opts.senseBlock,
  });
  const userContent = [
    opts.statusBlock ? `Server status:\n${opts.statusBlock}` : null,
    `User said: ${text}`,
  ].filter(Boolean).join('\n\n');

  let lastErr = null;
  for (const base of bases) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0.7,
          max_tokens: 400,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userContent },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        lastErr = new Error(`LM ${res.status} @ ${base}: ${body.slice(0, 120)}`);
        continue;
      }
      const json = await res.json();
      const out = json?.choices?.[0]?.message?.content;
      const reply = String(out || '').trim();
      if (reply) return reply;
      lastErr = new Error(`empty LM reply @ ${base}`);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(t);
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

/**
 * Whether this channel is in open-chat mode (no @ required).
 */
function isOpenChatChannel(config, guildId, channelId) {
  if (!config || !guildId || !channelId) return false;
  try {
    const list = config.get(guildId)?.chat?.openChannels;
    return Array.isArray(list) && list.includes(String(channelId));
  } catch (_) {
    return false;
  }
}

function openChatCooldownMs(config, guildId) {
  try {
    const n = Number(config?.get?.(guildId)?.chat?.cooldownMs);
    if (Number.isFinite(n) && n >= 1000) return n;
  } catch (_) { /* default */ }
  return Number(process.env.DISCORD_OPEN_CHAT_COOLDOWN_MS) || 8000;
}

/**
 * @param {import('discord.js').Message} message
 * @param {{
 *   tracker: import('./tracker').TrackerEngine,
 *   client: import('discord.js').Client,
 *   config?: import('./core/config-store').ConfigStore,
 * }} ctx
 */
async function handleBotChat(message, ctx) {
  const { tracker, client, config } = ctx;
  if (!message || message.author?.bot) return false;

  const botId = client.user?.id;
  if (!botId) return false;

  const isDm = !message.guild;
  const mentioned = message.mentions?.users?.has(botId);
  const openChat = !isDm && isOpenChatChannel(config, message.guild?.id, message.channel?.id);

  if (!isDm && !mentioned && !openChat) return false;

  // Open channel: skip pure emoji/attachments with no text, skip short noise
  let text = stripMention(message.content, botId);
  if (!text && isDm) text = 'help';
  if (!text) {
    if (openChat && !mentioned) return false;
    await message.reply('Hey — try `@Denizen help`, `rooms`, or just ask me something.');
    return true;
  }

  // Open channel without @ — ignore command-looking lines (prefix commands already handled)
  if (openChat && !mentioned && !isDm) {
    if (/^[,/!]/.test(text)) return false;
    if (text.length < 3) return false;
    // Rate limit open chat so we don't spam the channel
    const key = message.channel.id;
    const now = Date.now();
    const cd = openChatCooldownMs(config, message.guild.id);
    const last = openChatCooldown.get(key) || 0;
    if (now - last < cd) return false;
  }

  const guildId = message.guild?.id || [...tracker.guilds.keys()][0];
  const snap = guildId ? tracker.snapshot(guildId) : { rooms: [], members: [] };
  const statusBlock = [
    `Guild: ${snap.name || guildId || 'unknown'}`,
    `Channel: #${message.channel?.name || 'dm'}`,
    `Mode: ${isDm ? 'dm' : mentioned ? 'mention' : 'open-channel'}`,
    formatRooms(snap),
  ].join('\n');

  const topicCtx = buildTopicContext();
  const senseCtx = buildPersonSenseContext({
    userId: message.author?.id,
    guildId: message.guild?.id,
    content: text,
  });
  const lowered = text.toLowerCase().trim();
  const cmd = lowered.split(/\s+/)[0].replace(/^!/, '');

  try {
    await message.channel.sendTyping().catch(() => {});

    if (['help', 'commands', '?'].includes(cmd)) {
      const p = config?.get?.(message.guild?.id)?.prefix || process.env.DISCORD_PREFIX || ',';
      await message.reply(
        [
          mentionHelp({ prefix: p, guildId: message.guild?.id }),
          '',
          '**Chat**',
          '• `@Denizen <question>` — freeform (adapts to how you talk)',
          '• DM me the same commands',
          openChat
            ? '• Open chat **ON** in this channel (no @ needed)'
            : `• Staff: \`${p}chat on\` — I reply in this channel without @`,
          `• \`${p}sense\` — how I’m learning conversation styles`,
        ].join('\n').slice(0, 1900),
      );
      return true;
    }

    if (['rooms', 'room', 'vc'].includes(cmd)) {
      await message.reply(`**Rooms**\n${formatRooms(snap)}`);
      return true;
    }

    if (['who', 'where', 'people'].includes(cmd)) {
      await message.reply(`**Who's around**\n${formatWho(snap)}`);
      return true;
    }

    if (['status', 'stats', 'ping'].includes(cmd)) {
      const voiceN = (snap.rooms || [])
        .filter((r) => r.type === 'voice' || r.type === 'stage')
        .reduce((n, r) => n + r.occupantCount, 0);
      const textN = (snap.members || []).filter((m) => m.textChannelId).length;
      const themeLine = topicCtx
        ? `Themes 24h: ${topicCtx.messages24h} msgs · ${topicCtx.questions24h} ? · ${topicCtx.friction24h} stuck spots`
        : null;
      const styleLine = senseCtx?.person
        ? `Your style: **${senseCtx.person.primary}**${senseCtx.person.known ? '' : ' (still learning)'}`
        : null;
      await message.reply(
        [
          `Online. Watching **${snap.name || 'guild'}** — ${voiceN} in VC, ${textN} soft-active in text.`,
          themeLine,
          styleLine,
          openChat ? 'Open chat is **on** here.' : null,
        ].filter(Boolean).join('\n'),
      );
      return true;
    }

    // Freeform chat via LM — adapted to this person + community
    try {
      const reply = await askLmStudio(text, {
        statusBlock,
        topicBlock: topicCtx?.block || null,
        senseBlock: senseCtx?.block || null,
      });
      if (reply) {
        if (openChat && !mentioned) openChatCooldown.set(message.channel.id, Date.now());
        await message.reply(reply.slice(0, 1900));
        return true;
      }
    } catch (err) {
      console.warn('[discord-chat] LM Studio unavailable:', err.message || err);
    }

    // Fallback when LM down
    const topicHint = topicCtx?.topicsHot?.length
      ? `Lately people talk about: ${(topicCtx.topicsHot || []).slice(0, 4).map((t) => t.topic).join(', ')}.`
      : null;
    const styleHint = senseCtx?.person?.primary
      ? `I'll keep it ${senseCtx.person.primary}-friendly when my brain is back.`
      : null;
    if (openChat && !mentioned) openChatCooldown.set(message.channel.id, Date.now());
    await message.reply(
      [
        "I heard you, but my LLM brain isn't reachable right now (LM Studio / mesh).",
        '',
        '**Right now:**',
        formatRooms(snap),
        topicHint,
        styleHint,
        '',
        'Try `@Denizen help` or `,sense`.',
      ].filter(Boolean).join('\n').slice(0, 1900),
    );
    return true;
  } catch (err) {
    console.error('[discord-chat] reply failed:', err.message || err);
    try {
      await message.reply('Something glitched while I was answering — try again in a second.');
    } catch (_) { /* ignore */ }
    return true;
  }
}

/**
 * Register ,chat on|off|status for open-channel mode.
 */
function createChatControls(deps) {
  const { config } = deps;
  const { canRunCommand } = require('./core/permissions');
  const { successEmbed, dangerEmbed, baseEmbed, BRAND } = require('./core/ui-kit');

  function register(registry) {
    registry.register({
      name: 'chat',
      description: 'Open-channel chat mode (reply without @mention)',
      aliases: ['openchat', 'talk'],
      module: 'chat',
      options: [
        { name: 'action', description: 'on|off|status', type: 3, required: false },
      ],
      async run(ctx) {
        if (!ctx.guild) {
          return ctx.reply({ embeds: [dangerEmbed('Guild only', 'Use this in a server channel.')] });
        }
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'status').toLowerCase();
        const ch = ctx.channel;
        const g = config.get(ctx.guild.id);
        const open = Array.isArray(g.chat?.openChannels) ? g.chat.openChannels : [];

        if (action === 'on' || action === 'off') {
          if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) {
            return ctx.reply({ embeds: [dangerEmbed('Denied', 'Need Manage Guild')] });
          }
          const on = action === 'on';
          config.update(ctx.guild.id, (c) => {
            c.chat = c.chat || { openChannels: [], cooldownMs: 8000 };
            c.chat.openChannels = Array.isArray(c.chat.openChannels) ? c.chat.openChannels : [];
            if (on) {
              if (!c.chat.openChannels.includes(ch.id)) c.chat.openChannels.push(ch.id);
            } else {
              c.chat.openChannels = c.chat.openChannels.filter((id) => id !== ch.id);
            }
            return c;
          });
          return ctx.reply({
            embeds: [successEmbed(
              on ? 'Open chat ON' : 'Open chat OFF',
              on
                ? `${ch} — I'll reply to messages here **without** needing @Denizen (cooldown ~8s). Still farms chats for learning.`
                : `${ch} — back to @mention / DM only.`,
            )],
          });
        }

        const here = open.includes(ch.id);
        const topicCtx = buildTopicContext();
        return ctx.reply({
          embeds: [baseEmbed({
            color: here ? BRAND.success : BRAND.info,
            title: 'Discord chat',
            description: [
              '**@mention / DM** — always works',
              '**Open channel** — staff: `,chat on` in a channel',
              '',
              'Replies adapt to **how you talk** + room vibe (conversation sense).',
            ].join('\n'),
            fields: [
              { name: 'This channel', value: here ? '🟢 open chat' : '⚪ @mention only', inline: true },
              { name: 'Open channels', value: String(open.length), inline: true },
              {
                name: 'Themes',
                value: topicCtx
                  ? `${topicCtx.messages24h} msgs · topics: ${(topicCtx.topicsHot || []).slice(0, 3).map((t) => t.topic).join(', ') || '—'}`
                  : 'offline',
              },
            ],
            footerExtra: 'adapts per person · privacy-aware',
          })],
        });
      },
    });
  }

  return { register };
}

module.exports = {
  handleBotChat,
  stripMention,
  formatRooms,
  formatWho,
  askLmStudio,
  resolveLmBases,
  buildFarmContext,
  buildTopicContext,
  buildPersonSenseContext,
  buildSystemPrompt,
  isOpenChatChannel,
  createChatControls,
};
