'use strict';

/**
 * Denizen Spaces UI kit — denser, cleaner embeds than typical multipurpose bots.
 * Brand: deep ink + electric violet (not Bleed's plain dark blue dump).
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  Colors,
} = require('discord.js');

const BRAND = {
  primary: 0x7c5cff, // electric violet
  success: 0x3dd68c,
  danger: 0xff5c7a,
  warn: 0xffc14a,
  muted: 0x6b7280,
  ink: 0x0f1117,
  info: 0x38bdf8,
  surface: 0x1a1d27,
};

const FOOTER = 'Denizen Spaces';

function brandFooter(extra = '') {
  return {
    text: extra ? `${FOOTER} · ${extra}` : FOOTER,
  };
}

function baseEmbed(opts = {}) {
  const e = new EmbedBuilder()
    .setColor(opts.color ?? BRAND.primary)
    .setTimestamp(opts.timestamp === false ? null : new Date());
  if (opts.title) e.setTitle(String(opts.title).slice(0, 256));
  if (opts.description) e.setDescription(String(opts.description).slice(0, 4096));
  if (opts.thumbnail) e.setThumbnail(opts.thumbnail);
  if (opts.image) e.setImage(opts.image);
  if (opts.url) e.setURL(opts.url);
  if (opts.author) {
    e.setAuthor(typeof opts.author === 'string'
      ? { name: opts.author.slice(0, 256) }
      : opts.author);
  }
  e.setFooter(opts.footer || brandFooter(opts.footerExtra || ''));
  if (opts.fields?.length) {
    e.addFields(opts.fields.slice(0, 25).map((f) => ({
      name: String(f.name).slice(0, 256),
      value: String(f.value || '—').slice(0, 1024),
      inline: !!f.inline,
    })));
  }
  return e;
}

function successEmbed(title, description, fields) {
  return baseEmbed({ title: `✦ ${title}`, description, fields, color: BRAND.success });
}

function dangerEmbed(title, description, fields) {
  return baseEmbed({ title: `◆ ${title}`, description, fields, color: BRAND.danger });
}

function infoEmbed(title, description, fields) {
  return baseEmbed({ title: `◈ ${title}`, description, fields, color: BRAND.info });
}

function panelEmbed(title, description, fields, color = BRAND.primary) {
  return baseEmbed({
    title: `▣ ${title}`,
    description,
    fields,
    color,
    footerExtra: 'control panel',
  });
}

/** Progress bar for rank / volume */
function bar(ratio, len = 12) {
  const r = Math.max(0, Math.min(1, Number(ratio) || 0));
  const filled = Math.round(r * len);
  return `\`${'█'.repeat(filled)}${'░'.repeat(len - filled)}\` ${Math.round(r * 100)}%`;
}

function formatDuration(ms) {
  const s = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function musicNowPlayingEmbed({ track, queue, guildName }) {
  const q = queue || {};
  const t = track || q.playing;
  const pos = q.tracks || [];
  const vol = q.volume ?? 80;
  const loop = q.loop || 'off';
  const filter = q.filter || 'none';
  const len = t?.length ? formatDuration(t.length) : 'live/—';

  return baseEmbed({
    color: BRAND.primary,
    author: { name: '♪ Denizen Player' },
    title: t ? t.title.slice(0, 200) : 'Nothing playing',
    url: t?.uri && String(t.uri).startsWith('http') ? t.uri : undefined,
    description: t
      ? [
          t.author ? `**Artist** · ${t.author}` : null,
          `**Duration** · \`${len}\``,
          `**Volume** · ${bar(vol / 100, 10)}`,
          `**Loop** \`${loop}\` · **Filter** \`${filter}\``,
        ].filter(Boolean).join('\n')
      : 'Queue a track with `/play` or `,play <song>`.',
    fields: [
      {
        name: 'Up next',
        value: pos.length
          ? pos.slice(0, 5).map((x, i) => `\`${i + 1}.\` ${String(x.title).slice(0, 48)}`).join('\n')
            + (pos.length > 5 ? `\n_…+${pos.length - 5} more_` : '')
          : '_empty_',
        inline: false,
      },
    ],
    footerExtra: guildName || 'Spaces audio',
  });
}

function musicControlRows(disabled = false) {
  const d = !!disabled;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('denizen_music_pause').setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(d),
      new ButtonBuilder().setCustomId('denizen_music_skip').setLabel('Skip').setStyle(ButtonStyle.Primary).setDisabled(d),
      new ButtonBuilder().setCustomId('denizen_music_stop').setLabel('Stop').setStyle(ButtonStyle.Danger).setDisabled(d),
      new ButtonBuilder().setCustomId('denizen_music_shuffle').setLabel('Shuffle').setStyle(ButtonStyle.Secondary).setDisabled(d),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('denizen_music_vol_down').setLabel('Vol −').setStyle(ButtonStyle.Secondary).setDisabled(d),
      new ButtonBuilder().setCustomId('denizen_music_vol_up').setLabel('Vol +').setStyle(ButtonStyle.Secondary).setDisabled(d),
      new ButtonBuilder().setCustomId('denizen_music_loop').setLabel('Loop').setStyle(ButtonStyle.Primary).setDisabled(d),
      new ButtonBuilder().setCustomId('denizen_music_refresh').setLabel('Refresh').setStyle(ButtonStyle.Success).setDisabled(d),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('denizen_music_filter')
        .setPlaceholder('Audio filter…')
        .setDisabled(d)
        .addOptions(
          { label: 'None', value: 'none' },
          { label: 'Bass boost', value: 'bassboost' },
          { label: 'Nightcore', value: 'nightcore' },
          { label: 'Vaporwave', value: 'vaporwave' },
          { label: 'Soft', value: 'soft' },
          { label: '8D', value: '8d' },
        ),
    ),
  ];
}

