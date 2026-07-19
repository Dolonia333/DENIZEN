'use strict';

/**
 * Slash + prefix (,) command registry.
 */

let guildPlans = null;
try {
  // eslint-disable-next-line global-require
  guildPlans = require('../../../src/denizen-guild-plans.js');
} catch (_) { guildPlans = null; }

/** Discord ApplicationCommandOptionType.String */
const OPT_STRING = 3;
/** Discord ApplicationCommandOptionType.Integer */
const OPT_INTEGER = 4;
/** Discord ApplicationCommandOptionType.Boolean */
const OPT_BOOLEAN = 5;

/** Hard Discord cap on application (slash) commands per app, per scope. */
const SLASH_COMMAND_CAP = 100;

/**
 * Modules whose slash surface is safe to drop first when trimming to the
 * Discord cap — the prefix (`,`) versions always keep working regardless.
 * Set DISCORD_SLASH_TRIM=1 to skip slash registration for these modules
 * outright, freeing budget for everything else without touching per-command
 * `slash` flags.
 */
const SLASH_TRIM_MODULES = ['economy', 'pvp', 'shop', 'minigames'];

function slashTrimEnabled() {
  return String(process.env.DISCORD_SLASH_TRIM || '0').trim() === '1';
}

const MENTION_TOKEN = /^<(@!?|@&|#)\d+>$/;

/** Default: slash replies are invoker-only. Set DISCORD_PRIVATE_REPLIES=0 to disable. */
function privateRepliesEnabled() {
  return String(process.env.DISCORD_PRIVATE_REPLIES || '1').trim() !== '0';
}

/**
 * Resolve whether a reply should be private (slash ephemeral / prefix auto-delete).
 * Explicit `ephemeral` on the payload wins; then `cmd.public`; then module allowlist;
 * then global default (DISCORD_PRIVATE_REPLIES).
 *
 * Game modules stay channel-visible so duel boards / shop panels aren't deleted
 * after ~8s (prefix "ephemeral" cleanup) — that made Credits feel broken.
 */
const PUBLIC_MODULES = new Set(['economy', 'pvp', 'shop', 'music', 'minigames', 'slots']);

function resolvePrivateReply(cmd, content) {
  if (content && typeof content === 'object' && Object.prototype.hasOwnProperty.call(content, 'ephemeral')) {
    return !!content.ephemeral;
  }
  if (cmd?.public) return false;
  if (cmd?.module && PUBLIC_MODULES.has(String(cmd.module))) return false;
  return privateRepliesEnabled();
}

/** Prefix replies can't be ephemeral — delete after a short window instead. */
function schedulePrefixCleanup(message, sent, ms) {
  const delay = Number.isFinite(ms) && ms > 0 ? ms : 8_000;
  setTimeout(() => {
    Promise.resolve(sent?.delete?.()).catch(() => {});
    Promise.resolve(message?.delete?.()).catch(() => {});
  }, delay);
}

/**
 * Prefix parsers that respect slash option order.
 * Fixes `,fp harden @Mod` / `,tickets form …` where getString('action') used to
 * return the entire remainder ("harden <@&…>") instead of the first token.
 *
 * @param {{ options?: object[] }} cmd
 * @param {string[]} parts args after the command name
 * @param {import('discord.js').Message} message
 */
function bindPrefixOptionGetters(cmd, parts, message) {
  const opts = Array.isArray(cmd?.options) ? cmd.options : [];
  const indexByName = new Map(opts.map((o, i) => [o.name, i]));

  function stringIndices() {
    return opts.map((o, i) => (o.type === OPT_STRING ? i : -1)).filter((i) => i >= 0);
  }

  function restFrom(idx) {
    // Drop pure mention tokens so `,levels reward 5 @role` → value "5", not "5 <@&…>"
    const tokens = parts.slice(idx).filter((t) => !MENTION_TOKEN.test(t));
    return tokens.join(' ') || null;
  }

  return {
    getString(name) {
      if (!opts.length) return parts.join(' ') || null;
      if (!name) return parts.join(' ') || null;
      const idx = indexByName.get(name);
      if (idx == null) return parts.join(' ') || null;
      const strIdxs = stringIndices();
      const isLastString = strIdxs.length > 0 && strIdxs[strIdxs.length - 1] === idx;
      if (isLastString) return restFrom(idx);
      return parts[idx] ?? null;
    },
    getInteger(name) {
      const idx = name != null && indexByName.has(name) ? indexByName.get(name) : 0;
      const n = Number(parts[idx]);
      return Number.isFinite(n) ? n : null;
    },
    getBoolean(name) {
      const idx = name != null && indexByName.has(name) ? indexByName.get(name) : 0;
      const v = String(parts[idx] || '').toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(v)) return true;
      if (['0', 'false', 'no', 'off'].includes(v)) return false;
      return null;
    },
    getUser() {
      return message.mentions?.users?.first?.() || null;
    },
    getMember() {
      return message.mentions?.members?.first?.() || null;
    },
    getChannel() {
      return message.mentions?.channels?.first?.() || null;
    },
    getRole() {
      return message.mentions?.roles?.first?.() || null;
    },
  };
}

