'use strict';

/**
 * Bleed-style template + lightweight embed scripting.
 *
 * Variables: {user} {user.name} {user.tag} {user.id} {server} {server.name}
 * {memberCount} {channel} {reason} {mod} {level} {xp}
 *
 * Embed script (single message content):
 *   {embed}$v{title: Hello}$v{description: Hi {user.name}}$v{color: #5865F2}$v{footer: Denizen}
 *
 * Returns either a string or { content?, embeds: EmbedBuilder[] } compatible payload.
 */

const { EmbedBuilder } = require('discord.js');

function applyVars(template, ctx = {}) {
  let s = String(template || '');
  const user = ctx.user || ctx.member?.user;
  const guild = ctx.guild || ctx.member?.guild;
  const map = {
    '{user}': user ? `<@${user.id}>` : '',
    '{user.mention}': user ? `<@${user.id}>` : '',
    '{user.name}': user?.username || '',
    '{user.tag}': user?.tag || user?.username || '',
    '{user.id}': user?.id || '',
    '{server}': guild?.name || '',
    '{server.name}': guild?.name || '',
    '{server.id}': guild?.id || '',
    '{memberCount}': String(guild?.memberCount ?? ''),
    '{channel}': ctx.channel ? `<#${ctx.channel.id}>` : '',
    '{reason}': ctx.reason || '',
    '{mod}': ctx.mod ? `<@${ctx.mod.id}>` : '',
    '{level}': ctx.level != null ? String(ctx.level) : '',
    '{xp}': ctx.xp != null ? String(ctx.xp) : '',
    '{prize}': ctx.prize || '',
  };
  for (const [k, v] of Object.entries(map)) {
    s = s.split(k).join(v);
  }
  return s;
}

function parseColor(raw) {
  if (!raw) return 0x5865f2;
  const s = String(raw).trim();
  if (s.startsWith('#')) return parseInt(s.slice(1), 16) || 0x5865f2;
  if (/^\d+$/.test(s)) return Number(s);
  const named = {
    red: 0xed4245, green: 0x57f287, blue: 0x5865f2, blurple: 0x5865f2,
    gold: 0xfee75c, orange: 0xe67e22, purple: 0x9b59b6, grey: 0x95a5a6,
  };
  return named[s.toLowerCase()] || 0x5865f2;
}

/**
 * Parse Bleed-like {embed}$v{key: value} script into discord.js payload.
 */
function renderScript(template, ctx = {}) {
  const filled = applyVars(template, ctx);
  if (!/\{embed\}/i.test(filled) && !/\$v\{/.test(filled)) {
    return { content: filled.slice(0, 2000) };
  }

  const fields = {};
  const re = /\$v\{([^:}]+):\s*([\s\S]*?)\}/g;
  let m;
  while ((m = re.exec(filled)) !== null) {
    const key = m[1].trim().toLowerCase();
    const val = m[2].trim();
    if (!fields[key]) fields[key] = val;
    else if (Array.isArray(fields[key])) fields[key].push(val);
    else fields[key] = [fields[key], val];
  }

  const embed = new EmbedBuilder().setColor(parseColor(fields.color));
  if (fields.title) embed.setTitle(String(fields.title).slice(0, 256));
  if (fields.description) embed.setDescription(String(fields.description).slice(0, 4000));
  if (fields.footer) embed.setFooter({ text: String(fields.footer).slice(0, 2048) });
  if (fields.thumbnail) embed.setThumbnail(String(fields.thumbnail));
  if (fields.image) embed.setImage(String(fields.image));
  if (fields.url) embed.setURL(String(fields.url));
  if (fields.author) embed.setAuthor({ name: String(fields.author).slice(0, 256) });
  if (fields.timestamp === 'true' || fields.timestamp === 'now') embed.setTimestamp(new Date());

  // field: Name | Value | inline?
  const fieldList = fields.field
    ? (Array.isArray(fields.field) ? fields.field : [fields.field])
    : [];
  for (const f of fieldList.slice(0, 25)) {
    const parts = String(f).split('|').map((x) => x.trim());
    if (parts[0] && parts[1]) {
      embed.addFields({
        name: parts[0].slice(0, 256),
        value: parts[1].slice(0, 1024),
        inline: parts[2] === 'true' || parts[2] === '1',
      });
    }
  }

  const content = fields.content || fields.message || null;
  return {
    content: content ? String(content).slice(0, 2000) : undefined,
    embeds: [embed],
  };
}

function renderTemplate(template, ctx = {}) {
  return applyVars(template, ctx).slice(0, 2000);
}

/** Send either plain text or script payload to a channel */
async function sendRendered(channel, template, ctx = {}) {
  const payload = renderScript(template, ctx);
  if (payload.embeds) return channel.send(payload);
  return channel.send({ content: payload.content || '—' });
}

module.exports = {
  applyVars,
  renderTemplate,
  renderScript,
  sendRendered,
  parseColor,
};
