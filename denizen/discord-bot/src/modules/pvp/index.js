'use strict';

/**
 * Button PVP duels with Credits wagers.
 * Attack / Guard / Feint — simultaneous RPS over 100 HP.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { successEmbed, infoEmbed, dangerEmbed, baseEmbed, BRAND } = require('../../core/ui-kit');
const { WalletStore } = require('../../core/wallet-store');

const HP_MAX = 100;
const IDLE_MS = 90_000;
const MOVES = ['attack', 'guard', 'feint'];
const MOVE_LABEL = { attack: 'Attack', guard: 'Guard', feint: 'Feint' };
const MEDALS = ['🥇', '🥈', '🥉'];

/** Damage dealer deals to target when both picks resolve. */
function resolveRound(aMove, bMove) {
  if (aMove === bMove) {
    return { aDmg: 8, bDmg: 8, note: 'Clash! Both take chip damage.' };
  }
  // Attack > Feint > Guard > Attack
  if (aMove === 'attack' && bMove === 'feint') {
    return { aDmg: 0, bDmg: 28, note: 'Attack lands on the Feint!' };
  }
  if (aMove === 'feint' && bMove === 'attack') {
    return { aDmg: 28, bDmg: 0, note: 'Attack lands on the Feint!' };
  }
  if (aMove === 'feint' && bMove === 'guard') {
    return { aDmg: 0, bDmg: 22, note: 'Feint slips past Guard!' };
  }
  if (aMove === 'guard' && bMove === 'feint') {
    return { aDmg: 22, bDmg: 0, note: 'Feint slips past Guard!' };
  }
  if (aMove === 'guard' && bMove === 'attack') {
    return { aDmg: 0, bDmg: 14, note: 'Guard counters the Attack!' };
  }
  if (aMove === 'attack' && bMove === 'guard') {
    return { aDmg: 14, bDmg: 0, note: 'Guard counters the Attack!' };
  }
  return { aDmg: 8, bDmg: 8, note: 'Both strike.' };
}

