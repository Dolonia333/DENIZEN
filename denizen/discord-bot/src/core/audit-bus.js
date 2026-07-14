'use strict';

/**
 * Normalized audit-log event bus (GuildAuditLogEntryCreate + fallbacks).
 */

const { AuditLogEvent } = require('discord.js');

const ACTION_MAP = {
  [AuditLogEvent.MemberBanAdd]: 'ban',
  [AuditLogEvent.MemberKick]: 'kick',
  [AuditLogEvent.ChannelDelete]: 'channelDelete',
  [AuditLogEvent.RoleDelete]: 'roleDelete',
  [AuditLogEvent.WebhookDelete]: 'webhook',
  [AuditLogEvent.EmojiDelete]: 'emojiDelete',
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

  /**
   * Attach to discord.js client.
   */
  attach(client) {
    client.on('guildAuditLogEntryCreate', (entry, guild) => {
      const kind = ACTION_MAP[entry.action] || `action_${entry.action}`;
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