function ticketPanelEmbed(title, description) {
  return baseEmbed({
    color: BRAND.info,
    title: title || 'Support desk',
    description: description
      || [
        'Private tickets for support, reports, and staff help.',
        '',
        '**How it works**',
        '1. Pick a category (or open a ticket)',
        '2. Answer the form if asked',
        '3. Staff claim & resolve — you get a transcript on close',
        '',
        '_Powered by Denizen Spaces — not a generic multipurpose dump._',
      ].join('\n'),
    footerExtra: 'tickets',
  });
}

function ticketOpenRows(hasForms) {
  if (hasForms) return []; // select menu added separately
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('denizen_ticket_open')
        .setLabel('Open ticket')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('denizen_ticket_guide')
        .setLabel('How tickets work')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function helpHubEmbed(prefix = ',') {
  let commandsLink = '/discord-commands/';
  try {
    // eslint-disable-next-line global-require
    commandsLink = require('../help-copy').commandsUrl();
  } catch (_) { /* keep relative */ }
  return baseEmbed({
    color: BRAND.primary,
    title: 'Denizen Spaces',
    description: [
      '**Start here:** live pixel map of this Discord + your closet avatar.',
      `\`${prefix}start\` · \`${prefix}avatar\` · \`${prefix}hangout\``,
      '',
      `**Full list:** ${commandsLink}`,
      '',
      'Staff tools below (Bleed-parity). **Premium** = security · community. Avatar layers need Pro (premade + skin are free).',
    ].join('\n'),
    fields: [
      { name: '🗺 Spaces map', value: `\`${prefix}start\` · map & closet`, inline: true },
      { name: '♪ Music', value: `\`${prefix}play\` · \`${prefix}player\``, inline: true },
      { name: '🎫 Tickets', value: `\`${prefix}tickets panel\``, inline: true },
      { name: '🎙️ VoiceMaster', value: `\`${prefix}vm setup\``, inline: true },
      { name: '🛡 Security 💎', value: `\`${prefix}help security\` · premium`, inline: true },
      { name: '⚔ Moderation', value: `\`${prefix}help mods\``, inline: true },
      { name: 'Community 💎', value: `\`${prefix}help community\` · premium`, inline: true },
    ],
    footerExtra: '💎 = Denizen premium plan',
  });
}

function helpHubRows() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('denizen_help_topic')
        .setPlaceholder('Browse help topics…')
        .addOptions(
          { label: 'Spaces map & avatar', value: 'spaces', description: 'Pixel map, closet, hangout' },
          { label: 'Music player', value: 'music', description: 'Play, panel, filters — needs Lavalink' },
          { label: 'Tickets & support', value: 'tickets' },
          { label: 'Security 💎 (antinuke/raid)', value: 'security', description: 'Premium module' },
          { label: 'Moderation & automod', value: 'mods' },
          { label: 'Community 💎 & levels', value: 'community', description: 'Premium module' },
          { label: 'All modules', value: 'all' },
        ),
    ),
  ];
}

function rankCardEmbed({ user, xp, level, rank, nextXp, prevXp, avatarUrl }) {
  const progress = Math.min(1, (xp - prevXp) / Math.max(1, nextXp - prevXp));
  return baseEmbed({
    color: BRAND.primary,
    author: { name: user?.tag || user?.username || 'Member', iconURL: avatarUrl },
    title: `Level ${level}`,
    description: [
      `**Rank** #${rank || '—'} · **${xp}** XP`,
      bar(progress, 14),
      `Next level at **${nextXp}** XP`,
    ].join('\n'),
    thumbnail: avatarUrl,
    footerExtra: 'levels',
  });
}

function securityDashboardEmbed(s = {}) {
  return baseEmbed({
    color: s.enabled ? BRAND.success : BRAND.warn,
    title: 'Security dashboard',
    fields: [
      { name: 'Suite', value: s.enabled ? '🟢 ON' : '🔴 OFF', inline: true },
      { name: 'Antinuke', value: s.antinuke?.enabled ? '🟢' : '⚪', inline: true },
      { name: 'Antiraid', value: s.antiraid?.enabled ? '🟢' : '⚪', inline: true },
      { name: 'forceBotMod', value: s.fakePermissions?.forceBotMod ? '🟢' : '⚪', inline: true },
      { name: 'Raid state', value: s.antiraid?.raidState ? '🚨 LOCKED' : 'clear', inline: true },
      {
        name: 'Quick setup',
        value: '`,security full` · `,fp harden @Mod` · `,antinuke on`',
      },
    ],
  });
}

/** Reply helper: prefer embeds, keep ephemeral when requested */
async function replyUI(ctx, payload) {
  const data = typeof payload === 'string' ? { content: payload } : payload;
  return ctx.reply(data);
}

module.exports = {
  BRAND,
  Colors,
  baseEmbed,
  successEmbed,
  dangerEmbed,
  infoEmbed,
  panelEmbed,
  bar,
  formatDuration,
  musicNowPlayingEmbed,
  musicControlRows,
  ticketPanelEmbed,
  ticketOpenRows,
  helpHubEmbed,
  helpHubRows,
  rankCardEmbed,
  securityDashboardEmbed,
  replyUI,
  brandFooter,
};
