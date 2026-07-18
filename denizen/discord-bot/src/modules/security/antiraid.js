'use strict';

const { ChannelType } = require('discord.js');
const { canRunCommand, isWhitelisted } = require('../../core/permissions');

function createAntiraid(deps) {
  const { config, hub } = deps;
  const joins = new Map();

  function joinBucket(guildId) {
    if (!joins.has(guildId)) joins.set(guildId, []);
    return joins.get(guildId);
  }

  async function lockGuild(guild) {
    for (const ch of guild.channels.cache.values()) {
      if (!ch.isTextBased?.() && ch.type !== ChannelType.GuildVoice) continue;
      try {
        await ch.permissionOverwrites.edit(guild.id, { SendMessages: false, Connect: false }, { reason: 'Denizen raid lock' });
      } catch (_) {}
    }
  }

  async function unlockGuild(guild) {
    for (const ch of guild.channels.cache.values()) {
      if (!ch.permissionOverwrites?.cache?.has(guild.id)) continue;
      try {
        await ch.permissionOverwrites.edit(guild.id, { SendMessages: null, Connect: null }, { reason: 'Denizen raid unlock' });
      } catch (_) {}
    }
  }

  async function enterRaidState(guild, reason) {
    config.update(guild.id, (c) => { c.security.antiraid.raidState = true; return c; });
    hub.emit('security.raid', { guildId: guild.id, state: true, reason });
    const cfg = config.get(guild.id);
    if (cfg.security.antiraid.massjoin.lock) await lockGuild(guild);
    const logId = cfg.security.logChannelId || cfg.logging?.channelId;
    if (logId) {
      const ch = await guild.channels.fetch(logId).catch(() => null);
      if (ch?.isTextBased?.()) await ch.send(`🚨 **Raid state ON** — ${reason}`).catch(() => {});
    }
  }

  async function applyAction(member, action, reason) {
    const fail = (err) => console.error(
      `[antiraid] ${action} failed for ${member?.user?.tag || member?.id} in ${member?.guild?.id}: ${err?.message || err}`,
    );
    if (action === 'ban') await member.ban({ reason }).catch(fail);
    else if (action === 'timeout') await member.timeout(60 * 60 * 1000, reason).catch(fail);
    else await member.kick(reason).catch(fail);
  }

  async function onMemberAdd(member) {
    const guild = member.guild;
    const cfg = config.get(guild.id);
    if (!cfg.security.enabled || !cfg.security.antiraid.enabled) return;
    if (isWhitelisted(cfg.security.antiraid.whitelist, member.id)) return;
    if (member.user.bot) return;

    const ar = cfg.security.antiraid;

    if (ar.avatar?.enabled && !member.user.avatar) {
      await applyAction(member, ar.avatar.action || 'kick', 'Antiraid: default avatar');
      hub.emit('security.antiraid', { guildId: guild.id, type: 'avatar', userId: member.id });
      return;
    }

    if (ar.age?.enabled) {
      const ageDays = (Date.now() - member.user.createdTimestamp) / 86400000;
      if (ageDays < (ar.age.minDays || 7)) {
        await applyAction(member, ar.age.action || 'kick', 'Antiraid: account too new');
        hub.emit('security.antiraid', { guildId: guild.id, type: 'age', userId: member.id });
        return;
      }
    }

    if (ar.massjoin?.enabled) {
      const now = Date.now();
      const windowMs = ar.massjoin.windowMs || 10_000;
      const arr = joinBucket(guild.id);
      arr.push(now);
      while (arr.length && now - arr[0] > windowMs) arr.shift();
      if (arr.length >= (ar.massjoin.threshold || 5)) {
        if (!ar.raidState) await enterRaidState(guild, `mass join (${arr.length} in ${windowMs}ms)`);
        if (ar.massjoin.punish) {
          await applyAction(member, ar.massjoin.action || 'kick', 'Antiraid massjoin');
        }
      }
    }

    if (ar.raidState && ar.massjoin?.punish) {
      await applyAction(member, ar.massjoin.action || 'kick', 'Joining during raid state');
    }
  }

  function register(registry) {
    registry.register({
      name: 'antiraid',
      description: 'Configure antiraid / join gate',
      module: 'security',
      ownerOnly: true,
      options: [
        { name: 'action', description: 'on|off|status|unlock|massjoin|avatar|age|whitelist', type: 3, required: true },
        { name: 'threshold', description: 'Mass-join threshold or min age days', type: 4, required: false },
        { name: 'value', description: 'on|off|kick|ban or user', type: 3, required: false },
      ],
      async run(ctx) {
        if (!canRunCommand(ctx, { ownerOnly: true }).ok) return ctx.reply('Owner only.');
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'status').toLowerCase();
        const value = (ctx.getString?.('value') || ctx.args?.[1] || '').toLowerCase();
        const th = ctx.getInteger?.('threshold');

        if (action === 'on') {
          config.update(ctx.guild.id, (c) => {
            c.security.enabled = true;
            c.security.antiraid.enabled = true;
            c.security.antiraid.massjoin.enabled = true;
            if (th) c.security.antiraid.massjoin.threshold = th;
            return c;
          });
          return ctx.reply('Antiraid **enabled** (massjoin on). Configure avatar/age with ,antiraid avatar on|off');
        }
        if (action === 'off') {
          config.update(ctx.guild.id, (c) => {
            c.security.antiraid.enabled = false;
            c.security.antiraid.raidState = false;
            return c;
          });
          return ctx.reply('Antiraid **disabled**.');
        }
        if (action === 'unlock' || action === 'state') {
          config.update(ctx.guild.id, (c) => { c.security.antiraid.raidState = false; return c; });
          await unlockGuild(ctx.guild);
          hub.emit('security.raid', { guildId: ctx.guild.id, state: false });
          return ctx.reply('Raid state **cleared**, channels unlocked.');
        }
        if (action === 'massjoin') {
          const on = value !== 'off';
          config.update(ctx.guild.id, (c) => {
            c.security.antiraid.massjoin.enabled = on;
            if (th) c.security.antiraid.massjoin.threshold = th;
            if (['kick', 'ban', 'timeout'].includes(value)) c.security.antiraid.massjoin.action = value;
            return c;
          });
          return ctx.reply(`Massjoin filter **${on ? 'on' : 'off'}**.`);
        }
        if (action === 'avatar') {
          const on = value !== 'off';
          config.update(ctx.guild.id, (c) => {
            c.security.antiraid.avatar.enabled = on;
            if (['kick', 'ban', 'timeout'].includes(value)) c.security.antiraid.avatar.action = value;
            return c;
          });
          return ctx.reply(`Default-avatar filter **${on ? 'on' : 'off'}**.`);
        }
        if (action === 'age') {
          const on = value !== 'off';
          config.update(ctx.guild.id, (c) => {
            c.security.antiraid.age.enabled = on;
            if (th) c.security.antiraid.age.minDays = th;
            if (['kick', 'ban', 'timeout'].includes(value)) c.security.antiraid.age.action = value;
            return c;
          });
          const a = config.get(ctx.guild.id).security.antiraid.age;
          return ctx.reply(`Account-age filter **${on ? 'on' : 'off'}** (min ${a.minDays}d).`);
        }
        if (action === 'whitelist') {
          const user = ctx.getUser?.('value') || ctx.message?.mentions?.users?.first?.();
          const id = user?.id || ctx.args?.[1];
          if (!id) return ctx.reply('Usage: ,antiraid whitelist @user');
          const uid = String(id).replace(/[<@!>]/g, '');
          config.update(ctx.guild.id, (c) => {
            const list = c.security.antiraid.whitelist || [];
            if (list.includes(uid)) c.security.antiraid.whitelist = list.filter((x) => x !== uid);
            else { list.push(uid); c.security.antiraid.whitelist = list; }
            return c;
          });
          return ctx.reply(`Toggled antiraid whitelist for <@${uid}>.`);
        }
        const cfg = config.get(ctx.guild.id).security.antiraid;
        return ctx.reply([
          `**Antiraid** ${cfg.enabled ? 'ON' : 'OFF'} · raidState=${cfg.raidState}`,
          `massjoin=${cfg.massjoin.enabled} th=${cfg.massjoin.threshold} action=${cfg.massjoin.action}`,
          `avatar=${cfg.avatar.enabled} age=${cfg.age.enabled} minDays=${cfg.age.minDays}`,
          `whitelist=${(cfg.whitelist || []).length}`,
        ].join('\n'));
      },
    });

    registry.register({
      name: 'recentban',
      description: 'Ban the N most recent joins (cleanup)',
      module: 'security',
      ownerOnly: true,
      options: [{ name: 'amount', description: 'How many recent members', type: 4, required: true }],
      async run(ctx) {
        if (!canRunCommand(ctx, { ownerOnly: true }).ok) return ctx.reply('Owner only.');
        const amount = ctx.getInteger?.('amount') || Number(ctx.args?.[0]) || 0;
        if (amount < 1 || amount > 50) return ctx.reply('Amount 1–50.');
        const sorted = [...ctx.guild.members.cache.values()]
          .filter((m) => !m.user.bot)
          .sort((a, b) => (b.joinedTimestamp || 0) - (a.joinedTimestamp || 0))
          .slice(0, amount);
        let n = 0;
        for (const m of sorted) {
          await m.ban({ reason: `recentban by ${ctx.user.tag}` }).then(() => { n += 1; })
            .catch((err) => console.error(`[antiraid] recentban failed for ${m.user?.tag}: ${err?.message || err}`));
        }
        return ctx.reply(`Banned ${n}/${sorted.length} recent joins.`);
      },
    });

    registry.register({
      name: 'raid',
      description: 'Ban/kick members who joined within a duration (e.g. 2h)',
      module: 'security',
      ownerOnly: true,
      options: [
        { name: 'duration', description: 'Window like 2h, 30m, 1d', type: 3, required: true },
        { name: 'action', description: 'ban or kick', type: 3, required: false },
      ],
      async run(ctx) {
        if (!canRunCommand(ctx, { ownerOnly: true }).ok) return ctx.reply('Owner only.');
        const durRaw = ctx.getString?.('duration') || ctx.args?.[0] || '';
        const action = (ctx.getString?.('action') || ctx.args?.[1] || 'ban').toLowerCase();
        const ms = parseDurationMs(durRaw);
        if (!ms) return ctx.reply('Usage: ,raid 2h ban|kick');
        const cutoff = Date.now() - ms;
        const targets = [...ctx.guild.members.cache.values()]
          .filter((m) => !m.user.bot && (m.joinedTimestamp || 0) >= cutoff);
        let n = 0;
        for (const m of targets) {
          try {
            if (action === 'kick') await m.kick(`raid cleanup by ${ctx.user.tag}`);
            else await m.ban({ reason: `raid cleanup by ${ctx.user.tag}` });
            n += 1;
          } catch (err) {
            console.error(`[antiraid] raid-cleanup ${action} failed for ${m.user?.tag}: ${err?.message || err}`);
          }
        }
        return ctx.reply(`${action}ned ${n}/${targets.length} joins in the last ${durRaw}.`);
      },
    });

    registry.register({
      name: 'lockdown',
      description: 'Lock or unlock all channels (raid tool)',
      module: 'security',
      ownerOnly: true,
      options: [{ name: 'action', description: 'on|off', type: 3, required: true }],
      async run(ctx) {
        if (!canRunCommand(ctx, { ownerOnly: true }).ok) return ctx.reply('Owner only.');
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'on').toLowerCase();
        if (action === 'off' || action === 'unlock') {
          await unlockGuild(ctx.guild);
          config.update(ctx.guild.id, (c) => { c.security.antiraid.raidState = false; return c; });
          return ctx.reply('Server **unlocked**.');
        }
        await lockGuild(ctx.guild);
        config.update(ctx.guild.id, (c) => { c.security.antiraid.raidState = true; return c; });
        return ctx.reply('Server **locked down** (send/connect denied for @everyone).');
      },
    });
  }

  return { onMemberAdd, register, unlockGuild, lockGuild };
}

function parseDurationMs(raw) {
  const s = String(raw || '').trim().toLowerCase();
  const m = s.match(/^(\d+)(s|m|h|d|w)$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2]];
  return n * unit;
}

module.exports = { createAntiraid, parseDurationMs };