class CommandRegistry {
  constructor(opts = {}) {
    this.prefix = opts.prefix || ',';
    /** @type {Map<string, object>} */
    this.commands = new Map();
    this._client = null;
    /** @type {Map<string, number>} user+command → last-run ts (spam guard) */
    this._cooldowns = new Map();
  }

  /**
   * Per-user per-command cooldown (default 2s, override via def.cooldownMs).
   * Returns remaining ms when throttled, 0 when clear.
   */
  checkCooldown(cmd, userId) {
    // Explicit 0 disables cooldown (staff workflows). Default 2s; mod modules 500ms.
    let windowMs;
    if (cmd.cooldownMs != null && Number.isFinite(Number(cmd.cooldownMs))) {
      windowMs = Math.max(0, Number(cmd.cooldownMs));
    } else if (['moderation', 'security', 'automod', 'logging'].includes(cmd.module)) {
      windowMs = 500;
    } else {
      windowMs = 2000;
    }
    if (windowMs === 0) return 0;
    const key = `${userId}:${cmd.name || 'cmd'}`;
    const now = Date.now();
    const last = this._cooldowns.get(key) || 0;
    if (now - last < windowMs) return windowMs - (now - last);
    this._cooldowns.set(key, now);
    if (this._cooldowns.size > 5000) {
      for (const [k, t] of this._cooldowns) {
        if (now - t > 60_000) this._cooldowns.delete(k);
      }
    }
    return 0;
  }

  /**
   * @param {{
   *   name: string,
   *   description?: string,
   *   aliases?: string[],
   *   module?: string,
   *   slash?: boolean,
   *   public?: boolean,
   *   options?: object[],
   *   permission?: string,
   *   fakePerm?: string,
   *   ownerOnly?: boolean,
   *   priority?: number,
   *   run: (ctx) => Promise<void>|void
   * }} def
   *
   * `slash: false` always keeps a command prefix-only (`,cmd` still works —
   * slash is opt-in decoration, never a requirement). `priority` (higher = kept
   * longer) decides who gets bumped first when the slash surface must be
   * trimmed to Discord's 100-command cap; defaults to 0. Bump `priority` on
   * high-traffic commands and/or leave it low on rare/staff ones instead of
   * disabling slash outright when there's still budget.
   */
  register(def) {
    if (!def?.name || typeof def.run !== 'function') {
      throw new Error('command requires name + run');
    }
    const entry = {
      description: def.description || def.name,
      aliases: def.aliases || [],
      module: def.module || 'core',
      slash: def.slash !== false,
      priority: Number.isFinite(def.priority) ? Number(def.priority) : 0,
      public: !!def.public,
      options: def.options || [],
      permission: def.permission || null,
      fakePerm: def.fakePerm || null,
      ownerOnly: !!def.ownerOnly,
      run: def.run,
      cooldownMs: def.cooldownMs,
      name: def.name,
    };
    this.commands.set(def.name.toLowerCase(), entry);
    for (const a of entry.aliases) {
      this.commands.set(String(a).toLowerCase(), { ...entry, name: def.name, _aliasOf: def.name });
    }
    return this;
  }

