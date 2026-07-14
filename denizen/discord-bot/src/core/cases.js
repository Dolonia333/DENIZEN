'use strict';

/**
 * Moderation case IDs + log channel helpers.
 */

async function nextCase(configStore, guildId) {
  let caseId = 1;
  configStore.update(guildId, (cfg) => {
    caseId = cfg.moderation.nextCaseId || 1;
    cfg.moderation.nextCaseId = caseId + 1;
    return cfg;
  });
  return caseId;
}

async function logCase(guild, configStore, payload) {
  const cfg = configStore.get(guild.id);
  const channelId = cfg.moderation.caseLogChannelId || cfg.security.logChannelId;
  const caseId = payload.caseId || await nextCase(configStore, guild.id);
  const line = [
    `**Case #${caseId}** | ${payload.action}`,
    `User: ${payload.targetTag || payload.targetId}${payload.targetId ? ` (\`${payload.targetId}\`)` : ''}`,
    `Mod: ${payload.modTag || payload.modId || 'system'}`,
    `Reason: ${payload.reason || 'No reason provided'}`,
  ].join('\n');
  if (channelId) {
    const ch = await guild.channels.fetch(channelId).catch(() => null);
    if (ch?.isTextBased?.()) {
      await ch.send({ content: line }).catch(() => {});
    }
  }
  return { caseId, line };
}

module.exports = { nextCase, logCase };
