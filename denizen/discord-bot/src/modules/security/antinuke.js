'use strict';

const { canRunCommand, isGuildOwner, isWhitelisted } = require('../../core/permissions');

/**
 * Sliding-window antinuke on audit events. Off until security.enabled.
 */
function createAntinuke(deps) {
  const { config, hub } = deps;
  /** guildId -> executorId -> { counts } */
  const windows = new Map();

  function bucket(guildId, executorId) {
    if (!windows.has(guildId)) windows.set(guildId, new Map());
    const g = windows.get(guildId);
    if (!g.has(executorId)) g.set(executorId, []);
    return g.get(executorId);
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

    const mods = cfg.security.antinuke.modules || {};
    if (kind === 'ban' && !mods.ban) return;
    if (kind === 'kick' && !mods.kick) return;
    if (kind === 'channelDelete' && !mods.channelDelete) return;
    if (kind === 'roleDelete' && !mods.roleDelete) return;
    if (kind === 'webhook' && !mods.webhook) return;
    if (!['ban', 'kick', 'channelDelete', 'roleDelete', 'webhook', 'emojiDelete'].includes(kind)) return;

    const now = Date.now();
    const windowMs = cfg.security.antinuke.windowMs || 10_000;
    const threshold = cfg.security.antinuke.threshold || 3;
    const arr = bucket(guildId, executorId);
    arr.push(now);
    while (arr.length && now - arr[0] > windowMs) arr.shift();
    if (arr.length < threshold) return;

    arr.length = 0;
    const punishment = cfg.security.antinuke.punishment || 'timeout';
    console.log(`[antinuke] trip guild=${guildId} exec=${executorId} kind=${kind} do=${punishment}`);
    hub.emit('security.antinuke', { guildId, executorId, kind, punishment });
    punish(guild, executorId, punishment);
    const logId = cfg.security.logChannelId;
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
      description: 'Configure antinuke (owner)',
      module: 'security',
      ownerOnly: true,
      options: [
        { name: 'action', description: 'on|off|status', type: 3, required: true },
        { name: 'threshold', description: 'Action threshold', type: 4, required: false },
        { name: 'punishment', description: 'timeout|kick|ban|stripstaff', type: 3, required: false },
      ],
      async run(ctx) {
        const gate = canRunCommand(ctx, { ownerOnly: true });
        if (!gate.ok) return ctx.reply('Owner only.');
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'status').toLowerCase();
        const cfg = config.get(ctx.guild.id);
        if (action === 'on') {
          config.update(ctx.guild.id, (c) => {
            c.security.enabled = true;
            c.security.antinuke.enabled = true;
            const th = ctx.getInteger?.('threshold') ?? (ctx.args?.[1] ? Number(ctx.args[1]) : null);
            if (th) c.security.antinuke.threshold = th;
            const p = ctx.getString?.('punishment') || ctx.args?.[2];
            if (p) c.security.antinuke.punishment = p;
            return c;
          });
          return ctx.reply('Antinuke **enabled**.');
        }
        if (action === 'off') {
          config.update(ctx.guild.id, (c) => { c.security.antinuke.enabled = false; return c; });
          return ctx.reply('Antinuke **disabled**.');
        }
        return ctx.reply(
          `Antinuke: ${cfg.security.antinuke.enabled ? 'on' : 'off'} · threshold ${cfg.security.antinuke.threshold} · punish \`${cfg.security.antinuke.punishment}\``,
        );
      },
    });
  }

  return { onAudit, register };
}

module.exports = { createAntinuke };