  list() {
    const seen = new Set();
    const out = [];
    for (const [name, cmd] of this.commands) {
      if (cmd._aliasOf) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, ...cmd });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name) {
    return this.commands.get(String(name || '').toLowerCase()) || null;
  }

  bindClient(client) {
    this._client = client;
  }

  /**
   * Build the slash command budget: respects `slash: false` (those always
   * stay prefix-only), optionally drops whole modules via
   * DISCORD_SLASH_TRIM=1, and — if what's left still exceeds Discord's
   * 100-command cap — trims lowest-`priority` commands so the sync call
   * itself doesn't fail outright (which used to knock out slash for
   * *everything*, e.g. "Maximum number of application commands reached
   * (100)"). Prefix (`,cmd`) always works no matter what gets trimmed here.
   */
  buildSlashBody() {
    const trimModules = slashTrimEnabled();
    const seen = new Set();
    const candidates = [];
    const skipped = [];
    for (const cmd of this.list()) {
      if (seen.has(cmd.name)) continue;
      seen.add(cmd.name);
      if (!cmd.slash) continue; // explicit opt-out — always prefix-only
      if (trimModules && SLASH_TRIM_MODULES.includes(cmd.module)) {
        skipped.push({ name: cmd.name, reason: 'DISCORD_SLASH_TRIM module skip' });
        continue;
      }
      candidates.push(cmd);
    }

    let selected = candidates;
    if (candidates.length > SLASH_COMMAND_CAP) {
      // Stable sort: higher priority first, ties keep original (alphabetical) order.
      const ranked = candidates
        .map((cmd, idx) => ({ cmd, idx }))
        .sort((a, b) => (b.cmd.priority - a.cmd.priority) || (a.idx - b.idx));
      selected = ranked.slice(0, SLASH_COMMAND_CAP).map((r) => r.cmd);
      for (const r of ranked.slice(SLASH_COMMAND_CAP)) {
        skipped.push({ name: r.cmd.name, reason: 'over 100-command cap, low priority' });
      }
    }

    const body = selected.map((cmd) => ({
      name: cmd.name.slice(0, 32),
      description: String(cmd.description || cmd.name).slice(0, 100),
      options: cmd.options || [],
    }));
    return { body, skipped };
  }

  /**
   * Register slash commands with Discord (guild-scoped if guildIds provided).
   * Always fits within Discord's 100-command cap so a busy command set can't
   * cause the entire slash sync to fail — prefix commands are unaffected
   * either way.
   */
  async syncSlash(client, guildIds = []) {
    const { body, skipped } = this.buildSlashBody();
    if (skipped.length) {
      console.warn(
        `[discord-bot] slash budget: skipping ${skipped.length} command(s) `
        + `(prefix still works): ${skipped.map((s) => s.name).join(', ')}`,
      );
    }
    if (guildIds.length) {
      for (const gid of guildIds) {
        const guild = await client.guilds.fetch(gid).catch(() => null);
        if (guild) await guild.commands.set(body);
      }
    } else {
      await client.application.commands.set(body);
    }
    return body.length;
  }

  async handleInteraction(interaction, ctxExtras = {}) {
    if (!interaction.isChatInputCommand()) return false;
    const cmd = this.get(interaction.commandName);
    if (!cmd) return false;
    const { canRunCommand } = require('./permissions');
    const gate = canRunCommand({
      guild: interaction.guild,
      member: interaction.member,
      user: interaction.user,
      config: ctxExtras.config,
    }, cmd);
    if (!gate.ok) {
      const payload = { content: `Denied: ${gate.reason}`, ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
      return true;
    }
    const ctx = {
      ...ctxExtras,
      source: 'slash',
      interaction,
      guild: interaction.guild,
      member: interaction.member,
      user: interaction.user,
      channel: interaction.channel,
      client: interaction.client,
      args: [],
      getString: (n) => interaction.options.getString(n),
      getUser: (n) => interaction.options.getUser(n),
      getMember: (n) => interaction.options.getMember(n),
      getChannel: (n) => interaction.options.getChannel(n),
      getInteger: (n) => interaction.options.getInteger(n),
      getBoolean: (n) => interaction.options.getBoolean(n),
      getRole: (n) => interaction.options.getRole(n),
      reply: async (content) => {
        const privateReply = resolvePrivateReply(cmd, content);
        const payload = typeof content === 'string'
          ? { content, ephemeral: privateReply }
          : { ...content, ephemeral: privateReply };
        if (interaction.deferred || interaction.replied) {
          return interaction.followUp(payload);
        }
        return interaction.reply(payload);
      },
    };
    const waitMs = this.checkCooldown(cmd, ctx.user?.id || 'anon');
    if (waitMs > 0) {
      await ctx.reply(`Slow down — try again in ${Math.ceil(waitMs / 1000)}s.`);
      return true;
    }
    if (guildPlans && ctx.guild?.id && guildPlans.isPremiumModule(cmd.module)) {
      const allowed = await guildPlans.isModuleAllowed(ctx.guild.id, cmd.module).catch(() => false);
      if (!allowed) {
        const upgrade = process.env.DISCORD_UPGRADE_URL || '';
        await ctx.reply({
          content: [
            `🔒 **${cmd.module}** is a Denizen premium module for this server.`,
            `\`${cmd.name}\` needs an active plan.`,
            upgrade ? `Upgrade: ${upgrade}` : 'Ask a server admin to upgrade Denizen Spaces.',
          ].join('\n'),
          ephemeral: true,
        });
        return true;
      }
    }
    await cmd.run(ctx);
    return true;
  }

  async handlePrefixMessage(message, ctxExtras = {}) {
    if (!message.guild || message.author.bot) return false;
    const cfg = ctxExtras.config?.get(message.guild.id);
    const prefix = cfg?.prefix || this.prefix;
    if (!message.content.startsWith(prefix)) return false;
    const raw = message.content.slice(prefix.length).trim();
    if (!raw) return false;
    const parts = raw.split(/\s+/);
    const name = parts.shift();
    const cmd = this.get(name);
    if (!cmd) return false;
    const { canRunCommand } = require('./permissions');
    const gate = canRunCommand({
      guild: message.guild,
      member: message.member,
      user: message.author,
      config: ctxExtras.config,
    }, cmd);
    if (!gate.ok) {
      const denied = await message.reply(`Denied: ${gate.reason}`).catch(() => null);
      schedulePrefixCleanup(message, denied, Number(process.env.DISCORD_PREFIX_DELETE_MS) || 8_000);
      return true;
    }
    const getters = bindPrefixOptionGetters(cmd, parts, message);
    const prefixDeleteMs = Number(process.env.DISCORD_PREFIX_DELETE_MS) || 8_000;
    const ctx = {
      ...ctxExtras,
      source: 'prefix',
      message,
      guild: message.guild,
      member: message.member,
      user: message.author,
      channel: message.channel,
      client: message.client,
      args: parts,
      getString: getters.getString,
      getUser: getters.getUser,
      getMember: getters.getMember,
      getChannel: getters.getChannel,
      getInteger: getters.getInteger,
      getBoolean: getters.getBoolean,
      getRole: getters.getRole,
      reply: async (content) => {
        const privateReply = resolvePrivateReply(cmd, content);
        const payload = typeof content === 'string' ? { content } : { ...content };
        delete payload.ephemeral; // message.reply does not support ephemeral
        const sent = await message.reply(payload);
        if (privateReply) schedulePrefixCleanup(message, sent, prefixDeleteMs);
        return sent;
      },
    };
    const waitMs = this.checkCooldown(cmd, ctx.user?.id || 'anon');
    if (waitMs > 0) {
      await ctx.reply(`Slow down — try again in ${Math.ceil(waitMs / 1000)}s.`);
      return true;
    }
    if (guildPlans && ctx.guild?.id && guildPlans.isPremiumModule(cmd.module)) {
      const allowed = await guildPlans.isModuleAllowed(ctx.guild.id, cmd.module).catch(() => false);
      if (!allowed) {
        const upgrade = process.env.DISCORD_UPGRADE_URL || '';
        await ctx.reply([
          `🔒 **${cmd.module}** is a Denizen premium module for this server.`,
          `\`${cmd.name}\` needs an active plan.`,
          upgrade ? `Upgrade: ${upgrade}` : 'Ask a server admin to upgrade Denizen Spaces.',
        ].join('\n'));
        return true;
      }
    }
    await cmd.run(ctx);
    return true;
  }
}

module.exports = {
  CommandRegistry,
  bindPrefixOptionGetters,
  resolvePrivateReply,
  privateRepliesEnabled,
  slashTrimEnabled,
  SLASH_COMMAND_CAP,
  SLASH_TRIM_MODULES,
};
