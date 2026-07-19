'use strict';

/**
 * Denizen Credits — economy module (SlotBot-inspired claim / hold / leaderboard).
 */

const { canRunCommand } = require('../../core/permissions');
const { successEmbed, infoEmbed, dangerEmbed, baseEmbed, BRAND } = require('../../core/ui-kit');
const { WalletStore } = require('../../core/wallet-store');
const { generateRedeemCode, normalizeCode } = require('./redeem-util');

const MEDALS = ['🥇', '🥈', '🥉'];
const HISTORY_SHOW = 15;

function createEconomy(deps) {
  const { config } = deps;
  const wallet = deps.wallet || new WalletStore();
  deps.wallet = wallet;
  const msgCooldown = new Map(); // `${guildId}:${userId}` -> ts

  function ecoCfg(guildId) {
    const c = config.get(guildId).economy || {};
    return {
      enabled: c.enabled !== false,
      claimAmount: Number(c.claimAmount ?? 50),
      msgRewardMin: Number(c.msgRewardMin ?? 1),
      msgRewardMax: Number(c.msgRewardMax ?? 3),
      msgCooldownMs: Number(c.msgCooldownMs ?? 60_000),
      maxWager: Number(c.maxWager ?? 250),
      duelCooldownMs: Number(c.duelCooldownMs ?? 60_000),
    };
  }

  function parseAmount(raw) {
    const n = Math.floor(Number(String(raw || '').replace(/,/g, '')));
    return Number.isFinite(n) ? n : NaN;
  }

  function formatCredits(n) {
    return `**${Number(n).toLocaleString()}** credits`;
  }

  function isStaff(ctx) {
    return canRunCommand(ctx, { permission: 'ManageGuild' }).ok;
  }

  function formatHistoryEntry(h) {
    const when = `<t:${Math.floor((h.ts || Date.now()) / 1000)}:R>`;
    switch (h.type) {
      case 'credit':
        return `${when} · +${h.amount} — ${h.reason || 'credit'}${h.userId ? ` <@${h.userId}>` : ''}`;
      case 'debit':
        return `${when} · ${h.amount} — ${h.reason || 'debit'}${h.userId ? ` <@${h.userId}>` : ''}`;
      case 'transfer':
        return `${when} · <@${h.from}> → <@${h.to}> **${h.amount}**`;
      case 'escrow':
        return `${when} · Wager escrowed — <@${h.a}> vs <@${h.b}> (${h.amount} each)`;
      case 'duel':
        return `${when} · Duel — <@${h.winnerId}> beat <@${h.loserId}>${h.wager ? ` for **${h.wager}**` : ''}${h.forfeit ? ' (forfeit)' : ''}`;
      case 'redeem':
        return `${when} · <@${h.userId}> redeemed \`${h.code}\` for **${h.amount}**`;
      case 'redeem_create':
        return `${when} · Code \`${h.code}\` created for **${h.amount}** (×${h.maxUses})`;
      default:
        return `${when} · ${h.type || 'entry'}`;
    }
  }

  function register(registry) {
    registry.register({
      name: 'balance',
      description: 'Check your Credits balance',
      module: 'economy',
      aliases: ['bal', 'wallet'],
      priority: 5, // high-traffic — keep slash even if budget gets tight
      options: [
        { type: 6, name: 'user', description: 'Whose balance to check', required: false },
      ],
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        if (!ecoCfg(ctx.guild.id).enabled) return ctx.reply('Credits are disabled here.');
        const target = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.() || ctx.user;
        const bal = wallet.getBalance(ctx.guild.id, target.id);
        const stats = wallet.getDuelStats(ctx.guild.id, target.id);
        const held = wallet.isHeld(ctx.guild.id, target.id);
        const fields = [
          { name: 'Balance', value: formatCredits(bal), inline: true },
          { name: 'Duels', value: `${stats.wins}W / ${stats.losses}L`, inline: true },
        ];
        if (held) {
          fields.push({
            name: 'Hold',
            value: `Frozen until <t:${Math.floor(wallet.holdUntil(ctx.guild.id, target.id) / 1000)}:R>`,
            inline: false,
          });
        }
        return ctx.reply({
          embeds: [infoEmbed(
            target.id === ctx.user.id ? 'Your wallet' : `${target.username}'s wallet`,
            held ? 'This account is on PVP hold.' : 'Earn with `,claim`, chat, and `,duel`.',
            fields,
          )],
        });
      },
    });

    registry.register({
      name: 'claim',
      description: 'Claim your daily Credits',
      module: 'economy',
      priority: 5, // high-traffic — keep slash even if budget gets tight
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        const cfg = ecoCfg(ctx.guild.id);
        if (!cfg.enabled) return ctx.reply('Credits are disabled here.');
        if (wallet.isHeld(ctx.guild.id, ctx.user.id)) {
          return ctx.reply('Your wallet is on hold — ask staff to `,credits unhold` you.');
        }
        if (!wallet.canClaimDaily(ctx.guild.id, ctx.user.id)) {
          const next = Math.floor(wallet.nextClaimAt(ctx.guild.id, ctx.user.id) / 1000);
          return ctx.reply(`Already claimed. Next claim <t:${next}:R>.`);
        }
        wallet.markClaimed(ctx.guild.id, ctx.user.id);
        const bal = wallet.add(ctx.guild.id, ctx.user.id, cfg.claimAmount, { reason: 'daily_claim' });
        return ctx.reply({
          embeds: [successEmbed(
            'Daily claim',
            `+${cfg.claimAmount} credits. Balance: ${formatCredits(bal)}`,
          )],
        });
      },
    });

    registry.register({
      name: 'pay',
      description: 'Send Credits to another member',
      module: 'economy',
      options: [
        { type: 6, name: 'user', description: 'Recipient', required: true },
        { type: 4, name: 'amount', description: 'Amount', required: true },
      ],
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        const cfg = ecoCfg(ctx.guild.id);
        if (!cfg.enabled) return ctx.reply('Credits are disabled here.');
        if (wallet.isHeld(ctx.guild.id, ctx.user.id)) {
          return ctx.reply('Your wallet is on hold.');
        }
        const target = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
        const amountRaw = ctx.getInteger?.('amount') ?? ctx.args?.find((a) => /^\d+$/.test(a));
        const amount = parseAmount(amountRaw);
        if (!target) return ctx.reply('Usage: `,pay @user <amount>`');
        if (!Number.isFinite(amount) || amount <= 0) return ctx.reply('Enter a positive amount.');
        const result = wallet.transfer(ctx.guild.id, ctx.user.id, target.id, amount, {
          reason: 'pay',
          by: ctx.user.id,
        });
        if (!result.ok) return ctx.reply(result.error);
        return ctx.reply({
          embeds: [successEmbed(
            'Paid',
            `Sent ${formatCredits(amount)} to <@${target.id}>. Your balance: ${formatCredits(result.fromBal)}.`,
          )],
        });
      },
    });

    registry.register({
      name: 'credits',
      description: 'Credits admin + leaderboard (lb | give | take | hold | unhold)',
      module: 'economy',
      options: [
        {
          type: 3,
          name: 'action',
          description: 'lb | give | take | hold | unhold',
          required: false,
          choices: [
            { name: 'lb', value: 'lb' },
            { name: 'give', value: 'give' },
            { name: 'take', value: 'take' },
            { name: 'hold', value: 'hold' },
            { name: 'unhold', value: 'unhold' },
          ],
        },
        { type: 6, name: 'user', description: 'Target user', required: false },
        { type: 4, name: 'amount', description: 'Amount or hold hours', required: false },
      ],
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        const cfg = ecoCfg(ctx.guild.id);
        if (!cfg.enabled) return ctx.reply('Credits are disabled here.');

        const action = String(ctx.getString?.('action') || ctx.args?.[0] || '').toLowerCase();

        // Bare `,credits` → own balance
        if (!action) {
          const bal = wallet.getBalance(ctx.guild.id, ctx.user.id);
          const stats = wallet.getDuelStats(ctx.guild.id, ctx.user.id);
          return ctx.reply({
            embeds: [infoEmbed('Your wallet', 'Earn with `,claim`, chat, and `,duel`.', [
              { name: 'Balance', value: formatCredits(bal), inline: true },
              { name: 'Duels', value: `${stats.wins}W / ${stats.losses}L`, inline: true },
            ])],
          });
        }

        if (action === 'lb' || action === 'leaderboard' || action === 'top') {
          const top = wallet.topBalances(ctx.guild.id, 10);
          if (!top.length) return ctx.reply('No wallets yet — try `,claim`.');
          const lines = top.map((row, i) => {
            const medal = MEDALS[i] || `**${i + 1}.**`;
            return `${medal} <@${row.userId}> — ${row.bal.toLocaleString()} credits`;
          });
          return ctx.reply({
            embeds: [baseEmbed({
              color: BRAND.primary,
              title: 'Credits leaderboard',
              description: lines.join('\n'),
              footerExtra: 'credits',
            })],
          });
        }

        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) {
          return ctx.reply('Need Manage Guild for that. Try `,credits lb` or `,balance`.');
        }

        const target = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
        if (action === 'give' || action === 'take') {
          if (!target) return ctx.reply(`Usage: \`,credits ${action} @user <amount>\``);
          const amount = parseAmount(ctx.getInteger?.('amount') ?? ctx.args?.find((a) => /^\d+$/.test(a)));
          if (!Number.isFinite(amount) || amount <= 0) return ctx.reply('Enter a positive amount.');
          const delta = action === 'give' ? amount : -amount;
          const bal = wallet.add(ctx.guild.id, target.id, delta, {
            reason: `staff_${action}`,
            by: ctx.user.id,
          });
          return ctx.reply({
            embeds: [successEmbed(
              action === 'give' ? 'Credits given' : 'Credits taken',
              `<@${target.id}> now has ${formatCredits(bal)}.`,
            )],
          });
        }

        if (action === 'hold') {
          if (!target) return ctx.reply('Usage: `,credits hold @user [hours]` (default 24)');
          const hoursRaw = ctx.getInteger?.('amount') ?? ctx.args?.find((a) => /^\d+$/.test(a));
          const hours = Math.max(1, Math.min(168, parseAmount(hoursRaw) || 24));
          const until = Date.now() + hours * 60 * 60 * 1000;
          wallet.setHold(ctx.guild.id, target.id, until);
          return ctx.reply({
            embeds: [dangerEmbed(
              'PVP hold',
              `<@${target.id}> cannot duel/wager until <t:${Math.floor(until / 1000)}:R>.`,
            )],
          });
        }

        if (action === 'unhold') {
          if (!target) return ctx.reply('Usage: `,credits unhold @user`');
          wallet.clearHold(ctx.guild.id, target.id);
          return ctx.reply({
            embeds: [successEmbed('Hold cleared', `<@${target.id}> can duel again.`)],
          });
        }

        return ctx.reply('Usage: `,credits lb|give|take|hold|unhold`');
      },
    });

    registry.register({
      name: 'createredeem',
      description: 'Create a Credits redeem code (staff)',
      module: 'economy',
      permission: 'ManageGuild',
      slash: false, // staff-only + rare — prefix-only keeps slash budget free
      options: [
        { type: 4, name: 'amount', description: 'Credits the code grants', required: true },
        { type: 4, name: 'maxuses', description: 'Max redemptions (default 1)', required: false },
        { type: 3, name: 'code', description: 'Custom code (auto-generated if omitted)', required: false },
      ],
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        if (!isStaff(ctx)) return ctx.reply('Need Manage Guild for that.');

        let amountRaw;
        let maxUsesRaw;
        let codeRaw;
        if (ctx.source === 'slash') {
          amountRaw = ctx.getInteger?.('amount');
          maxUsesRaw = ctx.getInteger?.('maxuses');
          codeRaw = ctx.getString?.('code');
        } else {
          const args = ctx.args || [];
          amountRaw = args[0];
          const hasMaxUses = /^\d+$/.test(args[1] || '');
          maxUsesRaw = hasMaxUses ? args[1] : undefined;
          codeRaw = hasMaxUses ? args[2] : args[1];
        }

        const amount = parseAmount(amountRaw);
        if (!Number.isFinite(amount) || amount <= 0) {
          return ctx.reply('Usage: `,createredeem <amount> [maxUses] [code]`');
        }
        const maxUses = maxUsesRaw != null ? Math.max(1, parseAmount(maxUsesRaw) || 1) : 1;
        const code = codeRaw ? normalizeCode(codeRaw) : generateRedeemCode();

        const result = wallet.createRedeem(ctx.guild.id, {
          amount,
          maxUses,
          code,
          createdBy: ctx.user.id,
        });
        if (!result.ok) return ctx.reply(result.error);
        return ctx.reply({
          embeds: [successEmbed(
            'Redeem code created',
            `Code \`${result.code}\` grants ${formatCredits(amount)} · ${maxUses} use${maxUses === 1 ? '' : 's'}.`,
          )],
        });
      },
    });

    registry.register({
      name: 'redeems',
      description: 'List active Credits redeem codes (staff)',
      module: 'economy',
      permission: 'ManageGuild',
      slash: false, // staff-only + rare — prefix-only keeps slash budget free
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        if (!isStaff(ctx)) return ctx.reply('Need Manage Guild for that.');
        const list = wallet.listRedeems(ctx.guild.id);
        if (!list.length) return ctx.reply('No redeem codes yet — `,createredeem <amount>`.');
        const lines = list.slice(0, 20).map((r) =>
          `\`${r.code}\` — ${r.amount.toLocaleString()} credits · ${r.usesLeft}/${r.maxUses} left`);
        return ctx.reply({
          embeds: [baseEmbed({
            color: BRAND.primary,
            title: 'Redeem codes',
            description: lines.join('\n'),
            footerExtra: 'redeem codes',
          })],
        });
      },
    });

    registry.register({
      name: 'deleteredeem',
      description: 'Delete a Credits redeem code (staff)',
      module: 'economy',
      permission: 'ManageGuild',
      slash: false, // staff-only + rare — prefix-only keeps slash budget free
      options: [
        { type: 3, name: 'code', description: 'Code to delete', required: true },
      ],
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        if (!isStaff(ctx)) return ctx.reply('Need Manage Guild for that.');
        const codeRaw = ctx.source === 'slash' ? ctx.getString?.('code') : ctx.args?.[0];
        if (!codeRaw) return ctx.reply('Usage: `,deleteredeem <code>`');
        const result = wallet.deleteRedeem(ctx.guild.id, codeRaw);
        if (!result.ok) return ctx.reply(result.error);
        return ctx.reply({
          embeds: [successEmbed('Redeem code deleted', `Code \`${result.code}\` removed.`)],
        });
      },
    });

    registry.register({
      name: 'redeem',
      description: 'Redeem a Credits code',
      module: 'economy',
      options: [
        { type: 3, name: 'code', description: 'Your redeem code', required: true },
      ],
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        if (!ecoCfg(ctx.guild.id).enabled) return ctx.reply('Credits are disabled here.');
        const codeRaw = ctx.source === 'slash' ? ctx.getString?.('code') : ctx.args?.[0];
        if (!codeRaw) return ctx.reply('Usage: `,redeem <code>`');
        const result = wallet.redeemCode(ctx.guild.id, ctx.user.id, codeRaw);
        if (!result.ok) return ctx.reply({ embeds: [dangerEmbed('Redeem failed', result.error)] });
        return ctx.reply({
          embeds: [successEmbed(
            'Code redeemed',
            `+${formatCredits(result.amount)} → balance ${formatCredits(result.balance)}.`,
          )],
        });
      },
    });

    registry.register({
      name: 'history',
      description: 'Show your recent Credits history',
      module: 'economy',
      slash: false, // lower-traffic than claim/balance/duel/shop — prefix-only keeps slash budget free
      options: [
        {
          type: 3,
          name: 'type',
          description: 'credits | duels',
          required: false,
          choices: [
            { name: 'credits', value: 'credits' },
            { name: 'duels', value: 'duels' },
          ],
        },
      ],
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        const filterRaw = String(ctx.getString?.('type') || ctx.args?.[0] || '').toLowerCase();
        const type = ['credits', 'credit', 'duels', 'duel'].includes(filterRaw) ? filterRaw : null;
        const rows = wallet.getHistory(ctx.guild.id, { type, limit: HISTORY_SHOW });
        if (!rows.length) return ctx.reply('No history yet — try `,claim` or `,duel`.');
        return ctx.reply({
          embeds: [baseEmbed({
            color: BRAND.primary,
            title: type ? `History — ${type}` : 'History',
            description: rows.map(formatHistoryEntry).join('\n'),
            footerExtra: `last ${rows.length}`,
          })],
        });
      },
    });
  }

  async function onMessage(message) {
    if (!message.guild || message.author.bot) return;
    const cfg = ecoCfg(message.guild.id);
    if (!cfg.enabled) return;
    if (wallet.isHeld(message.guild.id, message.author.id)) return;
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const last = msgCooldown.get(key) || 0;
    if (now - last < cfg.msgCooldownMs) return;
    msgCooldown.set(key, now);
    const span = Math.max(0, cfg.msgRewardMax - cfg.msgRewardMin);
    const gain = cfg.msgRewardMin + Math.floor(Math.random() * (span + 1));
    if (gain > 0) {
      wallet.addChatDrip(message.guild.id, message.author.id, gain);
    }
  }

  return {
    register,
    onMessage,
    wallet,
    ecoCfg,
  };
}

module.exports = { createEconomy };
