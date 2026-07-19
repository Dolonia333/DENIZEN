'use strict';

/**
 * Slash + prefix (,) command registry.
 */

let guildPlans = null;
try {
  // eslint-disable-next-line global-require
  guildPlans = require('../../../src/denizen-guild-plans.js');
} catch (_) { guildPlans = null; }

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
   *   options?: object[],
   *   permission?: string,
   *   fakePerm?: string,
   *   ownerOnly?: boolean,
   *   run: (ctx) => Promise<void>|void
   * }} def
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
   * Register slash commands with Discord (guild-scoped if guildIds provided).
   */
  async syncSlash(client, guildIds = []) {
    const body = [];
    const seen = new Set();
    for (const cmd of this.list()) {
      if (!cmd.slash || seen.has(cmd.name)) continue;
      seen.add(cmd.name);
      body.push({
        name: cmd.name.slice(0, 32),
        description: String(cmd.description || cmd.name).slice(0, 100),
        options: cmd.options || [],
      });
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
      reply: async (content) => {
        const payload = typeof content === 'string' ? { content } : content;
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
      await message.reply(`Denied: ${gate.reason}`);
      return true;
    }
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
      getString: () => parts.join(' ') || null,
      getUser: () => message.mentions.users.first() || null,
      getMember: () => message.mentions.members?.first() || null,
      getChannel: () => message.mentions.channels.first() || null,
      getInteger: () => {
        const n = Number(parts[0]);
        return Number.isFinite(n) ? n : null;
      },
      getBoolean: () => null,
      reply: async (content) => message.reply(typeof content === 'string' ? content : content),
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

module.exports = { CommandRegistry };
