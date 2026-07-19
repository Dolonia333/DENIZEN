'use strict';

/**
 * Soft audit + DM helpers for Credits / PvP (SlotBot-style log channel).
 */

const { baseEmbed, BRAND } = require('../../core/ui-kit');

/**
 * @param {import('discord.js').Client} client
 * @param {{ get: (guildId: string) => object }} config
 * @param {string} guildId
 * @param {{ title: string, description: string, color?: number }} payload
 */
async function postEconomyAudit(client, config, guildId, payload) {
  try {
    const channelId = config.get(guildId)?.economy?.auditChannelId;
    if (!channelId || !client?.channels?.fetch) return;
    const ch = await client.channels.fetch(String(channelId)).catch(() => null);
    if (!ch?.send) return;
    await ch.send({
      embeds: [baseEmbed({
        color: payload.color ?? BRAND.muted,
        title: payload.title || 'Credits audit',
        description: payload.description || '',
        footerExtra: 'economy-audit',
      })],
    }).catch(() => {});
  } catch (_) { /* ignore */ }
}

/**
 * Best-effort DM. Never throws.
 * @param {{ send?: Function } | null} user
 * @param {string | object} content
 */
async function tryDm(user, content) {
  try {
    if (!user?.send) return false;
    await user.send(content);
    return true;
  } catch (_) {
    return false;
  }
}

function progressBar(value, max, width = 10) {
  const m = Math.max(1, Number(max) || 1);
  const v = Math.max(0, Math.min(m, Number(value) || 0));
  const filled = Math.round((v / m) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${v}/${m}`;
}

module.exports = {
  postEconomyAudit,
  tryDm,
  progressBar,
};
