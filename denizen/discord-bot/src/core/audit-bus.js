'use strict';

/**
 * Normalized audit-log event bus for antinuke + logging.
 */

const { AuditLogEvent } = require('discord.js');

const ACTION_MAP = {
  [AuditLogEvent.MemberBanAdd]: 'ban',
  [AuditLogEvent.MemberKick]: 'kick',
  [AuditLogEvent.ChannelDelete]: 'channelDelete',
  [AuditLogEvent.ChannelCreate]: 'channelCreate',
  [AuditLogEvent.RoleDelete]: 'roleDelete',
  [AuditLogEvent.RoleCreate]: 'roleCreate',
  [AuditLogEvent.WebhookDelete]: 'webhook',
  [AuditLogEvent.WebhookCreate]: 'webhookCreate',
  [AuditLogEvent.EmojiDelete]: 'emojiDelete',
  [AuditLogEvent.BotAdd]: 'botadd',
  [AuditLogEvent.GuildUpdate]: 'guildUpdate',
  [AuditLogEvent.MemberRoleUpdate]: 'memberRoleUpdate',
};

class AuditBus {
  constructor() {
    /** @type {Set<Function>} */
    this.listeners = new Set();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(evt) {
    for (const fn of this.listeners) {
      try { fn(evt); } catch (err) {
        console.error('[audit-bus] listener error:', err.message || err);
      }
    }
  }

  attach(client) {
    client.on('guildAuditLogEntryCreate', (entry, guild) => {
      let kind = ACTION_MAP[entry.action] || `action_${entry.action}`;
      // Vanity / guild settings change
      if (kind === 'guildUpdate') {
        const changes = entry.changes || [];
        if (changes.some((c) => c.key === 'vanity_url_code')) kind = 'vanity';
      }
      this.emit({
        kind,
        action: entry.action,
        guild,
        guildId: guild.id,
        executorId: entry.executorId || entry.executor?.id || null,
        targetId: entry.targetId || entry.target?.id || null,
        entry,
        ts: Date.now(),
      });
    });
  }
}

module.exports = { AuditBus, ACTION_MAP };