function hpBar(hp, max = HP_MAX) {
  const filled = Math.max(0, Math.min(10, Math.round((hp / max) * 10)));
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${hp}/${max}`;
}

function createPvp(deps) {
  const { config, tracker } = deps;
  const wallet = deps.wallet || new WalletStore();
  deps.wallet = wallet;

  /** @type {Map<string, object>} matchId -> match */
  const matches = new Map();
  /** userId -> matchId (one active match per user per process) */
  const byUser = new Map();

  function ecoCfg(guildId) {
    const c = config.get(guildId).economy || {};
    return {
      enabled: c.enabled !== false,
      maxWager: Number(c.maxWager ?? 250),
      duelCooldownMs: Number(c.duelCooldownMs ?? 60_000),
    };
  }

  function newMatchId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function clearUser(match) {
    if (!match) return;
    byUser.delete(match.challengerId);
    byUser.delete(match.opponentId);
  }

  function mapPose(guildId, userId, pose, ttlMs = 4500) {
    if (!tracker?.isOnMap?.(guildId, userId)) return;
    const kind = pose === 'win' || pose === 'lose' || pose === 'guard' || pose === 'fight' || pose === 'feint'
      ? 'emote'
      : 'emote';
    const poseMap = {
      fight: 'hurt',
      attack: 'hurt',
      guard: 'shrug',
      feint: 'jump',
      win: 'wave',
      lose: 'hurt',
    };
    tracker.setMapAction(guildId, userId, {
      kind,
      pose: poseMap[pose] || pose || 'wave',
    }, ttlMs);
  }

  function challengeRow(matchId) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`duel:accept:${matchId}`)
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`duel:decline:${matchId}`)
        .setLabel('Decline')
        .setStyle(ButtonStyle.Danger),
    );
  }

  function fightRow(matchId, disabled = false) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`duel:move:${matchId}:attack`)
        .setLabel('Attack')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`duel:move:${matchId}:guard`)
        .setLabel('Guard')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`duel:move:${matchId}:feint`)
        .setLabel('Feint')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    );
  }

  function fightEmbed(match, extra = '') {
    const lines = [
      `<@${match.challengerId}> ${hpBar(match.hp[match.challengerId])}`,
      `<@${match.opponentId}> ${hpBar(match.hp[match.opponentId])}`,
      '',
      `Pot: **${match.pot}** credits · Round **${match.round}**`,
      'Pick **Attack**, **Guard**, or **Feint** (same time).',
      'Attack > Feint > Guard > Attack',
    ];
    if (extra) lines.push('', extra);
    return baseEmbed({
      color: BRAND.danger,
      title: 'Duel',
      description: lines.join('\n'),
      footerExtra: 'pvp',
    });
  }

  function armIdleTimer(matchId) {
    const match = matches.get(matchId);
    if (!match) return;
    if (match.idleTimer) clearTimeout(match.idleTimer);
    match.idleTimer = setTimeout(() => {
      void expireMatch(matchId, 'idle');
    }, IDLE_MS);
  }

  async function expireMatch(matchId, reason) {
    const match = matches.get(matchId);
    if (!match || match.status === 'done') return;
    match.status = 'done';
    if (match.idleTimer) clearTimeout(match.idleTimer);
    if (match.escrowed && match.wager > 0) {
      wallet.refundEscrow(match.guildId, match.challengerId, match.opponentId, match.wager, {
        matchId,
        reason: `expire_${reason}`,
      });
    }
    clearUser(match);
    matches.delete(matchId);
    try {
      if (match.message?.edit) {
        const pending = !match.escrowed && reason === 'idle';
        await match.message.edit({
          embeds: [dangerEmbed(
            'Duel expired',
            reason === 'idle' && match.escrowed
              ? 'No moves for 90s — wager refunded.'
              : pending
                ? 'Challenge timed out — no credits moved.'
                : 'Duel ended — no credits moved.',
          )],
          components: [],
        });
      }
    } catch (_) { /* ignore */ }
  }

  async function finishMatch(match, winnerId, loserId, opts = {}) {
    match.status = 'done';
    if (match.idleTimer) clearTimeout(match.idleTimer);
    const pot = match.pot;
    if (match.escrowed) {
      if (pot > 0) wallet.payPot(match.guildId, winnerId, pot, { matchId: match.id });
      match.escrowed = false;
    }
    wallet.recordDuelResult(match.guildId, winnerId, loserId, {
      wager: match.wager,
      forfeit: !!opts.forfeit,
    });
    wallet.setDuelCooldown(match.guildId, match.challengerId, match.duelCooldownMs);
    wallet.setDuelCooldown(match.guildId, match.opponentId, match.duelCooldownMs);
    mapPose(match.guildId, winnerId, 'win', 6000);
    mapPose(match.guildId, loserId, 'lose', 6000);

    const desc = opts.forfeit
      ? `<@${loserId}> forfeited. <@${winnerId}> wins **${pot}** credits.`
      : `<@${winnerId}> wins the duel and takes **${pot}** credits!`;

    clearUser(match);
    matches.delete(match.id);
    try {
      if (match.message?.edit) {
        await match.message.edit({
          embeds: [successEmbed('Duel over', desc, [
            {
              name: 'Final HP',
              value: [
                `<@${match.challengerId}> ${match.hp[match.challengerId]}`,
                `<@${match.opponentId}> ${match.hp[match.opponentId]}`,
              ].join('\n'),
              inline: false,
            },
          ])],
          components: [],
        });
      }
    } catch (_) { /* ignore */ }
  }

  async function resolveIfReady(match) {
    const a = match.challengerId;
    const b = match.opponentId;
    if (!match.picks[a] || !match.picks[b]) return;

    const aMove = match.picks[a];
    const bMove = match.picks[b];
    const result = resolveRound(aMove, bMove);
    match.hp[a] = Math.max(0, match.hp[a] - result.aDmg);
    match.hp[b] = Math.max(0, match.hp[b] - result.bDmg);
    match.picks = {};
    match.round += 1;

    mapPose(match.guildId, a, aMove);
    mapPose(match.guildId, b, bMove);

    const note = [
      `<@${a}> played **${MOVE_LABEL[aMove]}**`,
      `<@${b}> played **${MOVE_LABEL[bMove]}**`,
      result.note,
    ].join('\n');

    if (match.hp[a] <= 0 && match.hp[b] <= 0) {
      // Mutual KO — refund and call draw (no winner stats)
      match.status = 'done';
      if (match.idleTimer) clearTimeout(match.idleTimer);
      if (match.escrowed && match.wager > 0) {
        wallet.refundEscrow(match.guildId, a, b, match.wager, { matchId: match.id, reason: 'draw' });
        match.escrowed = false;
      }
      clearUser(match);
      matches.delete(match.id);
      await match.message?.edit?.({
        embeds: [infoEmbed('Draw', `${note}\n\nDouble KO — wager refunded.`)],
        components: [],
      }).catch(() => {});
      return;
    }
    if (match.hp[a] <= 0) {
      await finishMatch(match, b, a);
      return;
    }
    if (match.hp[b] <= 0) {
      await finishMatch(match, a, b);
      return;
    }

    armIdleTimer(match.id);
    await match.message?.edit?.({
      embeds: [fightEmbed(match, note)],
      components: [fightRow(match.id)],
    }).catch(() => {});
  }

  function register(registry) {
    registry.register({
      name: 'duel',
      description: 'Challenge someone to a Credits duel',
      module: 'pvp',
      options: [
        { type: 6, name: 'user', description: 'Opponent (omit for leaderboard with wager unused)', required: false },
        { type: 4, name: 'wager', description: 'Credits each side puts in', required: false },
        {
          type: 3,
          name: 'action',
          description: 'lb = leaderboard',
          required: false,
          choices: [{ name: 'lb', value: 'lb' }],
        },
      ],
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        const cfg = ecoCfg(ctx.guild.id);
        if (!cfg.enabled) return ctx.reply('Credits / duels are disabled here.');

        const sub = String(
          ctx.getString?.('action') || ctx.args?.[0] || '',
        ).toLowerCase();
        if (sub === 'lb' || sub === 'leaderboard') {
          const top = wallet.topDuelists(ctx.guild.id, 10);
          if (!top.length) return ctx.reply('No duel stats yet — `,duel @user` to start.');
          const lines = top.map((row, i) => {
            const medal = MEDALS[i] || `**${i + 1}.**`;
            return `${medal} <@${row.userId}> — ${row.wins}W / ${row.losses}L`;
          });
          return ctx.reply({
            embeds: [baseEmbed({
              color: BRAND.danger,
              title: 'Duel leaderboard',
              description: lines.join('\n'),
              footerExtra: 'pvp',
            })],
          });
        }

        const opponent = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
        if (!opponent || opponent.bot) {
          return ctx.reply('Usage: `,duel @user [wager]` · `,duel lb`');
        }
        if (opponent.id === ctx.user.id) return ctx.reply('You cannot duel yourself.');

        const wagerRaw = ctx.getInteger?.('wager')
          ?? ctx.args?.find((a) => /^\d+$/.test(String(a)));
        let wager = Math.floor(Number(wagerRaw) || 0);
        if (!Number.isFinite(wager) || wager < 0) wager = 0;
        if (wager > cfg.maxWager) {
          return ctx.reply(`Max wager is **${cfg.maxWager}** credits.`);
        }

        if (wallet.isHeld(ctx.guild.id, ctx.user.id)) {
          return ctx.reply('You are on PVP hold.');
        }
        if (wallet.isHeld(ctx.guild.id, opponent.id)) {
          return ctx.reply('That user is on PVP hold.');
        }

        const cdA = wallet.duelCooldownRemaining(ctx.guild.id, ctx.user.id);
        const cdB = wallet.duelCooldownRemaining(ctx.guild.id, opponent.id);
        if (cdA > 0) return ctx.reply(`You are on duel cooldown (<t:${Math.ceil((Date.now() + cdA) / 1000)}:R>).`);
        if (cdB > 0) return ctx.reply('That user is on duel cooldown.');

        if (byUser.has(ctx.user.id) || byUser.has(opponent.id)) {
          return ctx.reply('One of you is already in a duel.');
        }

        if (wager > 0) {
          if (wallet.getBalance(ctx.guild.id, ctx.user.id) < wager) {
            return ctx.reply('You cannot cover that wager. Check `,balance`.');
          }
          if (wallet.getBalance(ctx.guild.id, opponent.id) < wager) {
            return ctx.reply('They cannot cover that wager.');
          }
        }

        const matchId = newMatchId();
        const match = {
          id: matchId,
          guildId: ctx.guild.id,
          channelId: ctx.channel?.id,
          challengerId: ctx.user.id,
          opponentId: opponent.id,
          wager,
          pot: wager * 2,
          status: 'pending',
          escrowed: false,
          hp: { [ctx.user.id]: HP_MAX, [opponent.id]: HP_MAX },
          picks: {},
          round: 1,
          duelCooldownMs: cfg.duelCooldownMs,
          message: null,
          idleTimer: null,
        };
        matches.set(matchId, match);
        byUser.set(ctx.user.id, matchId);
        byUser.set(opponent.id, matchId);
        armIdleTimer(matchId);

        const payload = {
          embeds: [infoEmbed(
            'Duel challenge',
            [
              `<@${ctx.user.id}> challenged <@${opponent.id}>!`,
              wager > 0 ? `Wager: **${wager}** credits each (pot **${wager * 2}**)` : 'Friendly duel — no wager.',
              'Opponent: Accept or Decline. Expires in 90s.',
            ].join('\n'),
          )],
          components: [challengeRow(matchId)],
        };
        const msg = await ctx.reply(payload);
        if (msg && typeof msg.edit === 'function') {
          match.message = msg;
        } else if (ctx.interaction?.fetchReply) {
          match.message = await ctx.interaction.fetchReply().catch(() => null);
        } else if (ctx.message) {
          // Prefix path sometimes returns void — grab the latest bot reply in-channel next tick
          match.message = msg;
        }
        return msg;
      },
    });

    registry.register({
      name: 'forfeit',
      description: 'Forfeit your active duel',
      module: 'pvp',
      async run(ctx) {
        if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
        const matchId = byUser.get(ctx.user.id);
        const match = matchId ? matches.get(matchId) : null;
        if (!match || match.guildId !== ctx.guild.id || match.status === 'done') {
          return ctx.reply('You are not in an active duel.');
        }
        if (match.status === 'pending') {
          match.status = 'done';
          if (match.idleTimer) clearTimeout(match.idleTimer);
          clearUser(match);
          matches.delete(match.id);
          await match.message?.edit?.({
            embeds: [dangerEmbed('Challenge cancelled', `<@${ctx.user.id}> cancelled the challenge.`)],
            components: [],
          }).catch(() => {});
          return ctx.reply('Challenge cancelled.');
        }
        const winnerId = match.challengerId === ctx.user.id ? match.opponentId : match.challengerId;
        await finishMatch(match, winnerId, ctx.user.id, { forfeit: true });
        return ctx.reply('You forfeited.');
      },
    });
  }

  async function onInteraction(interaction) {
    if (!interaction.isButton?.()) return;
    const id = interaction.customId || '';
    if (!id.startsWith('duel:')) return;

    const parts = id.split(':');
    const action = parts[1];
    const matchId = parts[2];
    const move = parts[3];
    const match = matches.get(matchId);
    if (!match) {
      await interaction.reply({ content: 'That duel is over.', ephemeral: true }).catch(() => {});
      return;
    }

    const uid = interaction.user.id;

    if (action === 'accept') {
      if (uid !== match.opponentId) {
        await interaction.reply({ content: 'Only the challenged user can accept.', ephemeral: true }).catch(() => {});
        return;
      }
      if (match.status !== 'pending') {
        await interaction.reply({ content: 'Already started.', ephemeral: true }).catch(() => {});
        return;
      }
      if (wallet.isHeld(match.guildId, match.challengerId) || wallet.isHeld(match.guildId, match.opponentId)) {
        await interaction.reply({ content: 'Someone is on PVP hold.', ephemeral: true }).catch(() => {});
        return;
      }
      if (match.wager > 0) {
        const esc = wallet.escrowPair(
          match.guildId,
          match.challengerId,
          match.opponentId,
          match.wager,
          { matchId: match.id },
        );
        if (!esc.ok) {
          match.status = 'done';
          if (match.idleTimer) clearTimeout(match.idleTimer);
          clearUser(match);
          matches.delete(match.id);
          await interaction.update({
            embeds: [dangerEmbed('Duel cancelled', esc.error)],
            components: [],
          }).catch(() => {});
          return;
        }
        match.escrowed = true;
      }
      match.status = 'active';
      match.message = interaction.message;
      armIdleTimer(match.id);
      mapPose(match.guildId, match.challengerId, 'fight');
      mapPose(match.guildId, match.opponentId, 'fight');
      await interaction.update({
        embeds: [fightEmbed(match, 'Fight!')],
        components: [fightRow(match.id)],
      }).catch(() => {});
      return;
    }

    if (action === 'decline') {
      if (uid !== match.opponentId && uid !== match.challengerId) {
        await interaction.reply({ content: 'Not your duel.', ephemeral: true }).catch(() => {});
        return;
      }
      if (match.status !== 'pending') {
        await interaction.reply({ content: 'Too late — duel already started. Use `,forfeit`.', ephemeral: true }).catch(() => {});
        return;
      }
      match.status = 'done';
      if (match.idleTimer) clearTimeout(match.idleTimer);
      clearUser(match);
      matches.delete(match.id);
      await interaction.update({
        embeds: [dangerEmbed('Declined', `<@${uid}> declined the duel.`)],
        components: [],
      }).catch(() => {});
      return;
    }

    if (action === 'move') {
      if (match.status !== 'active') {
        await interaction.reply({ content: 'Duel is not active.', ephemeral: true }).catch(() => {});
        return;
      }
      if (uid !== match.challengerId && uid !== match.opponentId) {
        await interaction.reply({ content: 'Not your duel.', ephemeral: true }).catch(() => {});
        return;
      }
      if (!MOVES.includes(move)) {
        await interaction.reply({ content: 'Unknown move.', ephemeral: true }).catch(() => {});
        return;
      }
      if (match.picks[uid]) {
        await interaction.reply({ content: 'You already locked in this round.', ephemeral: true }).catch(() => {});
        return;
      }
      match.picks[uid] = move;
      match.message = interaction.message;
      armIdleTimer(match.id);
      mapPose(match.guildId, uid, move);

      const bothReady = match.picks[match.challengerId] && match.picks[match.opponentId];
      if (!bothReady) {
        await interaction.reply({
          content: `Locked **${MOVE_LABEL[move]}**. Waiting for opponent…`,
          ephemeral: true,
        }).catch(() => {});
        // Nudge public embed
        await interaction.message.edit({
          embeds: [fightEmbed(match, `<@${uid}> has locked in…`)],
          components: [fightRow(match.id)],
        }).catch(() => {});
        return;
      }

      await interaction.deferUpdate().catch(() => {});
      await resolveIfReady(match);
    }
  }

  return {
    register,
    onInteraction,
    matches,
  };
}

module.exports = { createPvp, resolveRound, hpBar };
