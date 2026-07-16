'use strict';

/**
 * Lightweight Discord chat — @mention / DM replies.
 * Commands: help, rooms, who, status
 * Freeform → LM Studio if available, else tracker summary.
 */

const DEFAULT_LM = 'http://127.0.0.1:1234';

function stripMention(content, botId) {
  return String(content || '')
    .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
    .trim();
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

async function askLmStudio(user, opts = {}) {
  const base = String(opts.baseUrl || process.env.LM_STUDIO_URL || DEFAULT_LM).replace(/\/$/, '');
  const model = opts.model || process.env.LM_STUDIO_MODEL || process.env.DISCORD_CHAT_MODEL || 'local';
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs || 45_000);
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
          {
            role: 'system',
            content:
              'You are Denizen, a Discord companion that watches voice/text rooms for a live office canvas. '
              + 'Be concise, friendly, and slightly playful. If asked about room occupancy, use the status block. '
              + 'Do not pretend to moderate or nuke the server unless the user is clearly roleplaying.',
          },
          {
            role: 'user',
            content: `Server status:\n${opts.statusBlock || '(none)'}\n\nUser said: ${text}`,
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LM ${res.status}: ${body.slice(0, 120)}`);
    }
    const json = await res.json();
    const out = json?.choices?.[0]?.message?.content;
    return String(out || '').trim() || null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param {import('discord.js').Message} message
 * @param {{ tracker: import('./tracker').TrackerEngine, client: import('discord.js').Client }} ctx
 */
async function handleBotChat(message, ctx) {
  const { tracker, client } = ctx;
  if (!message || message.author?.bot) return false;

  const botId = client.user?.id;
  if (!botId) return false;

  const isDm = !message.guild;
  const mentioned = message.mentions?.users?.has(botId);
  if (!isDm && !mentioned) return false;

  // Avoid echoing soft-text double-handling issues — always reply once.
  let text = stripMention(message.content, botId);
  if (!text && isDm) text = 'help';
  if (!text) {
    await message.reply('Hey — try `@Denizen help`, `rooms`, or just ask me something.');
    return true;
  }

  const guildId = message.guild?.id || [...tracker.guilds.keys()][0];
  const snap = guildId ? tracker.snapshot(guildId) : { rooms: [], members: [] };
  const statusBlock = [
    `Guild: ${snap.name || guildId || 'unknown'}`,
    formatRooms(snap),
  ].join('\n');

  const lowered = text.toLowerCase().trim();
  const cmd = lowered.split(/\s+/)[0].replace(/^!/, '');

  try {
    await message.channel.sendTyping().catch(() => {});

    if (['help', 'commands', '?', 'start', 'spaces'].includes(cmd)) {
      const helpCopy = require('./help-copy');
      await message.reply(helpCopy.mentionHelp({
        guildId: message.guild?.id || guildId,
      }));
      return true;
    }

    if (['rooms', 'room', 'vc', 'map'].includes(cmd)) {
      const helpCopy = require('./help-copy');
      const map = helpCopy.mapUrl(message.guild?.id || guildId);
      await message.reply(
        `**Rooms** (live on the map)\n${formatRooms(snap)}\n\n🗺️ ${map}`,
      );
      return true;
    }

    if (['who', 'where', 'people'].includes(cmd)) {
      await message.reply(`**Who's around**\n${formatWho(snap)}`);
      return true;
    }

    if (['status', 'stats', 'ping'].includes(cmd)) {
      const helpCopy = require('./help-copy');
      const voiceN = (snap.rooms || [])
        .filter((r) => r.type === 'voice' || r.type === 'stage')
        .reduce((n, r) => n + (r.occupantCount || 0), 0);
      const textN = (snap.members || []).filter((m) => m.textChannelId).length;
      const liveN = (snap.members || []).filter((m) => m.live).length;
      const map = helpCopy.mapUrl(message.guild?.id || guildId);
      await message.reply(
        [
          `**${snap.name || 'Guild'}** — online`,
          `• ${voiceN} in VC (${liveN} open mic) · ${textN} active in text`,
          `• Map: ${map}`,
          '• Join voice to appear · `/avatar` to change look · Boost for golden headset',
        ].join('\n'),
      );
      return true;
    }

    // Freeform chat
    try {
      const reply = await askLmStudio(text, { statusBlock });
      if (reply) {
        await message.reply(reply.slice(0, 1900));
        return true;
      }
    } catch (err) {
      console.warn('[discord-chat] LM Studio unavailable:', err.message || err);
    }

    const helpCopy = require('./help-copy');
    await message.reply(
      [
        "I heard you — full chat needs LM Studio on :1234, but the map still works.",
        '',
        '**Right now on the map:**',
        formatRooms(snap),
        '',
        helpCopy.mentionHelp({ guildId: message.guild?.id || guildId }),
      ].join('\n').slice(0, 1900),
    );
    return true;
  } catch (err) {
    console.error('[discord-chat] reply failed:', err.message || err);
    try {
      await message.reply('Something glitched while I was answering — try again in a second.');
    } catch (_) {}
    return true;
  }
}

module.exports = {
  handleBotChat,
  stripMention,
  formatRooms,
  askLmStudio,
};
