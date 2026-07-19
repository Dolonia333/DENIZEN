'use strict';

/**
 * Denizen Credits — economy module (SlotBot-inspired claim / hold / leaderboard).
 */

const { canRunCommand } = require('../../core/permissions');
const { successEmbed, infoEmbed, dangerEmbed, baseEmbed, BRAND } = require('../../core/ui-kit');
const { WalletStore } = require('../../core/wallet-store');
const { generateRedeemCode, normalizeCode } = require('./redeem-util');
const { postEconomyAudit, tryDm, progressBar } = require('./audit');

const MEDALS = ['🥇', '🥈', '🥉'];
const HISTORY_SHOW = 15;

function createEconomy(deps) {
  const { config, client } = deps;
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
      auditChannelId: c.auditChannelId || null,
      dmNotify: c.dmNotify !== false,
    };
  }

  function blockedReason(guildId, userId) {
    if (wallet.isBlacklisted?.(guildId, userId)) {
      const entry = wallet.getBlacklistEntry?.(guildId, userId);
      return entry?.reason
        ? `You are blacklisted from Credits: ${entry.reason}`
        : 'You are blacklisted from Credits.';
    }
    return null;
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
      case 'warn':
        return `${when} · Warn <@${h.userId}> by <@${h.by}> — ${h.reason} (${h.count})`;
      case 'blacklist':
        return `${when} · Blacklist <@${h.userId}> by <@${h.by}> — ${h.reason}`;
      case 'unblacklist':
        return `${when} · Unblacklist <@${h.userId}> by <@${h.by}>`;
      default:
        return `${when} · ${h.type || 'entry'}`;
    }
  }

  async function audit(guildId, title, description, color) {
    await postEconomyAudit(client, config, guildId, { title, description, color });
  }

  function register(registry) {
    registry.register({
      name: 'balance',
      description: 'Check your Credits balance',
      module: 'economy',
      aliases: ['bal', 'wallet'],
      priority: 5, // high-traffic — keep slash even if budget gets tight
      public: true,
      options: [
        { type: 6, name: 'user', description: 'Whose balance to check', required: false },
      ],
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        if (!ecoCfg(ctx.guild.id).enabled) return ctx.reply('Credits are disabled here.');
        const target = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.() || ctx.user;
        const bal = wallet.getBalance(ctx.guild.id, target.id);
        const stats = wallet.getDuelStats(ctx.guild.id, target.id);
        const weekly = wallet.getWeeklyWins?.(ctx.guild.id, target.id) || 0;
        const held = wallet.isHeld(ctx.guild.id, target.id);
        const blacklisted = wallet.isBlacklisted?.(ctx.guild.id, target.id);
        const fields = [
          { name: 'Balance', value: formatCredits(bal), inline: true },
          { name: 'Duels', value: `${stats.wins}W / ${stats.losses}L · F${stats.forfeits || 0}`, inline: true },
          {
            name: 'Streak',
            value: `🔥 ${stats.streak || 0} (best ${stats.bestStreak || 0}) · week ${weekly}`,
            inline: true,
          },
          {
            name: 'Next',
            value: '`,claim` · `,duel @user` / `,duel open` · `,coinflip` · `,shop` · `,stats`',
            inline: false,
          },
        ];
        if (held) {
          fields.push({
            name: 'Hold',
            value: `Frozen until <t:${Math.floor(wallet.holdUntil(ctx.guild.id, target.id) / 1000)}:R>`,
            inline: false,
          });
        }
        if (blacklisted) {
          fields.push({ name: 'Blacklist', value: 'Blocked from Credits actions', inline: false });
        }
        return ctx.reply({
          embeds: [baseEmbed({
            color: BRAND.primary,
            title: `${target.username}'s wallet`,
            fields,
            footerExtra: 'credits',
          })],
        });
      },
    });

    registry.register({
      name: 'stats',
      description: 'Your Credits / duel stats with progress bars',
      module: 'economy',
      public: true,
      slash: false,
      options: [
        { type: 6, name: 'user', description: 'Whose stats', required: false },
      ],
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        if (!ecoCfg(ctx.guild.id).enabled) return ctx.reply('Credits are disabled here.');
        const target = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.() || ctx.user;
        const bal = wallet.getBalance(ctx.guild.id, target.id);
        const stats = wallet.getDuelStats(ctx.guild.id, target.id);
        const weekly = wallet.getWeeklyWins?.(ctx.guild.id, target.id) || 0;
        const warns = wallet.getWarns?.(ctx.guild.id, target.id) || [];
        const total = Math.max(1, stats.wins + stats.losses);
        const winRate = Math.round((stats.wins / total) * 100);
        const lines = [
          `**Balance** ${formatCredits(bal)}`,
          `**Win rate** ${progressBar(stats.wins, total)} (${winRate}%)`,
          `**Streak** ${progressBar(stats.streak || 0, Math.max(stats.bestStreak || 1, 5))} best ${stats.bestStreak || 0}`,
          `**This week** ${weekly} duel win(s)`,
          warns.length ? `**Credits warns** ${warns.length}` : null,
        ].filter(Boolean);
        return ctx.reply({
          embeds: [baseEmbed({
            color: BRAND.primary,
            title: `${target.username}'s stats`,
            description: lines.join('\n'),
            footerExtra: 'stats · ,duel lb weekly',
          })],
        });
      },
    });

    registry.register({
      name: 'claim',
      description: 'Claim your daily Credits',
      module: 'economy',
      priority: 5, // high-traffic — keep slash even if budget gets tight
      public: true,
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        const cfg = ecoCfg(ctx.guild.id);
        if (!cfg.enabled) return ctx.reply('Credits are disabled here.');
        const blocked = blockedReason(ctx.guild.id, ctx.user.id);
        if (blocked) return ctx.reply(blocked);
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
            `+${cfg.claimAmount} credits. Balance: ${formatCredits(bal)}\n**Next:** \`,duel @user\` · \`,duel open\` · \`,shop\``,
          )],
        });
      },
    });

    registry.register({
      name: 'pay',
      description: 'Send Credits to another member',
      module: 'economy',
      public: true,
      options: [
        { type: 6, name: 'user', description: 'Recipient', required: true },
        { type: 4, name: 'amount', description: 'Amount', required: true },
      ],
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        const cfg = ecoCfg(ctx.guild.id);
        if (!cfg.enabled) return ctx.reply('Credits are disabled here.');
        const blocked = blockedReason(ctx.guild.id, ctx.user.id);
        if (blocked) return ctx.reply(blocked);
        if (wallet.isHeld(ctx.guild.id, ctx.user.id)) {
          return ctx.reply('Your wallet is on hold.');
        }
        const target = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
        const amountRaw = ctx.getInteger?.('amount') ?? ctx.args?.find((a) => /^\d+$/.test(a));
        const amount = parseAmount(amountRaw);
        if (!target) return ctx.reply('Usage: `,pay @user <amount>`');
        if (target.bot) return ctx.reply('You cannot pay bots.');
        if (target.id === ctx.user.id) return ctx.reply('You cannot pay yourself.');
        if (wallet.isBlacklisted?.(ctx.guild.id, target.id)) {
          return ctx.reply('That user is blacklisted from Credits.');
        }
        if (!Number.isFinite(amount) || amount <= 0) return ctx.reply('Enter a positive amount.');
        const result = wallet.transfer(ctx.guild.id, ctx.user.id, target.id, amount, {
          reason: 'pay',
          by: ctx.user.id,
        });
        if (!result.ok) return ctx.reply(result.error);
        if (cfg.dmNotify) {
          await tryDm(target, {
            embeds: [infoEmbed(
              'Credits received',
              `You received ${formatCredits(amount)} from **${ctx.user.username}** in **${ctx.guild.name}**.`,
            )],
          });
        }
        await audit(ctx.guild.id, 'Pay', `<@${ctx.user.id}> → <@${target.id}> **${amount}**`, BRAND.success);
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
      description: 'Credits admin + leaderboard (lb | give | take | hold | warn | blacklist | audit)',
      module: 'economy',
      public: true,
      options: [
        {
          type: 3,
          name: 'action',
          description: 'lb | give | take | hold | unhold | warn | blacklist | audit',
          required: false,
          choices: [
            { name: 'lb', value: 'lb' },
            { name: 'give', value: 'give' },
            { name: 'take', value: 'take' },
            { name: 'hold', value: 'hold' },
            { name: 'unhold', value: 'unhold' },
            { name: 'warn', value: 'warn' },
            { name: 'blacklist', value: 'blacklist' },
            { name: 'unblacklist', value: 'unblacklist' },
            { name: 'audit', value: 'audit' },
          ],
        },
        { type: 6, name: 'user', description: 'Target user', required: false },
        { type: 4, name: 'amount', description: 'Amount or hold hours', required: false },
        { type: 3, name: 'reason', description: 'Warn/blacklist reason', required: false },
        { type: 7, name: 'channel', description: 'Audit log channel', required: false },
      ],
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        const cfg = ecoCfg(ctx.guild.id);
        if (!cfg.enabled) return ctx.reply('Credits are disabled here.');

        const action = String(ctx.getString?.('action') || ctx.args?.[0] || '').toLowerCase();

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
          const mode = String(ctx.args?.[1] || ctx.getString?.('reason') || '').toLowerCase();
          if (mode === 'streak' || mode === 'streaks') {
            const top = wallet.topStreaks?.(ctx.guild.id, 10) || [];
            if (!top.length) return ctx.reply('No streaks yet.');
            const lines = top.map((row, i) => {
              const medal = MEDALS[i] || `**${i + 1}.**`;
              return `${medal} <@${row.userId}> — 🔥 ${row.streak} (best ${row.bestStreak})`;
            });
            return ctx.reply({
              embeds: [baseEmbed({
                color: BRAND.primary,
                title: 'Streak leaderboard',
                description: lines.join('\n'),
                footerExtra: 'credits · streaks',
              })],
            });
          }
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
              footerExtra: 'credits · also `,credits lb streak`',
            })],
          });
        }

        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) {
          return ctx.reply('Need Manage Guild for that. Try `,credits lb` or `,balance`.');
        }

        const target = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
        const reasonTail = (() => {
          const fromOpt = ctx.getString?.('reason');
          if (fromOpt) return fromOpt;
          // Prefix: ,credits warn @user reason words…
          const parts = Array.isArray(ctx.args) ? ctx.args.slice(1) : [];
          const filtered = parts.filter((p) => !/^<@!?(\d+)>$/.test(p) && !/^\d+$/.test(p));
          return filtered.join(' ').trim();
        })();

        if (action === 'give' || action === 'take') {
          if (!target) return ctx.reply(`Usage: \`,credits ${action} @user <amount>\``);
          const amount = parseAmount(ctx.getInteger?.('amount') ?? ctx.args?.find((a) => /^\d+$/.test(a)));
          if (!Number.isFinite(amount) || amount <= 0) return ctx.reply('Enter a positive amount.');
          const delta = action === 'give' ? amount : -amount;
          const bal = wallet.add(ctx.guild.id, target.id, delta, {
            reason: `staff_${action}`,
            by: ctx.user.id,
          });
          await audit(
            ctx.guild.id,
            action === 'give' ? 'Credits given' : 'Credits taken',
            `<@${ctx.user.id}> ${action} **${amount}** → <@${target.id}> (now ${bal})`,
            action === 'give' ? BRAND.success : BRAND.danger,
          );
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
          await audit(ctx.guild.id, 'PVP hold', `<@${ctx.user.id}> held <@${target.id}> (${hours}h)`, BRAND.danger);
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
          await audit(ctx.guild.id, 'Hold cleared', `<@${ctx.user.id}> cleared hold on <@${target.id}>`, BRAND.success);
          return ctx.reply({
            embeds: [successEmbed('Hold cleared', `<@${target.id}> can duel again.`)],
          });
        }

        if (action === 'warn') {
          if (!target) return ctx.reply('Usage: `,credits warn @user [reason]`');
          const reason = reasonTail || 'Credits warning';
          const { count } = wallet.addWarn(ctx.guild.id, target.id, { by: ctx.user.id, reason });
          if (cfg.dmNotify) {
            await tryDm(target, {
              embeds: [dangerEmbed(
                'Credits warning',
                `You received a Credits warn in **${ctx.guild.name}**: ${reason}\nTotal: **${count}**`,
              )],
            });
          }
          await audit(ctx.guild.id, 'Credits warn', `<@${ctx.user.id}> warned <@${target.id}> — ${reason} (${count})`, BRAND.danger);
          return ctx.reply({
            embeds: [dangerEmbed('Warned', `<@${target.id}> now has **${count}** Credits warn(s).`)],
          });
        }

        if (action === 'warns') {
          if (!target) return ctx.reply('Usage: `,credits warns @user`');
          const warns = wallet.getWarns(ctx.guild.id, target.id);
          if (!warns.length) return ctx.reply('No Credits warns for that user.');
          const lines = warns.slice(0, 10).map((w) => {
            const when = `<t:${Math.floor((w.at || Date.now()) / 1000)}:R>`;
            return `${when} · <@${w.by}> — ${w.reason}`;
          });
          return ctx.reply({
            embeds: [baseEmbed({
              color: BRAND.danger,
              title: `Credits warns — ${target.username}`,
              description: lines.join('\n'),
              footerExtra: 'credits',
            })],
          });
        }

        if (action === 'clearwarns') {
          if (!target) return ctx.reply('Usage: `,credits clearwarns @user`');
          const { cleared } = wallet.clearWarns(ctx.guild.id, target.id);
          return ctx.reply({ embeds: [successEmbed('Warns cleared', `Cleared **${cleared}** warn(s) for <@${target.id}>.`)] });
        }

        if (action === 'blacklist') {
          if (!target) return ctx.reply('Usage: `,credits blacklist @user [reason]`');
          const reason = reasonTail || 'Credits abuse';
          wallet.setBlacklist(ctx.guild.id, target.id, { by: ctx.user.id, reason });
          if (cfg.dmNotify) {
            await tryDm(target, {
              embeds: [dangerEmbed(
                'Credits blacklist',
                `You were blacklisted from Credits in **${ctx.guild.name}**: ${reason}`,
              )],
            });
          }
          await audit(ctx.guild.id, 'Blacklist', `<@${ctx.user.id}> blacklisted <@${target.id}> — ${reason}`, BRAND.danger);
          return ctx.reply({
            embeds: [dangerEmbed('Blacklisted', `<@${target.id}> cannot use Credits until unblacklisted.`)],
          });
        }

        if (action === 'unblacklist') {
          if (!target) return ctx.reply('Usage: `,credits unblacklist @user`');
          const result = wallet.clearBlacklist(ctx.guild.id, target.id, { by: ctx.user.id });
          if (!result.ok) return ctx.reply(result.error);
          await audit(ctx.guild.id, 'Unblacklist', `<@${ctx.user.id}> cleared blacklist on <@${target.id}>`, BRAND.success);
          return ctx.reply({ embeds: [successEmbed('Unblacklisted', `<@${target.id}> can use Credits again.`)] });
        }

        if (action === 'audit') {
          const offArg = String(ctx.args?.[1] || ctx.getString?.('reason') || '').toLowerCase() === 'off';
          const channel = ctx.getChannel?.('channel')
            || ctx.message?.mentions?.channels?.first?.()
            || null;
          if (offArg) {
            config.update(ctx.guild.id, (c) => {
              c.economy = c.economy || {};
              c.economy.auditChannelId = null;
              return c;
            });
            return ctx.reply({ embeds: [successEmbed('Audit channel', 'Credits audit logging disabled.')] });
          }
          if (!channel) {
            const current = cfg.auditChannelId ? `<#${cfg.auditChannelId}>` : '_off_';
            return ctx.reply(`Credits audit channel: ${current}\nSet with \`,credits audit #channel\` or \`,credits audit off\`.`);
          }
          config.update(ctx.guild.id, (c) => {
            c.economy = c.economy || {};
            c.economy.auditChannelId = String(channel.id);
            return c;
          });
          return ctx.reply({
            embeds: [successEmbed('Audit channel', `Logging Credits actions to <#${channel.id}>.`)],
          });
        }

        return ctx.reply('Usage: `,credits lb|give|take|hold|unhold|warn|blacklist|audit`');
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
      public: true,
      options: [
        { type: 3, name: 'code', description: 'Your redeem code', required: true },
      ],
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        if (!ecoCfg(ctx.guild.id).enabled) return ctx.reply('Credits are disabled here.');
        const blocked = blockedReason(ctx.guild.id, ctx.user.id);
        if (blocked) return ctx.reply(blocked);
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
      public: true,
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
        const rows = wallet.getHistory(ctx.guild.id, {
          type,
          limit: HISTORY_SHOW,
          userId: ctx.user.id,
        });
        if (!rows.length) return ctx.reply('No history yet — try `,claim` or `,duel`.');
        return ctx.reply({
          embeds: [baseEmbed({
            color: BRAND.primary,
            title: type ? `Your history — ${type}` : 'Your history',
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
    if (wallet.isBlacklisted?.(message.guild.id, message.author.id)) return;
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
