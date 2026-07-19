'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { canRunCommand } = require('../../core/permissions');
const {
  successEmbed,
  infoEmbed,
  dangerEmbed,
  baseEmbed,
  BRAND,
} = require('../../core/ui-kit');
const { SlotStore, computeEndTime } = require('./slot-store');

/**
 * Seller slots — private seller channels, pings, redeems, tickets, expiry loops.
 */
function createSlots(deps) {
  const { config, hub, client: depsClient } = deps;
  const store = new SlotStore();
  /** @type {Map<string, number>} guildId:userId → last ping ts */
  const pingCooldown = new Map();
  const PING_COOLDOWN_MS = 30_000;

  // ─── Config & staff helpers ───────────────────────────────────────────────

  function slotCfg(guildId) {
    return config.get(guildId).slots || {};
  }

  function isStaff(ctx) {
    if (!ctx?.guild) return false;
    if (canRunCommand(ctx, { permission: 'ManageGuild' }).ok) return true;
    const staffRoleId = slotCfg(ctx.guild.id).staffRoleId;
    if (staffRoleId && ctx.member?.roles?.cache?.has?.(staffRoleId)) return true;
    return false;
  }

  function denyStaff(ctx) {
    return ctx.reply({
      embeds: [dangerEmbed('Denied', 'Slot staff only — need Manage Server or the Slot-Staff role.')],
      ephemeral: true,
    }).catch(() => ctx.reply('Slot staff only.'));
  }

  function requireEnabled(ctx) {
    if (!slotCfg(ctx.guild.id).enabled) {
      ctx.reply({
        embeds: [dangerEmbed('Disabled', 'Slots are not enabled — run `,slots setup` (Administrator).')],
      });
      return false;
    }
    return true;
  }

  async function postLog(guild, embed) {
    const logId = slotCfg(guild.id).logChannelId;
    if (!logId) return;
    const log = await guild.channels.fetch(logId).catch(() => null);
    if (log?.isTextBased?.()) {
      await log.send({ embeds: [embed] }).catch(() => {});
    }
  }

  // ─── Embeds ───────────────────────────────────────────────────────────────

  function rulesEmbed() {
    return baseEmbed({
      color: BRAND.primary,
      title: 'Slot rules',
      description: [
        '• This is your private seller channel.',
        '• Use `,slotping` or `,slots ping` for @here / @everyone (limited pings).',
        '• Do not spam, scam, or violate server rules.',
        '• Staff may hold, revoke, or warn without refund.',
      ].join('\n'),
      footerExtra: 'seller slot',
    });
  }

  function slotInfoEmbed(slot, userTag) {
    const now = Math.floor(Date.now() / 1000);
    const remaining = Math.max(0, Number(slot.endtime) - now);
    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    return infoEmbed(
      `Slot · ${slot.name || 'unnamed'}`,
      `<@${slot.userId}> · <#${slot.channelId}>`,
      [
        { name: 'Owner', value: userTag || `<@${slot.userId}>`, inline: true },
        { name: 'Expires', value: `<t:${slot.endtime}:R>`, inline: true },
        { name: 'Remaining', value: `${days}d ${hours}h`, inline: true },
        { name: 'Pings left', value: `${slot.pingCount ?? 0} / ${slot.maxPings ?? 0}`, inline: true },
        { name: 'Category', value: String(slot.categoryIndex || 1), inline: true },
        { name: 'Status', value: slot.held ? '⏸ On hold' : '✅ Active', inline: true },
        { name: 'Warnings', value: String(slot.warnings || 0), inline: true },
      ],
    );
  }

  function formatHistoryEntry(h) {
    const who = h.userId ? `<@${h.userId}>` : '—';
    const ch = h.channelId ? `<#${h.channelId}>` : '—';
    return `<t:${h.at}:R> · **${h.action}** · ${who} · ${ch}${h.detail ? ` · ${h.detail}` : ''}`;
  }

  // ─── Roles & channel permissions ──────────────────────────────────────────

  function ownerOverwrites(guild, ownerId) {
    return [
      {
        id: guild.id,
        allow: [PermissionFlagsBits.ViewChannel],
        deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.MentionEveryone],
      },
      {
        id: ownerId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.MentionEveryone,
        ],
      },
    ];
  }

  async function createSlotChannel(guild, { ownerId, name, categoryIndex }) {
    const cfg = slotCfg(guild.id);
    const parentId = categoryIndex === 2 ? cfg.categoryId2 : cfg.categoryId1;
    const safeName = (name || `slot-${String(ownerId).slice(-4)}`)
      .slice(0, 100)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `slot-${String(ownerId).slice(-4)}`;
    return guild.channels.create({
      name: safeName,
      type: ChannelType.GuildText,
      parent: parentId || undefined,
      permissionOverwrites: ownerOverwrites(guild, ownerId),
      topic: `Seller slot · owner ${ownerId}`,
    });
  }

  async function giveSlotRoles(member, cfg) {
    if (!member) return;
    const ids = [cfg.slotRoleId, cfg.premiumRoleId].filter(Boolean);
    for (const id of ids) {
      await member.roles.add(id).catch(() => {});
    }
  }

  async function stripSlotRoles(member, cfg) {
    if (!member) return;
    const ids = [cfg.slotRoleId, cfg.premiumRoleId].filter(Boolean);
    for (const id of ids) {
      await member.roles.remove(id).catch(() => {});
    }
  }

  async function lockSlotChannel(channel, slot) {
    await channel.permissionOverwrites.edit(channel.guild.id, {
      SendMessages: false,
    }).catch(() => {});
    await channel.permissionOverwrites.edit(slot.userId, {
      SendMessages: false,
      MentionEveryone: false,
    }).catch(() => {});
  }

  async function applyHold(channel, slot, held) {
    if (held) {
      await channel.permissionOverwrites.edit(channel.guild.id, { SendMessages: false }).catch(() => {});
      await channel.permissionOverwrites.edit(slot.userId, { SendMessages: false }).catch(() => {});
    } else {
      await channel.permissionOverwrites.edit(slot.userId, {
        SendMessages: true,
        MentionEveryone: true,
      }).catch(() => {});
    }
    store.setHeld(channel.guild.id, channel.id, held);
  }

  // ─── Slot lifecycle ───────────────────────────────────────────────────────

  async function expireSlot(guild, slot, { reason = 'expired' } = {}) {
    const channel = await guild.channels.fetch(slot.channelId).catch(() => null);
    const member = await guild.members.fetch(slot.userId).catch(() => null);
    const cfg = slotCfg(guild.id);
    if (channel) await lockSlotChannel(channel, slot);
    if (member) await stripSlotRoles(member, cfg);
    store.removeSlot(guild.id, slot.channelId);
    store.addHistory(guild.id, reason, {
      userId: slot.userId,
      channelId: slot.channelId,
      detail: slot.name || '',
    });
    await postLog(guild, dangerEmbed(
      'Slot expired',
      `<@${slot.userId}> · <#${slot.channelId}>`,
      [{ name: 'Reason', value: reason }],
    ));
    hub.emit('slots.expire', { guildId: guild.id, channelId: slot.channelId, userId: slot.userId });
  }

  async function provisionSlot(guild, {
    user,
    amount,
    unit,
    pings,
    categoryIndex = 1,
    name,
    staffId,
    existingChannel = null,
  }) {
    const cfg = slotCfg(guild.id);
    if (!cfg.enabled) throw new Error('Slots disabled — run `,slots setup`');
    if (store.isBlacklisted(guild.id, user.id)) {
      throw new Error('User is blacklisted from slots');
    }
    const existing = store.getSlotByUser(guild.id, user.id);
    if (existing && !existingChannel) {
      throw new Error(`User already has a slot: <#${existing.channelId}>`);
    }

    const maxPings = pings ?? cfg.defaultPingCount ?? 3;
    const endtime = computeEndTime(amount, unit);
    const channel = existingChannel || await createSlotChannel(guild, {
      ownerId: user.id,
      name: name || user.username,
      categoryIndex,
    });

    const member = await guild.members.fetch(user.id).catch(() => null);
    await giveSlotRoles(member, cfg);

    const entry = {
      channelId: channel.id,
      userId: user.id,
      endtime,
      amount: Number(amount),
      unit,
      pingCount: maxPings,
      maxPings,
      categoryIndex: categoryIndex === 2 ? 2 : 1,
      name: name || user.username,
      held: false,
      warnings: 0,
      createdAt: Math.floor(Date.now() / 1000),
      createdBy: staffId || user.id,
    };
    store.upsertSlot(guild.id, entry);
    store.addHistory(guild.id, 'create', {
      userId: user.id,
      channelId: channel.id,
      detail: `${amount}${unit}`,
    });

    if (!existingChannel) {
      await channel.send({ embeds: [rulesEmbed(), slotInfoEmbed(entry, user.tag)] }).catch(() => {});
    }

    await postLog(guild, successEmbed(
      'Slot created',
      `<@${user.id}> · ${channel}`,
      [
        { name: 'Duration', value: `${amount} ${unit === 'm' ? 'months' : 'days'}`, inline: true },
        { name: 'Pings', value: String(maxPings), inline: true },
      ],
    ));

    hub.emit('slots.create', { guildId: guild.id, channelId: channel.id, userId: user.id });
    return { channel, entry };
  }

  // ─── Parsing helpers ──────────────────────────────────────────────────────

  function parseDurationTokens(args, startIdx = 0) {
    const amount = Number(args[startIdx]);
    const unit = String(args[startIdx + 1] || '').toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0 || !['d', 'm'].includes(unit)) {
      throw new Error('Invalid duration — use `<amount> d|m`');
    }
    return { amount, unit, nextIdx: startIdx + 2 };
  }

  function parseCreateTail(args) {
    let idx = 0;
    const { amount, unit, nextIdx } = parseDurationTokens(args, idx);
    idx = nextIdx;
    let pings;
    let categoryIndex = 1;
    if (args[idx] && /^\d+$/.test(args[idx]) && Number(args[idx]) > 2) {
      pings = Number(args[idx]);
      idx += 1;
    }
    if (args[idx] === '1' || args[idx] === '2') {
      categoryIndex = Number(args[idx]);
      idx += 1;
    }
    const name = args.slice(idx).join(' ').trim();
    return { amount, unit, pings, categoryIndex, name };
  }

  function resolveSlotFromCtx(ctx) {
    const mentioned = ctx.message?.mentions?.channels?.first?.();
    const ch = mentioned || ctx.channel;
    const slot = store.getSlot(ctx.guild.id, ch.id);
    return { channel: ch, slot };
  }

  // ─── User: ping ───────────────────────────────────────────────────────────

  async function runSlotPing(ctx, pingType = '') {
    if (!requireEnabled(ctx)) return;
    const slot = store.getSlot(ctx.guild.id, ctx.channel.id);
    if (!slot || String(slot.userId) !== String(ctx.user.id)) {
      return ctx.reply({
        embeds: [dangerEmbed('Denied', 'You can only ping from your own slot channel.')],
        ephemeral: true,
      });
    }
    if (slot.held) {
      return ctx.reply({ embeds: [dangerEmbed('On hold', 'Your slot is on hold — contact staff.')] });
    }
    const cdKey = `${ctx.guild.id}:${ctx.user.id}`;
    const last = pingCooldown.get(cdKey) || 0;
    if (Date.now() - last < PING_COOLDOWN_MS) {
      const wait = Math.ceil((PING_COOLDOWN_MS - (Date.now() - last)) / 1000);
      return ctx.reply({ embeds: [dangerEmbed('Cooldown', `Wait **${wait}s** before pinging again.`)] });
    }
    const left = Number(slot.pingCount) || 0;
    if (left <= 0) {
      return ctx.reply({ embeds: [dangerEmbed('No pings', 'You have no pings remaining this period.')] });
    }

    const mode = (pingType || ctx.args?.[0] || 'here').toLowerCase();
    const mention = mode === 'everyone' ? '@everyone' : '@here';
    slot.pingCount = left - 1;
    store.upsertSlot(ctx.guild.id, slot);
    pingCooldown.set(cdKey, Date.now());

    await ctx.channel.send({
      content: mention,
      embeds: [infoEmbed('Slot ping', `<@${ctx.user.id}> · **${left - 1}** pings left`)],
    }).catch(() => {});

    if (ctx.message?.deletable) {
      await ctx.message.delete().catch(() => {});
    }

    return ctx.reply({
      embeds: [successEmbed('Ping sent', `${mention} · **${left - 1}** remaining`)],
    }).catch(() => {});
  }

  // ─── User: redeem ─────────────────────────────────────────────────────────

  async function runSlotRedeem(ctx, codeArg) {
    if (!requireEnabled(ctx)) return;
    const code = (codeArg || ctx.args?.[0] || '').trim();
    if (!code) {
      return ctx.reply({ embeds: [dangerEmbed('Usage', '`,slotredeem <code>`')] });
    }
    if (store.isBlacklisted(ctx.guild.id, ctx.user.id)) {
      return ctx.reply({ embeds: [dangerEmbed('Blacklisted', 'You cannot redeem slots.')] });
    }
    const result = store.redeemCode(ctx.guild.id, ctx.user.id, code);
    if (result.error) {
      const msg = {
        not_found: 'Invalid redeem code.',
        already_redeemed: 'You already redeemed this code.',
        exhausted: 'This code has no uses left.',
      }[result.error] || result.error;
      return ctx.reply({ embeds: [dangerEmbed('Redeem failed', msg)] });
    }
    try {
      const { channel } = await provisionSlot(ctx.guild, {
        user: ctx.user,
        amount: result.duration,
        unit: result.unit,
        pings: result.pings,
        categoryIndex: result.categoryIndex,
        name: ctx.user.username,
        staffId: result.createdBy,
      });
      store.addHistory(ctx.guild.id, 'redeem', {
        userId: ctx.user.id,
        channelId: channel.id,
        detail: code,
      });
      return ctx.reply({
        embeds: [successEmbed('Redeemed', `Your slot is ready: ${channel}`)],
      });
    } catch (err) {
      return ctx.reply({ embeds: [dangerEmbed('Redeem failed', err.message)] });
    }
  }

  // ─── Staff / hub actions ──────────────────────────────────────────────────

  async function runSlotsAction(ctx, action, args) {
    const act = (action || 'list').toLowerCase();
    const cfg = slotCfg(ctx.guild.id);
    const staffActions = new Set([
      'setup', 'create', 'renew', 'extend', 'transfer', 'revoke', 'hold', 'unhold',
      'delete', 'warn', 'blacklist', 'unblacklist', 'announce', 'ticket', 'createredeem',
      'redeems', 'deleteredeem', 'history',
    ]);
    const publicActions = new Set(['list', 'info', 'leaderboard', 'ping']);

    if (act !== 'setup' && !publicActions.has(act) && staffActions.has(act)) {
      if (!isStaff(ctx)) return denyStaff(ctx);
    }
    if (act !== 'setup' && !requireEnabled(ctx)) return;

    // ── setup ──
    if (act === 'setup') {
      if (!canRunCommand(ctx, { permission: 'Administrator' }).ok) {
        return ctx.reply('Need **Administrator** for slot setup.');
      }
      store.ensure(ctx.guild.id);

      let cat1 = cfg.categoryId1 ? await ctx.guild.channels.fetch(cfg.categoryId1).catch(() => null) : null;
      let cat2 = cfg.categoryId2 ? await ctx.guild.channels.fetch(cfg.categoryId2).catch(() => null) : null;
      if (!cat1) {
        cat1 = await ctx.guild.channels.create({ name: 'Slots-1', type: ChannelType.GuildCategory });
      }
      if (!cat2) {
        cat2 = await ctx.guild.channels.create({ name: 'Slots-2', type: ChannelType.GuildCategory });
      }

      let log = cfg.logChannelId ? await ctx.guild.channels.fetch(cfg.logChannelId).catch(() => null) : null;
      if (!log) {
        log = await ctx.guild.channels.create({
          name: 'slot-logs',
          type: ChannelType.GuildText,
          parent: cat1.id,
          permissionOverwrites: [
            { id: ctx.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          ],
        });
      }

      async function ensureRole(name, existingId) {
        if (existingId) {
          const r = await ctx.guild.roles.fetch(existingId).catch(() => null);
          if (r) return r;
        }
        return ctx.guild.roles.create({ name, mentionable: false });
      }

      const staffRole = await ensureRole('Slot-Staff', cfg.staffRoleId);
      const holderRole = await ensureRole('Slot-Holder', cfg.slotRoleId);
      const premiumRole = await ensureRole('Slot-Premium', cfg.premiumRoleId);

      config.update(ctx.guild.id, (c) => {
        c.slots = c.slots || {};
        c.slots.enabled = true;
        c.slots.categoryId1 = cat1.id;
        c.slots.categoryId2 = cat2.id;
        c.slots.logChannelId = log.id;
        c.slots.staffRoleId = staffRole.id;
        c.slots.slotRoleId = holderRole.id;
        c.slots.premiumRoleId = premiumRole.id;
        c.slots.defaultPingCount = c.slots.defaultPingCount ?? 3;
        c.slots.pingResetHours = c.slots.pingResetHours ?? 24;
        return c;
      });

      return ctx.reply({
        embeds: [successEmbed(
          'Slots ready',
          [
            `Categories: ${cat1} · ${cat2}`,
            `Logs: ${log}`,
            `Roles: ${staffRole} · ${holderRole} · ${premiumRole}`,
            'Set ticket category: `,slots ticket` after configuring `ticketCategoryId`.',
          ].join('\n'),
        )],
      });
    }

    // ── create ──
    if (act === 'create') {
      const user = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
      if (!user) return ctx.reply('Usage: `,slots create @user <amount> d|m [pings] [1|2] [name]`');
      const tail = args.length ? args : ctx.args?.slice(ctx.message?.mentions?.users?.size ? 1 : 0) || [];
      const mentionSkip = ctx.message?.mentions?.users?.size ? 1 : 0;
      const rest = ctx.args?.slice(mentionSkip) || tail;
      try {
        const parsed = parseCreateTail(rest);
        const { channel } = await provisionSlot(ctx.guild, {
          user,
          ...parsed,
          staffId: ctx.user.id,
        });
        return ctx.reply({
          embeds: [successEmbed('Slot created', `${channel} for <@${user.id}>`)],
        });
      } catch (err) {
        return ctx.reply({ embeds: [dangerEmbed('Create failed', err.message)] });
      }
    }

    // ── renew ──
    if (act === 'renew') {
      const user = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
      const ch = ctx.message?.mentions?.channels?.first?.();
      if (!user || !ch) {
        return ctx.reply('Usage: `,slots renew @user #channel <amount> d|m`');
      }
      const slot = store.getSlot(ctx.guild.id, ch.id);
      if (!slot || String(slot.userId) !== String(user.id)) {
        return ctx.reply({ embeds: [dangerEmbed('Not found', 'That user does not own that slot channel.')] });
      }
      const mentionSkip = (ctx.message?.mentions?.users?.size ? 1 : 0) + (ctx.message?.mentions?.channels?.size ? 1 : 0);
      try {
        const { amount, unit } = parseDurationTokens(ctx.args || [], mentionSkip);
        slot.endtime = computeEndTime(amount, unit);
        slot.amount = amount;
        slot.unit = unit;
        store.upsertSlot(ctx.guild.id, slot);
        store.addHistory(ctx.guild.id, 'renew', { userId: user.id, channelId: ch.id, detail: `${amount}${unit}` });
        await postLog(ctx.guild, successEmbed('Slot renewed', `<@${user.id}> · ${ch}`));
        return ctx.reply({ embeds: [successEmbed('Renewed', `<@${user.id}> · ${ch} · <t:${slot.endtime}:R>`)] });
      } catch (err) {
        return ctx.reply({ embeds: [dangerEmbed('Renew failed', err.message)] });
      }
    }

    // ── extend ──
    if (act === 'extend') {
      const user = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
      if (!user) return ctx.reply('Usage: `,slots extend @user <amount> d|m`');
      const slot = store.getSlotByUser(ctx.guild.id, user.id);
      if (!slot) return ctx.reply({ embeds: [dangerEmbed('Not found', 'User has no slot.')] });
      const mentionSkip = ctx.message?.mentions?.users?.size ? 1 : 0;
      try {
        const { amount, unit } = parseDurationTokens(ctx.args || [], mentionSkip);
        const addSec = unit === 'd' ? amount * 86400 : amount * 30 * 86400;
        slot.endtime = Number(slot.endtime) + addSec;
        store.upsertSlot(ctx.guild.id, slot);
        store.addHistory(ctx.guild.id, 'extend', { userId: user.id, channelId: slot.channelId, detail: `+${amount}${unit}` });
        return ctx.reply({ embeds: [successEmbed('Extended', `<@${user.id}> · <t:${slot.endtime}:R>`)] });
      } catch (err) {
        return ctx.reply({ embeds: [dangerEmbed('Extend failed', err.message)] });
      }
    }

    // ── transfer ──
    if (act === 'transfer') {
      const users = [...(ctx.message?.mentions?.users?.values?.() || [])];
      const from = users[0] || ctx.getUser?.('from');
      const to = users[1] || ctx.getUser?.('to');
      if (!from || !to) return ctx.reply('Usage: `,slots transfer @from @to`');
      const slot = store.getSlotByUser(ctx.guild.id, from.id);
      if (!slot) return ctx.reply({ embeds: [dangerEmbed('Not found', 'Source user has no slot.')] });
      if (store.getSlotByUser(ctx.guild.id, to.id)) {
        return ctx.reply({ embeds: [dangerEmbed('Conflict', 'Target user already has a slot.')] });
      }
      const channel = await ctx.guild.channels.fetch(slot.channelId).catch(() => null);
      if (!channel) return ctx.reply('Slot channel missing.');
      const cfgNow = slotCfg(ctx.guild.id);
      const oldMember = await ctx.guild.members.fetch(from.id).catch(() => null);
      const newMember = await ctx.guild.members.fetch(to.id).catch(() => null);
      await channel.permissionOverwrites.delete(from.id).catch(() => {});
      await channel.permissionOverwrites.edit(to.id, {
        ViewChannel: true,
        SendMessages: true,
        MentionEveryone: true,
      }).catch(() => {});
      await stripSlotRoles(oldMember, cfgNow);
      await giveSlotRoles(newMember, cfgNow);
      slot.userId = to.id;
      store.upsertSlot(ctx.guild.id, slot);
      store.addHistory(ctx.guild.id, 'transfer', {
        userId: to.id,
        channelId: slot.channelId,
        detail: `${from.id}→${to.id}`,
      });
      await postLog(ctx.guild, infoEmbed('Slot transferred', `${channel} · <@${from.id}> → <@${to.id}>`));
      return ctx.reply({ embeds: [successEmbed('Transferred', `${channel} → <@${to.id}>`)] });
    }

    // ── revoke ──
    if (act === 'revoke') {
      const user = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
      const chMention = ctx.message?.mentions?.channels?.first?.();
      let slot = chMention ? store.getSlot(ctx.guild.id, chMention.id) : null;
      if (!slot && user) slot = store.getSlotByUser(ctx.guild.id, user.id);
      if (!slot) return ctx.reply({ embeds: [dangerEmbed('Not found', 'No slot for that user/channel.')] });
      const channel = await ctx.guild.channels.fetch(slot.channelId).catch(() => null);
      const member = await ctx.guild.members.fetch(slot.userId).catch(() => null);
      if (channel) await lockSlotChannel(channel, slot);
      await stripSlotRoles(member, cfg);
      store.removeSlot(ctx.guild.id, slot.channelId);
      store.addHistory(ctx.guild.id, 'revoke', { userId: slot.userId, channelId: slot.channelId });
      await postLog(ctx.guild, dangerEmbed('Slot revoked', `<@${slot.userId}> · <#${slot.channelId}>`));
      return ctx.reply({ embeds: [successEmbed('Revoked', `<@${slot.userId}> · channel kept locked`)] });
    }

    // ── hold / unhold ──
    if (act === 'hold' || act === 'unhold') {
      const { channel, slot } = resolveSlotFromCtx(ctx);
      if (!slot) {
        return ctx.reply({ embeds: [dangerEmbed('Not a slot', 'Run this in a slot channel or mention one.')] });
      }
      await applyHold(channel, slot, act === 'hold');
      store.addHistory(ctx.guild.id, act, { userId: slot.userId, channelId: channel.id });
      return ctx.reply({
        embeds: [successEmbed(act === 'hold' ? 'On hold' : 'Released', `<#${channel.id}>`)],
      });
    }

    // ── delete ──
    if (act === 'delete') {
      const { channel, slot } = resolveSlotFromCtx(ctx);
      if (!slot) {
        return ctx.reply({ embeds: [dangerEmbed('Not a slot', 'Run this in a slot channel or mention one.')] });
      }
      const member = await ctx.guild.members.fetch(slot.userId).catch(() => null);
      await stripSlotRoles(member, cfg);
      store.removeSlot(ctx.guild.id, channel.id);
      store.addHistory(ctx.guild.id, 'delete', { userId: slot.userId, channelId: channel.id });
      await postLog(ctx.guild, dangerEmbed('Slot deleted', `<@${slot.userId}> · ${channel.name}`));
      await channel.delete('Slot deleted by staff').catch(() => {});
      return ctx.reply({ embeds: [successEmbed('Deleted', 'Slot channel removed.')] });
    }

    // ── nuke ──
    if (act === 'nuke') {
      return runSlotNuke(ctx);
    }

    // ── list ──
    if (act === 'list') {
      const slots = store.listSlots(ctx.guild.id);
      if (!slots.length) return ctx.reply({ embeds: [infoEmbed('Slots', 'No active slots.')] });
      const lines = slots.slice(0, 25).map((s) => {
        const st = s.held ? '⏸' : '✅';
        return `${st} <#${s.channelId}> · <@${s.userId}> · <t:${s.endtime}:R>`;
      });
      return ctx.reply({ embeds: [infoEmbed('Active slots', lines.join('\n'))] });
    }

    // ── info ──
    if (act === 'info') {
      const user = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
      const ch = ctx.message?.mentions?.channels?.first?.();
      let slot = ch ? store.getSlot(ctx.guild.id, ch.id) : null;
      if (!slot && user) slot = store.getSlotByUser(ctx.guild.id, user.id);
      if (!slot && !isStaff(ctx)) slot = store.getSlotByUser(ctx.guild.id, ctx.user.id);
      if (!slot) return ctx.reply({ embeds: [dangerEmbed('Not found', 'No slot to show.')] });
      if (!isStaff(ctx) && String(slot.userId) !== String(ctx.user.id)) {
        return ctx.reply({ embeds: [dangerEmbed('Denied', 'You can only view your own slot.')] });
      }
      const owner = await ctx.client.users.fetch(slot.userId).catch(() => null);
      return ctx.reply({ embeds: [slotInfoEmbed(slot, owner?.tag || slot.userId)] });
    }

    // ── warn ──
    if (act === 'warn') {
      const user = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
      if (!user) return ctx.reply('Usage: `,slots warn @user [reason]`');
      const mentionSkip = ctx.message?.mentions?.users?.size ? 1 : 0;
      const reason = (ctx.args || []).slice(mentionSkip).join(' ').trim() || 'No reason given';
      const count = store.warnUser(ctx.guild.id, user.id);
      if (!count) return ctx.reply({ embeds: [dangerEmbed('Not found', 'User has no slot.')] });
      store.addHistory(ctx.guild.id, 'warn', { userId: user.id, detail: reason });
      await user.send({
        embeds: [dangerEmbed('Slot warning', reason, [{ name: 'Total warnings', value: String(count) }])],
      }).catch(() => {});
      return ctx.reply({ embeds: [successEmbed('Warned', `<@${user.id}> · **${count}** warning(s)`)] });
    }

    // ── blacklist / unblacklist ──
    if (act === 'blacklist') {
      const user = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
      if (!user) return ctx.reply('Usage: `,slots blacklist @user [reason]`');
      const mentionSkip = ctx.message?.mentions?.users?.size ? 1 : 0;
      const reason = (ctx.args || []).slice(mentionSkip).join(' ').trim() || '';
      store.setBlacklist(ctx.guild.id, user.id, { reason, by: ctx.user.id });
      store.addHistory(ctx.guild.id, 'blacklist', { userId: user.id, detail: reason });
      return ctx.reply({ embeds: [successEmbed('Blacklisted', `<@${user.id}>`)] });
    }

    if (act === 'unblacklist') {
      const user = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
      if (!user) return ctx.reply('Usage: `,slots unblacklist @user`');
      store.clearBlacklist(ctx.guild.id, user.id);
      store.addHistory(ctx.guild.id, 'unblacklist', { userId: user.id });
      return ctx.reply({ embeds: [successEmbed('Unblacklisted', `<@${user.id}>`)] });
    }

    // ── announce ──
    if (act === 'announce') {
      const text = (args.length ? args.join(' ') : ctx.args?.join(' ')) || 'Slot announcement';
      return ctx.channel.send({
        embeds: [baseEmbed({ color: BRAND.primary, title: 'Slots', description: text.slice(0, 4000) })],
      }).then(() => ctx.reply({ embeds: [successEmbed('Posted', 'Announcement sent.')] }))
        .catch((err) => ctx.reply({ embeds: [dangerEmbed('Failed', err.message)] }));
    }

    // ── ticket panel ──
    if (act === 'ticket') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('slots:ticket:create')
          .setLabel('Open slot ticket')
          .setStyle(ButtonStyle.Primary),
      );
      await ctx.channel.send({
        embeds: [infoEmbed(
          'Slot support',
          'Need help with your slot? Open a private ticket — one per user.',
        )],
        components: [row],
      });
      return ctx.reply({ embeds: [successEmbed('Panel posted', 'Pin this for slot support.')] });
    }

    // ── redeems ──
    if (act === 'createredeem') {
      try {
        const { amount, unit, nextIdx } = parseDurationTokens(ctx.args || [], 0);
        const pings = Number(ctx.args?.[nextIdx]) || cfg.defaultPingCount || 3;
        const catIdx = ctx.args?.[nextIdx + 1] === '2' ? 2 : 1;
        const maxUses = Number(ctx.args?.[nextIdx + 2]) || 1;
        const redeem = store.createRedeem(ctx.guild.id, {
          duration: amount,
          unit,
          pings,
          categoryIndex: catIdx,
          maxUses,
          createdBy: ctx.user.id,
        });
        return ctx.reply({
          embeds: [successEmbed('Redeem code', `\`${redeem.code}\``, [
            { name: 'Duration', value: `${amount}${unit}`, inline: true },
            { name: 'Pings', value: String(pings), inline: true },
            { name: 'Uses', value: String(maxUses), inline: true },
          ])],
          ephemeral: true,
        }).catch(() => ctx.reply(`Code: \`${redeem.code}\``));
      } catch (err) {
        return ctx.reply({ embeds: [dangerEmbed('Failed', err.message)] });
      }
    }

    if (act === 'redeems') {
      const list = store.listRedeems(ctx.guild.id);
      if (!list.length) return ctx.reply({ embeds: [infoEmbed('Redeems', 'No codes.')] });
      const lines = list.slice(0, 20).map((r) =>
        `\`${r.code}\` · ${r.duration}${r.unit} · pings ${r.pings} · ${r.uses}/${r.maxUses}`,
      );
      return ctx.reply({ embeds: [infoEmbed('Redeem codes', lines.join('\n'))] });
    }

    if (act === 'deleteredeem') {
      const code = (args[0] || ctx.args?.[0] || '').trim();
      if (!code) return ctx.reply('Usage: `,slots deleteredeem <code>`');
      const prev = store.deleteRedeem(ctx.guild.id, code);
      if (!prev) return ctx.reply({ embeds: [dangerEmbed('Not found', 'Unknown code.')] });
      return ctx.reply({ embeds: [successEmbed('Deleted', `\`${code}\``)] });
    }

    // ── history / leaderboard ──
    if (act === 'history') {
      const limit = Number(args[0] || ctx.args?.[0]) || 15;
      const hist = store.getHistory(ctx.guild.id, limit);
      if (!hist.length) return ctx.reply({ embeds: [infoEmbed('History', 'Empty.')] });
      return ctx.reply({
        embeds: [infoEmbed('Slot history', hist.map(formatHistoryEntry).join('\n').slice(0, 4000))],
      });
    }

    if (act === 'leaderboard') {
      const board = store.leaderboard(ctx.guild.id).slice(0, 15);
      if (!board.length) return ctx.reply({ embeds: [infoEmbed('Leaderboard', 'No slots.')] });
      const lines = board.map((s, i) => {
        const rem = Math.floor(s.remaining / 86400);
        return `**${i + 1}.** <@${s.userId}> · ${rem}d left · pings ${s.pingCount}/${s.maxPings}`;
      });
      return ctx.reply({ embeds: [infoEmbed('Slot leaderboard', lines.join('\n'))] });
    }

    // ── ping (hub alias) ──
    if (act === 'ping') {
      return runSlotPing(ctx, args[0] || ctx.args?.[0]);
    }

    return ctx.reply({
      embeds: [dangerEmbed('Unknown action', 'Try `,slots list` or `,slots setup`.')],
    });
  }

  async function runSlotNuke(ctx) {
    const { channel, slot } = resolveSlotFromCtx(ctx);
    if (!slot) {
      return ctx.reply({ embeds: [dangerEmbed('Not a slot', 'Run in a slot channel or mention one.')] });
    }
    const isOwner = String(slot.userId) === String(ctx.user.id);
    if (!isOwner && !isStaff(ctx)) {
      return ctx.reply({ embeds: [dangerEmbed('Denied', 'Only the slot owner or staff can nuke.')] });
    }
    try {
      const msgs = await channel.messages.fetch({ limit: 100 });
      const deletable = msgs.filter((m) => {
        if (m.author.id === ctx.client.user.id && m.embeds?.length) return false;
        const age = Date.now() - m.createdTimestamp;
        return age < 14 * 86400_000;
      });
      if (deletable.size > 1) {
        await channel.bulkDelete(deletable, true).catch(async () => {
          for (const m of deletable.values()) {
            await m.delete().catch(() => {});
          }
        });
      } else {
        for (const m of deletable.values()) {
          await m.delete().catch(() => {});
        }
      }
      store.addHistory(ctx.guild.id, 'nuke', { userId: ctx.user.id, channelId: channel.id });
      return ctx.reply({ embeds: [successEmbed('Nuked', `Cleared up to **${deletable.size}** messages.`)] });
    } catch (err) {
      return ctx.reply({ embeds: [dangerEmbed('Nuke failed', err.message)] });
    }
  }

  async function runMySlot(ctx) {
    if (!requireEnabled(ctx)) return;
    const slot = store.getSlotByUser(ctx.guild.id, ctx.user.id);
    if (!slot) {
      return ctx.reply({ embeds: [infoEmbed('No slot', 'You do not have an active seller slot.')] });
    }
    return ctx.reply({ embeds: [slotInfoEmbed(slot, ctx.user.tag)] });
  }

  // ─── Tickets (interaction) ──────────────────────────────────────────────────

  async function openSlotTicket(guild, user) {
    const cfg = slotCfg(guild.id);
    if (!cfg.ticketCategoryId) throw new Error('Ticket category not set — configure `ticketCategoryId` in slots config');
    const existing = store.getTicketByUser(guild.id, user.id);
    if (existing) throw new Error(`You already have a ticket: <#${existing.channelId}>`);

    const overwrites = [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
      },
      {
        id: guild.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ];
    if (cfg.staffRoleId) {
      overwrites.push({
        id: cfg.staffRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      });
    }

    const ch = await guild.channels.create({
      name: `slot-${user.username}`.slice(0, 90).toLowerCase().replace(/[^a-z0-9-]/g, ''),
      type: ChannelType.GuildText,
      parent: cfg.ticketCategoryId,
      permissionOverwrites: overwrites,
      topic: `Slot ticket · ${user.tag}`,
    });

    store.openTicket(guild.id, user.id, ch.id);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('slots:ticket:close')
        .setLabel('Close ticket')
        .setStyle(ButtonStyle.Danger),
    );

    await ch.send({
      content: `<@${user.id}>`,
      embeds: [infoEmbed('Slot ticket', 'Describe your issue — staff will respond shortly.')],
      components: [row],
    });

    hub.emit('slots.ticket.open', { guildId: guild.id, channelId: ch.id, userId: user.id });
    return ch;
  }

  async function closeSlotTicket(guild, channel, closer) {
    const ticket = store.load(guild.id).tickets[String(channel.id)];
    if (!ticket) throw new Error('Not a slot ticket channel');

    let transcript = `Slot ticket · ${channel.name}\nOpener: ${ticket.userId}\nClosed by: ${closer?.tag || closer?.id || 'system'}\n\n`;
    try {
      const msgs = await channel.messages.fetch({ limit: 15 });
      const ordered = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      for (const m of ordered) {
        transcript += `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content}\n`;
      }
    } catch (_) { /* ignore */ }

    await channel.send({
      embeds: [infoEmbed('Closing', 'This ticket will be deleted in a few seconds.')],
    }).catch(() => {});

    const opener = await guild.client.users.fetch(ticket.userId).catch(() => null);
    if (opener) {
      await opener.send({
        embeds: [infoEmbed('Ticket closed', transcript.slice(0, 4000))],
      }).catch(() => {});
    }

    store.closeTicket(guild.id, channel.id);
    hub.emit('slots.ticket.close', { guildId: guild.id, channelId: channel.id, userId: ticket.userId });

    setTimeout(() => {
      channel.delete('Slot ticket closed').catch(() => {});
    }, 3000).unref?.();
  }

  // ─── register ─────────────────────────────────────────────────────────────

  function register(registry) {
    registry.register({
      name: 'slots',
      description: 'Seller slots — setup, create, renew, ping, redeems, tickets',
      module: 'slots',
      public: true,
      options: [
        {
          name: 'action',
          description: 'setup|create|renew|list|info|ping|leaderboard|…',
          type: 3,
          required: true,
        },
      ],
      async run(ctx) {
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'list').toLowerCase();
        const rest = ctx.args?.slice(1) || [];
        return runSlotsAction(ctx, action, rest);
      },
    });

    registry.register({
      name: 'myslot',
      description: 'View your seller slot',
      module: 'slots',
      public: true,
      async run(ctx) {
        return runMySlot(ctx);
      },
    });

    registry.register({
      name: 'slotinfo',
      description: 'Slot info (yours or staff: @user / #channel)',
      aliases: ['sinfo'],
      module: 'slots',
      public: true,
      slash: false,
      async run(ctx) {
        if (!requireEnabled(ctx)) return;
        return runSlotsAction(ctx, 'info', ctx.args || []);
      },
    });

    registry.register({
      name: 'slotping',
      description: 'Ping @here or @everyone from your slot',
      module: 'slots',
      public: true,
      options: [
        { name: 'type', description: 'here or everyone', type: 3, required: false },
      ],
      async run(ctx) {
        return runSlotPing(ctx, ctx.getString?.('type') || ctx.args?.[0]);
      },
    });

    registry.register({
      name: 'slotredeem',
      description: 'Redeem a slot code',
      module: 'slots',
      public: true,
      options: [
        { name: 'code', description: 'Redeem code', type: 3, required: true },
      ],
      async run(ctx) {
        return runSlotRedeem(ctx, ctx.getString?.('code') || ctx.args?.[0]);
      },
    });

    const staffAlias = (name, action, desc) => {
      registry.register({
        name,
        description: desc,
        module: 'slots',
        slash: false,
        async run(ctx) {
          if (!isStaff(ctx)) return denyStaff(ctx);
          return runSlotsAction(ctx, action, ctx.args || []);
        },
      });
    };

    staffAlias('screate', 'create', 'Create a seller slot (staff)');
    staffAlias('srenew', 'renew', 'Renew a slot (staff)');
    staffAlias('sextend', 'extend', 'Extend a slot (staff)');
    staffAlias('stransfer', 'transfer', 'Transfer slot ownership (staff)');
    staffAlias('srevoke', 'revoke', 'Revoke a slot (staff)');
    staffAlias('shold', 'hold', 'Hold a slot channel (staff)');
    staffAlias('sunhold', 'unhold', 'Release a held slot (staff)');
    staffAlias('slotcreateredeem', 'createredeem', 'Create a slot redeem code (staff)');

    registry.register({
      name: 'slotnuke',
      description: 'Purge messages in a slot channel',
      module: 'slots',
      slash: false,
      async run(ctx) {
        if (!requireEnabled(ctx)) return;
        return runSlotNuke(ctx);
      },
    });
  }

  // ─── onInteraction ────────────────────────────────────────────────────────

  async function onInteraction(interaction) {
    if (!interaction.guild || !interaction.isButton()) return false;
    const id = interaction.customId || '';
    if (!id.startsWith('slots:ticket:')) return false;

    if (id === 'slots:ticket:create') {
      try {
        await interaction.deferReply({ ephemeral: true });
        const ch = await openSlotTicket(interaction.guild, interaction.user);
        await interaction.editReply({
          embeds: [successEmbed('Ticket opened', `${ch} — staff will assist you.`)],
        });
      } catch (err) {
        if (interaction.deferred) {
          await interaction.editReply({ embeds: [dangerEmbed('Failed', err.message)] }).catch(() => {});
        } else {
          await interaction.reply({ embeds: [dangerEmbed('Failed', err.message)], ephemeral: true }).catch(() => {});
        }
      }
      return true;
    }

    if (id === 'slots:ticket:close') {
      const ticket = store.load(interaction.guild.id).tickets[String(interaction.channel.id)];
      const staff = isStaff({
        guild: interaction.guild,
        member: interaction.member,
        user: interaction.user,
        config,
      });
      const opener = ticket && String(ticket.userId) === String(interaction.user.id);
      if (!staff && !opener) {
        await interaction.reply({
          embeds: [dangerEmbed('Denied', 'Only the opener or slot staff can close.')],
          ephemeral: true,
        }).catch(() => {});
        return true;
      }
      try {
        await interaction.reply({
          embeds: [infoEmbed('Closing', 'Saving transcript…')],
          ephemeral: true,
        });
        await closeSlotTicket(interaction.guild, interaction.channel, interaction.user);
      } catch (err) {
        await interaction.reply({
          embeds: [dangerEmbed('Close failed', err.message)],
          ephemeral: true,
        }).catch(() => {});
      }
      return true;
    }

    return false;
  }

  // ─── startLoops ───────────────────────────────────────────────────────────

  function startLoops(client) {
    const cli = client || depsClient;
    if (!cli) return;

    const hourMs = 60 * 60 * 1000;

    setInterval(async () => {
      const now = Math.floor(Date.now() / 1000);
      for (const guild of cli.guilds.cache.values()) {
        const cfg = slotCfg(guild.id);
        if (!cfg.enabled) continue;
        const slots = store.listSlots(guild.id);
        for (const slot of slots) {
          if (Number(slot.endtime) <= now) {
            await expireSlot(guild, slot, { reason: 'expired' }).catch(() => {});
          }
        }
      }
    }, hourMs).unref?.();

    // Ping reset every pingResetHours — checked hourly
    /** @type {Map<string, number>} */
    const lastPingReset = new Map();
    setInterval(async () => {
      for (const guild of cli.guilds.cache.values()) {
        const cfg = slotCfg(guild.id);
        if (!cfg.enabled) continue;
        const hours = Number(cfg.pingResetHours) || 24;
        const dueMs = hours * hourMs;
        const key = guild.id;
        const last = lastPingReset.get(key) || 0;
        if (Date.now() - last < dueMs) continue;
        lastPingReset.set(key, Date.now());
        const slots = store.listSlots(guild.id);
        for (const slot of slots) {
          slot.pingCount = slot.maxPings ?? cfg.defaultPingCount ?? 3;
          store.upsertSlot(guild.id, slot);
        }
        hub.emit('slots.pingReset', { guildId: guild.id });
      }
    }, hourMs).unref?.();
  }

  return { register, onInteraction, startLoops };
}

module.exports = { createSlots };
