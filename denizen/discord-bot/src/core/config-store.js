'use strict';

/**
 * Per-guild config store (JSON files under data/guilds/).
 * Bleed-parity schema: security, tickets, VM, roles, logging, music, integrations.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'data', 'guilds');

function defaultGuildConfig() {
  return {
    prefix: ',',
    security: {
      enabled: false,
      antinuke: {
        enabled: false,
        threshold: 3,
        windowMs: 10_000,
        punishment: 'timeout',
        whitelist: [],
        admins: [],
        commandDetection: true,
        autoRestore: true,
        moduleThresholds: {},
        modules: {
          ban: true,
          kick: true,
          channelDelete: true,
          channelCreate: true,
          roleDelete: true,
          roleCreate: true,
          webhook: true,
          webhookCreate: true,
          emojiDelete: true,
          botadd: true,
          vanity: true,
        },
      },
      antiraid: {
        enabled: false,
        massjoin: {
          enabled: false,
          threshold: 5,
          windowMs: 10_000,
          action: 'kick',
          lock: true,
          punish: true,
        },
        avatar: { enabled: false, action: 'kick' },
        age: { enabled: false, minDays: 7, action: 'kick' },
        whitelist: [],
        raidState: false,
      },
      fakePermissions: {
        roles: {},
        forceBotMod: false,
        roleBackups: {},
      },
      staffRoleIds: [],
      logChannelId: null,
    },
    moderation: {
      caseLogChannelId: null,
      jailRoleId: null,
      jailChannelId: null,
      muteRoleId: null,
      imageMuteRoleId: null,
      reactionMuteRoleId: null,
      nextCaseId: 1,
      invoke: {},
      warns: {},
    },
    automod: {
      enabled: false,
      invites: false,
      links: false,
      words: [],
      spam: { enabled: false, maxMsgs: 5, windowMs: 3000 },
      caps: { enabled: false, minLen: 12, ratio: 0.7 },
      mentions: { enabled: false, max: 5 },
      zalgo: { enabled: false },
      images: { enabled: false, action: 'delete' },
      action: 'delete',
      immuneRoles: [],
      immuneChannels: [],
      inviteWhitelist: [],
    },
    community: {
      welcome: {
        enabled: false,
        channelId: null,
        message: 'Welcome {user} to {server}! You are member #{memberCount}.',
      },
      goodbye: {
        enabled: false,
        channelId: null,
        message: '{user} left {server}.',
      },
      autoresponders: [],
      levels: {
        enabled: false,
        xpPerMsg: 15,
        cooldownMs: 60000,
        rewards: [],
      },
      starboard: { enabled: false, channelId: null, threshold: 3, posted: {} },
      giveaways: [],
      counters: [],
      reactionRoles: [],
      buttonRoles: [],
      boosterRoleId: null,
      vanity: { enabled: false, substring: '', roleId: null },
      bumpReminder: { enabled: false, channelId: null, lastBumpAt: 0 },
      autoMessages: [],
      reactionTriggers: [],
    },
    logging: {
      enabled: false,
      channelId: null,
      embeds: true,
      ignoreChannels: [],
      ignoreUsers: [],
      events: {
        messageDelete: true,
        messageEdit: true,
        memberJoin: true,
        memberLeave: true,
        memberBan: true,
        voice: false,
        roles: true,
        channels: true,
        mod: true,
      },
    },
    voicemaster: {
      enabled: false,
      hubChannelId: null,
      categoryId: null,
      tempChannels: {},
      defaultLimit: 0,
      interfaceText: true,
    },
    tickets: {
      enabled: false,
      categoryId: null,
      logChannelId: null,
      supportRoleId: null,
      openMessage: null,
      slaMinutes: 30,
      panels: [],
      open: {},
      closed: {},
      forms: [],
    },
    music: {
      enabled: false,
      volume: 80,
    },
    integrations: {
      notify: [],
      lastfm: { users: {} },
    },
    aliases: {},
    spaces: {
      plan: 'free',
      removeBranding: false,
    },
    misc: {
      tts: true,
    },
  };
}

class ConfigStore {
  constructor(opts = {}) {
    this.dir = opts.dir || process.env.DISCORD_CONFIG_DIR || DEFAULT_DIR;
    fs.mkdirSync(this.dir, { recursive: true });
    /** @type {Map<string, object>} */
    this.cache = new Map();
  }

  _file(guildId) {
    return path.join(this.dir, `${guildId}.json`);
  }

  get(guildId) {
    const id = String(guildId);
    if (this.cache.has(id)) return this.cache.get(id);
    const file = this._file(id);
    let cfg = defaultGuildConfig();
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        cfg = deepMerge(defaultGuildConfig(), parsed);
      } catch (err) {
        console.warn('[config-store] corrupt config', id, err.message);
      }
    }
    this.cache.set(id, cfg);
    return cfg;
  }

  set(guildId, cfg) {
    const id = String(guildId);
    this.cache.set(id, cfg);
    fs.writeFileSync(this._file(id), JSON.stringify(cfg, null, 2), 'utf8');
    return cfg;
  }

  update(guildId, mutator) {
    const cfg = this.get(guildId);
    const next = typeof mutator === 'function' ? mutator(cfg) || cfg : deepMerge(cfg, mutator);
    return this.set(guildId, next);
  }

  getPath(guildId, dotted, fallback = undefined) {
    const cfg = this.get(guildId);
    const parts = String(dotted).split('.');
    let cur = cfg;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return fallback;
      cur = cur[p];
    }
    return cur === undefined ? fallback : cur;
  }
}

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over !== undefined ? over : base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (
      v && typeof v === 'object' && !Array.isArray(v)
      && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
    ) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

module.exports = {
  ConfigStore,
  defaultGuildConfig,
  deepMerge,
};
