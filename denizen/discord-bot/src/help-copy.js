'use strict';

/**
 * User-facing help copy for slash/prefix and @mention chat.
 * Keep under Discord's 2000-char message limit when fully joined.
 */

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
 * Short intro shown in help + first-touch replies.
 * @param {{ prefix?: string, guildId?: string }} [opts]
 */
function spacesIntro(opts = {}) {
  const p = opts.prefix || process.env.DISCORD_PREFIX || ',';
  const map = mapUrl(opts.guildId);
  return [
    '**Denizen Spaces** — live pixel map of this Discord',
    '',
    '1. Open the map → walk the server as buildings & rooms',
    `   ${map}`,
    '2. Join a **voice channel** → you appear there',
    `3. \`${p}avatar\` or \`/avatar edit\` → pick your look`,
    '4. **Boost** this server → golden headset on the map',
  ].join('\n');
}

/**
 * Full help for /help and ,help
 * @param {{ prefix?: string, guildId?: string, modules?: Map<string, string[]> }} opts
 */
function fullHelp(opts = {}) {
  const p = opts.prefix || process.env.DISCORD_PREFIX || ',';
  const parts = [
    spacesIntro({ prefix: p, guildId: opts.guildId }),
    '',
    '**Spaces (start here)**',
    `• \`${p}avatar\` / \`/avatar\` — **Free:** premade NPCs + skin tones`,
    '  **Paid:** hair, hair color, clothes, masks, hats, headsets',
    `• \`${p}skin light\` — free skin tone · \`${p}hair\` / \`${p}clothes\` need Community`,
    `• **Boost** this server → golden headset (free perk)`,
    `• \`${p}denizen map\` · \`${p}signup\` · \`${p}link\` — account + map link`,
    `• \`${p}hangout\` / \`/hangout\` — weekly who hung out (VC minutes)`,
    `• \`${p}roomsnapshot\` — who’s in which room right now`,
    '',
    '**Chat with me**',
    '• `@Denizen help` · `rooms` · `who` · `status` · or ask anything',
    '',
    '**Bleed-parity security** (staff)',
    `• \`${p}security enable|doctor\` · \`${p}antinuke on\` · modules ban/kick/channel/role/webhook/emoji/botadd/vanity`,
    `• \`${p}antiraid on\` · avatar · age · massjoin · \`${p}lockdown\` · \`${p}fakepermissions\``,
    '',
    '**Moderation** (staff)',
    `• \`${p}setup\` · ban · softban · kick · timeout · warn · jail · mute · purge · nick · role`,
    `• \`${p}automod\` · snipe · editsnipe · \`${p}tickets setup|panel|claim|close\``,
    '',
    '**Community & fun**',
    `• \`${p}welcome\` · starboard · levels · reactionrole · buttonrole · boosterrole · vanityrole`,
    `• \`${p}voicemaster setup\` · \`${p}play\` · \`${p}lastfm set\` · \`${p}log on\``,
    '',
    `Prefix is \`${p}\` — most commands also work as **/** slash.`,
    'Tip: copy the **public map link** from the map Connect page for share/OBS.',
  ];

  if (opts.modules && opts.modules.size) {
    parts.push('');
    parts.push('**All modules**');
    const lines = [...opts.modules.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([mod, names]) => `• **${mod}**: ${names.slice(0, 12).join(', ')}${names.length > 12 ? '…' : ''}`);
    parts.push(...lines);
  }

  return parts.join('\n').slice(0, 1900);
}

/**
 * Compact @mention / DM help
 */
function mentionHelp(opts = {}) {
  const p = opts.prefix || process.env.DISCORD_PREFIX || ',';
  const map = mapUrl(opts.guildId);
  return [
    '**Denizen Spaces**',
    `🗺️ Map: ${map}`,
    '• Join a **voice channel** to show up',
    `• \`${p}avatar\` — customize look · **Boost** → golden headset`,
    '• `rooms` · `who` · `status` — live occupancy',
    '• Ask me anything after @ — LM chat + community farm topics',
    `• \`${p}chat on\` — I talk in this channel without @ (staff)`,
    `• \`${p}farm status\` — what I’m learning from chats`,
    `• \`${p}help\` — full command list`,
    `• \`${p}hangout report\` — weekly VC hangout board (staff setup)`,
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
  fullHelp,
  mentionHelp,
  mapFooter,
};
