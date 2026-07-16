'use strict';

const { canRunCommand, isGuildOwner, isWhitelisted } = require('../../core/permissions');

const MODULE_KEYS = [
  'ban', 'kick', 'channelDelete', 'channelCreate', 'roleDelete', 'roleCreate',
  'webhook', 'webhookCreate', 'emojiDelete', 'botadd', 'vanity',
];

const KIND_TO_MODULE = {
  ban: 'ban',
  kick: 'kick',
  channelDelete: 'channelDelete',
  channelCreate: 'channelCreate',
  roleDelete: 'roleDelete',
  roleCreate: 'roleCreate',
  webhook: 'webhook',
  webhookCreate: 'webhookCreate',
  emojiDelete: 'emojiDelete',
  botadd: 'botadd',
  vanity: 'vanity',
};

function createAntinuke(deps) {
  const { config, hub } = deps;
  /** guildId -> executorId -> timestamps */
  const windows = new Map();
  /** per-module windows: guildId -> executorId -> kind -> timestamps */
  const moduleWindows = new Map();

  function canConfigure(guild, userId) {
    if (isGuildOwner(guild, userId)) return true;
    const admins = config.get(guild.id).security.antinuke.admins || [];
    return admins.includes(String(userId));
  }

  function bucket(guildId, executorId, kind) {
    if (!moduleWindows.has(guildId)) moduleWindows.set(guildId, new Map());
    const g = moduleWindows.get(guildId);
    if (!g.has(executorId)) g.set(executorId, new Map());
    const e = g.get(executorId);
    if (!e.has(kind)) e.set(kind, []);
    return e.get(kind);
  }

  async function punish(guild, executorId, punishment) {
    const member = await guild.members.fetch(executorId).catch(() => null);
    if (!member) return;
    const reason = 'Denizen antinuke threshold exceeded';
    try {
      if (punishment === 'ban') await member.ban({ reason });
      else if (punishment === 'kick') await member.kick(reason);
      else if (punishment === 'stripstaff') {
        const cfg = config.get(guild.id);
        for (const rid of cfg.security.staffRoleIds || []) {
          if (member.roles.cache.has(rid)) await member.roles.remove(rid, reason).catch(() => {});
        }
        // Also strip roles with dangerous Discord perms
        for (const role of member.roles.cache.values()) {
          if (role.managed || role.id === guild.id) continue;
          if (
            role.permissions.has('Administrator')
            || role.permissions.has('BanMembers')
            || role.permissions.has('ManageGuild')
          ) {
            await member.roles.remove(role, reason).catch(() => {});
          }
        }
      } else {
        await member.timeout(60 * 60 * 1000, reason).catch(() => {});
      }
    } catch (err) {
      console.warn('[antinuke] punish failed:', err.message);
    }
  }

  function onAudit(evt) {
    const { guild, guildId, executorId, kind } = evt;
    if (!guild || !executorId) return;
    const cfg = config.get(guildId);
    if (!cfg.security.enabled || !cfg.security.antinuke.enabled) return;
    if (isGuildOwner(guild, executorId)) return;
    if (isWhitelisted(cfg.security.antinuke.whitelist, executorId)) return;
    if (executorId === guild.client.user?.id) return;
    if ((cfg.security.antinuke.admins || []).includes(String(executorId))) return;

    const modKey = KIND_TO_MODULE[kind];
    if (!modKey) return;
    const mods = cfg.security.antinuke.modules || {};
    if (!mods[modKey]) return;

    const now = Date.now();
    const windowMs = cfg.security.antinuke.windowMs || 10_000;
    const threshold = cfg.security.antinuke.threshold || 3;
    const arr = bucket(guildId, executorId, modKey);
    arr.push(now);
    while (arr.length && now - arr[0] > windowMs) arr.shift();
    if (arr.length < threshold) return;

    arr.length = 0;
    const punishment = cfg.security.antinuke.punishment || 'timeout';
    console.log(`[antinuke] trip guild=${guildId} exec=${executorId} kind=${kind} do=${punishment}`);
    hub.emit('security.antinuke', { guildId, executorId, kind, punishment });
    punish(guild, executorId, punishment);
    const logId = cfg.security.logChannelId || cfg.logging?.channelId;
    if (logId) {
      guild.channels.fetch(logId).then((ch) => {
        if (ch?.isTextBased?.()) {
          ch.send(`⚠️ **Antinuke** tripped on <@${executorId}> (\`${kind}\`) → \`${punishment}\``).catch(() => {});
        }
      }).catch(() => {});
    }
    guild.fetchOwner().then((owner) => {
      owner.send(`Antinuke on **${guild.name}**: <@${executorId}> exceeded ${kind} threshold. Punish: ${punishment}`).catch(() => {});
    }).catch(() => {});
  }

  function register(registry) {
    registry.register({
      name: 'antinuke',
      description: 'Configure antinuke (owner/admin)',
      module: 'security',
      ownerOnly: false,
      options: [
        { name: 'action', description: 'on|off|status|config|list|whitelist|admin|module', type: 3, required: true },
        { name: 'module', description: 'ban|kick|channel|role|webhook|emoji|botadd|vanity', type: 3, required: false },
        { name: 'value', description: 'on|off or user id / threshold', type: 3, required: false },
        { name: 'threshold', description: 'Action threshold', type: 4, required: false },
        { name: 'punishment', description: 'timeout|kick|ban|stripstaff', type: 3, required: false },
      ],
      async run(ctx) {
        if (!canConfigure(ctx.guild, ctx.user.id)) {
          return ctx.reply('Owner or antinuke admin only.');
        }
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'status').toLowerCase();
        const cfg = config.get(ctx.guild.id);
        const an = cfg.security.antinuke;

        if (action === 'on') {
          config.update(ctx.guild.id, (c) => {
            c.security.enabled = true;
            c.security.antinuke.enabled = true;
            const th = ctx.getInteger?.('threshold') ?? (ctx.args?.[1] ? Number(ctx.args[1]) : null);
            if (th) c.security.antinuke.threshold = th;
            const p = ctx.getString?.('punishment') || ctx.args?.[2];
            if (p) c.security.antinuke.punishment = p;
            // enable all modules by default
            for (const k of MODULE_KEYS) c.security.antinuke.modules[k] = true;
            return c;
          });
          return ctx.reply('Antinuke **enabled** (all modules on).');
        }
        if (action === 'off') {
          config.update(ctx.guild.id, (c) => { c.security.antinuke.enabled = false; return c; });
          return ctx.reply('Antinuke **disabled**.');
        }
        if (action === 'config' || action === 'status') {
          const mods = Object.entries(an.modules || {})
            .map(([k, v]) => `${k}=${v ? 'on' : 'off'}`)
            .join(', ');
          return ctx.reply(
            [
              `**Antinuke** ${an.enabled ? 'ON' : 'OFF'}`,
              `threshold=${an.threshold} window=${an.windowMs}ms punish=\`${an.punishment}\``,
              `whitelist=${(an.whitelist || []).length} admins=${(an.admins || []).length}`,
              `modules: ${mods}`,
            ].join('\n'),
          );
        }
        if (action === 'list') {
          const wl = (an.whitelist || []).map((id) => `<@${id}>`).join(', ') || '(none)';
          const adm = (an.admins || []).map((id) => `<@${id}>`).join(', ') || '(none)';
          return ctx.reply(`**Whitelist:** ${wl}\n**Admins:** ${adm}`);
        }
        if (action === 'whitelist') {
          const user = ctx.getUser?.('value') || ctx.message?.mentions?.users?.first?.();
          const id = user?.id || ctx.getString?.('value') || ctx.args?.[1];
          if (!id) return ctx.reply('Usage: ,antinuke whitelist @user');
          const uid = String(id).replace(/[<@!>]/g, '');
          config.update(ctx.guild.id, (c) => {
            const list = c.security.antinuke.whitelist || [];
            if (list.includes(uid)) {
              c.security.antinuke.whitelist = list.filter((x) => x !== uid);
            } else {
              list.push(uid);
              c.security.antinuke.whitelist = list;
            }
            return c;
          });
          return ctx.reply(`Toggled antinuke whitelist for <@${uid}>.`);
        }
        if (action === 'admin') {
          if (!isGuildOwner(ctx.guild, ctx.user.id)) return ctx.reply('Only owner can set antinuke admins.');
          const user = ctx.getUser?.('value') || ctx.message?.mentions?.users?.first?.();
          const id = user?.id || ctx.getString?.('value') || ctx.args?.[1];
          if (!id) return ctx.reply('Usage: ,antinuke admin @user');
          const uid = String(id).replace(/[<@!>]/g, '');
          config.update(ctx.guild.id, (c) => {
            const list = c.security.antinuke.admins || [];
            if (list.includes(uid)) c.security.antinuke.admins = list.filter((x) => x !== uid);
            else { list.push(uid); c.security.antinuke.admins = list; }
            return c;
          });
          return ctx.reply(`Toggled antinuke admin for <@${uid}>.`);
        }
        if (action === 'module' || MODULE_KEYS.includes(action) || ['channel', 'role', 'emoji'].includes(action)) {
          let mod = (ctx.getString?.('module') || action).toLowerCase();
          if (mod === 'channel') mod = 'channelDelete';
          if (mod === 'role') mod = 'roleDelete';
          if (mod === 'emoji') mod = 'emojiDelete';
          if (mod === 'module') {
            mod = (ctx.getString?.('value') || ctx.args?.[1] || '').toLowerCase();
          }
          // alias map
          const aliases = {
            channels: 'channelDelete',
            channelcreate: 'channelCreate',
            roles: 'roleDelete',
            rolecreate: 'roleCreate',
            webhooks: 'webhook',
            bots: 'botadd',
            bot: 'botadd',
          };
          mod = aliases[mod] || mod;
          if (!MODULE_KEYS.includes(mod)) {
            return ctx.reply(`Modules: ${MODULE_KEYS.join(', ')}`);
          }
          const rawVal = (ctx.getString?.('value') || ctx.args?.[2] || ctx.args?.[1] || 'on').toLowerCase();
          const on = rawVal !== 'off' && rawVal !== 'false' && rawVal !== '0';
          config.update(ctx.guild.id, (c) => {
            c.security.antinuke.modules[mod] = on;
            if (on) {
              c.security.enabled = true;
              c.security.antinuke.enabled = true;
            }
            return c;
          });
          return ctx.reply(`Antinuke module \`${mod}\` → **${on ? 'on' : 'off'}**.`);
        }
        if (action === 'threshold') {
          const th = ctx.getInteger?.('threshold') || Number(ctx.args?.[1]);
          if (!th || th < 1) return ctx.reply('Usage: ,antinuke threshold 3');
          config.update(ctx.guild.id, (c) => { c.security.antinuke.threshold = th; return c; });
          return ctx.reply(`Threshold set to ${th}.`);
        }
        if (action === 'punishment' || action === 'punish') {
          const p = (ctx.getString?.('punishment') || ctx.getString?.('value') || ctx.args?.[1] || '').toLowerCase();
          if (!['timeout', 'kick', 'ban', 'stripstaff'].includes(p)) {
            return ctx.reply('Punishment: timeout|kick|ban|stripstaff');
          }
          config.update(ctx.guild.id, (c) => { c.security.antinuke.punishment = p; return c; });
          return ctx.reply(`Punishment → \`${p}\`.`);
        }
        return ctx.reply(
          'Usage: ,antinuke on|off|config|list|whitelist @u|admin @u|module <name> on|off|threshold N|punishment X',
        );
      },
    });
  }

  return { onAudit, register };
}

module.exports = { createAntinuke, MODULE_KEYS };
