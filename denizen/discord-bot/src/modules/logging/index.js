'use strict';

/**
 * Server event logging → configured log channel.
 */

function createLogging(deps) {
  const { config } = deps;

  async function sendLog(guild, text) {
    const L = config.get(guild.id).logging;
    const channelId = L?.enabled ? L.channelId : null;
    const fallback = config.get(guild.id).security.logChannelId;
    const id = channelId || fallback;
    if (!id) return;
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (ch?.isTextBased?.()) await ch.send({ content: text.slice(0, 1900) }).catch(() => {});
  }

  function events(guildId) {
    return config.get(guildId).logging?.events || {};
  }

  async function onMessageDelete(message) {
    if (!message.guild || message.author?.bot) return;
    if (!events(message.guild.id).messageDelete) return;
    await sendLog(
      message.guild,
      `🗑️ **Message deleted** in <#${message.channel.id}> by ${message.author?.tag || '?'}\n${(message.content || '[embed/attachment]').slice(0, 500)}`,
    );
  }

  async function onMessageUpdate(oldMsg, newMsg) {
    if (!newMsg.guild || newMsg.author?.bot) return;
    if (!events(newMsg.guild.id).messageEdit) return;
    if (oldMsg.content === newMsg.content) return;
    await sendLog(
      newMsg.guild,
      `✏️ **Message edited** in <#${newMsg.channel.id}> by ${newMsg.author?.tag}\n**Before:** ${(oldMsg.content || '').slice(0, 400)}\n**After:** ${(newMsg.content || '').slice(0, 400)}`,
    );
  }

  async function onMemberAdd(member) {
    if (!events(member.guild.id).memberJoin) return;
    await sendLog(member.guild, `📥 **Join** ${member.user.tag} (\`${member.id}\`) · account <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`);
  }

  async function onMemberRemove(member) {
    if (!events(member.guild.id).memberLeave) return;
    await sendLog(member.guild, `📤 **Leave** ${member.user?.tag || member.id}`);
  }

  async function onVoiceStateUpdate(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    if (!guild || !events(guild.id).voice) return;
    if (oldState.channelId === newState.channelId) return;
    const user = newState.member?.user || oldState.member?.user;
    if (!user || user.bot) return;
    if (!oldState.channelId && newState.channelId) {
      await sendLog(guild, `🔊 ${user.tag} joined <#${newState.channelId}>`);
    } else if (oldState.channelId && !newState.channelId) {
      await sendLog(guild, `🔇 ${user.tag} left <#${oldState.channelId}>`);
    } else {
      await sendLog(guild, `🔀 ${user.tag} <#${oldState.channelId}> → <#${newState.channelId}>`);
    }
  }

  async function onAudit(evt) {
    if (!evt.guild || !events(evt.guildId).roles && evt.kind !== 'ban') return;
    if (evt.kind === 'ban' && events(evt.guildId).memberBan) {
      await sendLog(evt.guild, `🔨 **Ban** target=\`${evt.targetId}\` by <@${evt.executorId}>`);
    }
  }

  function register() {
    // Commands live under community `log` — no extra slash needed
  }

  return {
    register,
    onMessageDelete,
    onMessageUpdate,
    onMemberAdd,
    onMemberRemove,
    onVoiceStateUpdate,
    onAudit,
    sendLog,
  };
}

module.exports = { createLogging };
