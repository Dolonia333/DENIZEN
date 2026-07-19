'use strict';

/**
 * User-facing help copy for slash/prefix and @mention chat.
 * Prefer embeds (spacesHelpEmbed) over markdown dumps.
 */

const { baseEmbed, BRAND } = require('./core/ui-kit');

function publicBase() {
  return String(process.env.DENIZEN_PUBLIC_URL || process.env.DENIZEN_URL || '')
    .trim()
    .replace(/\/$/, '');
}

function mapUrl(guildId) {
  const base = publicBase();
  const path = guildId
    ? `/discord-map/?guildId=${encodeURIComponent(guildId)}&view=public`
    : '/discord-map/';
  return base ? `${base}${path}` : path;
}

/**
 * Two-line intro for places that still need plain text.
 * @param {{ prefix?: string, guildId?: string }} [opts]
 */
function spacesIntro(opts = {}) {
  const map = mapUrl(opts.guildId);
  return [
    'Live pixel map of this Discord — buildings are your channels.',
    `Join a **voice channel** to appear · ${map}`,
  ].join('\n');
}

/**
 * Canonical Spaces help embed — @mention help, /help spaces, ,start.
 * @param {{ prefix?: string, guildId?: string, title?: string }} [opts]
 */
function spacesHelpEmbed(opts = {}) {
  const p = opts.prefix || process.env.DISCORD_PREFIX || ',';
  const map = mapUrl(opts.guildId) || '/discord-map/';
  return baseEmbed({
    color: BRAND.primary,
    title: opts.title || 'Denizen Spaces',
    description: 'Live pixel map of this server — walk buildings, meet people in VC.',
    fields: [
      { name: 'Map', value: map, inline: false },
      { name: 'Look', value: `\`${p}avatar\` · Boost → golden headset`, inline: true },
      { name: 'Pet', value: `\`${p}pet buy\` · gift · equip · Pro grants ×3`, inline: true },
      { name: 'Live', value: 'React in chat to emote on the map · `,eat pizza` (and other foods)', inline: true },
      { name: 'Chat', value: `\`@Denizen <question>\`\nStaff: \`${p}chat on\``, inline: true },
      { name: 'Hangout', value: `\`/hangout\` · \`${p}help\``, inline: true },
    ],
    footerExtra: 'start here',
  });
}

/**
 * @deprecated Prefer spacesHelpEmbed — kept for any string-only callers.
 */
function mentionHelp(opts = {}) {
  const p = opts.prefix || process.env.DISCORD_PREFIX || ',';
  const map = mapUrl(opts.guildId);
  return [
    '**Denizen Spaces** — live pixel map',
    map,
    `Join VC · \`${p}avatar\` · \`${p}help\``,
  ].join('\n');
}

/**
 * One-liner footer for other command success replies (optional).
 */
function mapFooter(guildId) {
  const map = mapUrl(guildId);
  return `_Map: ${map}_`;
}

module.exports = {
  publicBase,
  mapUrl,
  spacesIntro,
  spacesHelpEmbed,
  mentionHelp,
  mapFooter,
};
