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
const LOW_HP_THRESHOLD = 30;
const REMATCH_INFO_TTL_MS = 5 * 60_000;
const MOVES = ['attack', 'guard', 'feint'];
const MOVE_LABEL = { attack: 'Attack', guard: 'Guard', feint: 'Feint' };
const MOVE_EMOJI = { attack: '⚔️', guard: '🛡️', feint: '🌀' };
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

/** HP bar line for a fighter, tagged with a low-HP warning. */
function hpLine(userId, hp, max = HP_MAX) {
  const warn = hp > 0 && hp < LOW_HP_THRESHOLD ? ' ⚠️ **low HP!**' : '';
  return `<@${userId}> ${hpBar(hp, max)}${warn}`;
}

function createPvp(deps) {
  const { config, tracker, client } = deps;
  const wallet = deps.wallet || new WalletStore();
  deps.wallet = wallet;

  /** @type {Map<string, object>} matchId -> match */
  const matches = new Map();
  /** userId -> matchId (one active match per user per process) */
  const byUser = new Map();
  /** `${guildId}:${userId}` -> current win streak (in-memory fallback) */
  const streaks = new Map();
  /** matchId -> rematch context, kept briefly after a duel ends */
  const rematchInfo = new Map();

  function streakKey(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  function getStreak(guildId, userId) {
    return streaks.get(streakKey(guildId, userId)) || 0;
  }

  /** Bumps the winner's streak and clears the loser's. Prefers wallet helpers if present. */
  function bumpWinStreak(guildId, winnerId, loserId) {
    let winnerStreak;
    if (typeof wallet.addWinStreak === 'function') {
      winnerStreak = wallet.addWinStreak(guildId, winnerId);
    } else {
      winnerStreak = getStreak(guildId, winnerId) + 1;
      streaks.set(streakKey(guildId, winnerId), winnerStreak);
    }
    if (typeof wallet.breakStreak === 'function') {
      wallet.breakStreak(guildId, loserId);
    } else {
      streaks.set(streakKey(guildId, loserId), 0);
    }
    return winnerStreak;
  }

  function resetStreak(guildId, userId) {
    if (typeof wallet.breakStreak === 'function') {
      wallet.breakStreak(guildId, userId);
    } else {
      streaks.set(streakKey(guildId, userId), 0);
    }
  }

  /** Remembers who can rematch a just-finished duel, for a short window. */
  function rememberRematch(matchId, info) {
    rematchInfo.set(matchId, info);
    setTimeout(() => rematchInfo.delete(matchId), REMATCH_INFO_TTL_MS);
  }

  function ecoCfg(guildId) {
    const c = config.get(guildId).economy || {};
    return {
      enabled: c.enabled !== false,
      maxWager: Number(c.maxWager ?? 250),
      duelCooldownMs: Number(c.duelCooldownMs ?? 60_000),
      dmNotify: c.dmNotify !== false,
    };
  }

  function newMatchId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function clearUser(match) {
    if (!match) return;
    byUser.delete(match.challengerId);
    if (match.opponentId) byUser.delete(match.opponentId);
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

  function rematchRow(matchId) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`duel:rematch:${matchId}`)
        .setLabel('Rematch')
        .setEmoji('🔁')
        .setStyle(ButtonStyle.Primary),
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
      hpLine(match.challengerId, match.hp[match.challengerId]),
      hpLine(match.opponentId, match.hp[match.opponentId]),
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
    try { wallet.addWeeklyWin?.(match.guildId, winnerId); } catch (_) { /* ignore */ }
    try { wallet.ensureWeeklyReset?.(match.guildId); } catch (_) { /* ignore */ }
    wallet.setDuelCooldown(match.guildId, match.challengerId, match.duelCooldownMs);
    wallet.setDuelCooldown(match.guildId, match.opponentId, match.duelCooldownMs);
    mapPose(match.guildId, winnerId, 'win', 6000);
    mapPose(match.guildId, loserId, 'lose', 6000);

    const winnerStreak = bumpWinStreak(match.guildId, winnerId, loserId);
    const streakLine = winnerStreak >= 2 ? `\n🔥 **${winnerStreak}** win streak!` : '';

    const desc = (opts.forfeit
      ? `<@${loserId}> forfeited. <@${winnerId}> wins **${pot}** credits.`
      : `<@${winnerId}> wins the duel and takes **${pot}** credits!`)
      + streakLine
      + (opts.note ? `\n\n${opts.note}` : '');

    rememberRematch(match.id, {
      guildId: match.guildId,
      channelId: match.channelId,
      challengerId: match.challengerId,
      opponentId: match.opponentId,
      wager: match.wager,
      winnerId,
    });

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
          components: [rematchRow(match.id)],
        });
      }
    } catch (_) { /* ignore */ }

    const cfg = ecoCfg(match.guildId);
    if (cfg.dmNotify && client && match.opponentId) {
      const dmLine = opts.forfeit
        ? `<@${winnerId}> wins — <@${loserId}> forfeited.${pot > 0 ? ` Pot: **${pot}** credits.` : ''}`
        : `<@${winnerId}> won the duel${pot > 0 ? ` and took **${pot}** credits` : ''}!`;
      for (const playerId of [match.challengerId, match.opponentId]) {
        try {
          const user = await client.users.fetch(playerId);
          await user.send(dmLine);
        } catch (_) { /* ignore */ }
      }
    }
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

    // aDmg is damage taken by a (dealt by b's move); bDmg is damage taken by b (dealt by a's move).
    const noteLines = [
      `<@${a}> ${MOVE_EMOJI[aMove]} **${MOVE_LABEL[aMove]}**${result.bDmg > 0 ? ` — dealt **${result.bDmg}** dmg` : ''}`,
      `<@${b}> ${MOVE_EMOJI[bMove]} **${MOVE_LABEL[bMove]}**${result.aDmg > 0 ? ` — dealt **${result.aDmg}** dmg` : ''}`,
      result.note,
    ];
    const warnings = [];
    if (match.hp[a] > 0 && match.hp[a] < LOW_HP_THRESHOLD) warnings.push(`<@${a}>`);
    if (match.hp[b] > 0 && match.hp[b] < LOW_HP_THRESHOLD) warnings.push(`<@${b}>`);
    if (warnings.length) noteLines.push(`⚠️ ${warnings.join(' & ')} low HP!`);
    const note = noteLines.join('\n');

    if (match.hp[a] <= 0 && match.hp[b] <= 0) {
      // Mutual KO — refund and call draw (no winner stats)
      match.status = 'done';
      if (match.idleTimer) clearTimeout(match.idleTimer);
      if (match.escrowed && match.wager > 0) {
        wallet.refundEscrow(match.guildId, a, b, match.wager, { matchId: match.id, reason: 'draw' });
        match.escrowed = false;
      }
      resetStreak(match.guildId, a);
      resetStreak(match.guildId, b);
      rememberRematch(match.id, {
        guildId: match.guildId,
        channelId: match.channelId,
        challengerId: match.challengerId,
        opponentId: match.opponentId,
        wager: match.wager,
        winnerId: null,
      });
      clearUser(match);
      matches.delete(match.id);
      await match.message?.edit?.({
        embeds: [infoEmbed('Draw', `${note}\n\nDouble KO — wager refunded.`)],
        components: [rematchRow(match.id)],
      }).catch(() => {});
      return;
    }
    if (match.hp[a] <= 0) {
      await finishMatch(match, b, a, { note });
      return;
    }
    if (match.hp[b] <= 0) {
      await finishMatch(match, a, b, { note });
      return;
    }

    armIdleTimer(match.id);
    await match.message?.edit?.({
      embeds: [fightEmbed(match, note)],
      components: [fightRow(match.id)],
    }).catch(() => {});
  }

  /** Builds + registers a pending challenge match; returns the match and its reply payload. */
  function createPendingMatch({
    guildId, channelId, challengerId, opponentId, wager, duelCooldownMs, open = false,
  }) {
    const matchId = newMatchId();
    const isOpen = !!open;
    const oppId = opponentId || null;
    const hp = { [challengerId]: HP_MAX };
    if (oppId) hp[oppId] = HP_MAX;

    const match = {
      id: matchId,
      guildId,
      channelId,
      challengerId,
      opponentId: oppId,
      open: isOpen,
      wager,
      pot: wager * 2,
      status: 'pending',
      escrowed: false,
      hp,
      picks: {},
      round: 1,
      duelCooldownMs,
      message: null,
      idleTimer: null,
    };
    matches.set(matchId, match);
    byUser.set(challengerId, matchId);
    if (oppId) byUser.set(oppId, matchId);
    armIdleTimer(matchId);

    const lines = isOpen
      ? [
        `<@${challengerId}> posted an open duel!`,
        wager > 0 ? `Wager: **${wager}** credits each (pot **${wager * 2}**)` : 'Friendly duel — no wager.',
        'Anyone can Accept (except the challenger). Expires in 90s.',
      ]
      : [
        `<@${challengerId}> challenged <@${oppId}>!`,
        wager > 0 ? `Wager: **${wager}** credits each (pot **${wager * 2}**)` : 'Friendly duel — no wager.',
        'Opponent: Accept or Decline. Expires in 90s.',
      ];

    const payload = {
      embeds: [infoEmbed('Duel challenge', lines.join('\n'))],
      components: [challengeRow(matchId)],
    };
    return { match, payload };
  }

  function parseWager(ctx, cfg) {
    const wagerRaw = ctx.getInteger?.('wager')
      ?? ctx.args?.find((a) => /^\d+$/.test(String(a)));
    let wager = Math.floor(Number(wagerRaw) || 0);
    if (!Number.isFinite(wager) || wager < 0) wager = 0;
    if (wager > cfg.maxWager) return { error: `Max wager is **${cfg.maxWager}** credits.` };
    return { wager };
  }

  async function postChallenge(ctx, cfg, { challengerId, opponentId, open, wager }) {
    if (wallet.isBlacklisted?.(ctx.guild.id, challengerId)) {
      return ctx.reply('You cannot duel here.');
    }
    if (opponentId && wallet.isBlacklisted?.(ctx.guild.id, opponentId)) {
      return ctx.reply('That user cannot duel.');
    }

    if (wallet.isHeld(ctx.guild.id, challengerId)) {
      return ctx.reply('You are on PVP hold.');
    }
    if (opponentId && wallet.isHeld(ctx.guild.id, opponentId)) {
      return ctx.reply('That user is on PVP hold.');
    }

    const cdA = wallet.duelCooldownRemaining(ctx.guild.id, challengerId);
    if (cdA > 0) {
      return ctx.reply(`You are on duel cooldown (<t:${Math.ceil((Date.now() + cdA) / 1000)}:R>).`);
    }
    if (opponentId) {
      const cdB = wallet.duelCooldownRemaining(ctx.guild.id, opponentId);
      if (cdB > 0) return ctx.reply('That user is on duel cooldown.');
    }

    if (byUser.has(challengerId)) {
      return ctx.reply('You are already in a duel.');
    }
    if (opponentId && byUser.has(opponentId)) {
      return ctx.reply('That user is already in a duel.');
    }

    if (wager > 0) {
      if (wallet.getBalance(ctx.guild.id, challengerId) < wager) {
        return ctx.reply('You cannot cover that wager. Check `,balance`.');
      }
      if (opponentId && wallet.getBalance(ctx.guild.id, opponentId) < wager) {
        return ctx.reply('They cannot cover that wager.');
      }
    }

    const { match, payload } = createPendingMatch({
      guildId: ctx.guild.id,
      channelId: ctx.channel?.id,
      challengerId,
      opponentId,
      open,
      wager,
      duelCooldownMs: cfg.duelCooldownMs,
    });
    const msg = await ctx.reply(payload);
    if (msg && typeof msg.edit === 'function') {
      match.message = msg;
    } else if (ctx.interaction?.fetchReply) {
      match.message = await ctx.interaction.fetchReply().catch(() => null);
    } else if (ctx.message) {
      match.message = msg;
    }

    if (!open && opponentId && cfg.dmNotify && client) {
      try {
        const user = await client.users.fetch(opponentId);
        await user.send(`You were challenged to a duel in **${ctx.guild.name}**.`);
      } catch (_) { /* ignore */ }
    }
    return msg;
  }

  function register(registry) {
    registry.register({
      name: 'duel',
      description: 'Challenge someone to a Credits duel',
      module: 'pvp',
      priority: 5, // high-traffic — keep slash even if budget gets tight
      public: true,
      options: [
        { type: 6, name: 'user', description: 'Opponent (omit for leaderboard with wager unused)', required: false },
        { type: 4, name: 'wager', description: 'Credits each side puts in', required: false },
        {
          type: 3,
          name: 'action',
          description: 'lb = leaderboard · open = open challenge board',
          required: false,
          choices: [
            { name: 'lb', value: 'lb' },
            { name: 'open', value: 'open' },
          ],
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
          const mode = String(ctx.args?.[1] || '').toLowerCase();
          if (mode === 'weekly' || mode === 'week') {
            const top = wallet.topWeeklyWins?.(ctx.guild.id, 10) || [];
            if (!top.length) return ctx.reply('No weekly duel wins yet — fight with `,duel`.');
            const lines = top.map((row, i) => {
              const medal = MEDALS[i] || `**${i + 1}.**`;
              return `${medal} <@${row.userId}> — **${row.wins}** wins this week`;
            });
            return ctx.reply({
              embeds: [baseEmbed({
                color: BRAND.danger,
                title: 'Weekly duel wins',
                description: lines.join('\n'),
                footerExtra: 'pvp · weekly',
              })],
            });
          }
          if ((mode === 'streak' || mode === 'streaks') && typeof wallet.topStreaks === 'function') {
            const top = wallet.topStreaks(ctx.guild.id, 10);
            if (!top.length) return ctx.reply('No streaks yet.');
            const lines = top.map((row, i) => {
              const medal = MEDALS[i] || `**${i + 1}.**`;
              return `${medal} <@${row.userId}> — 🔥 ${row.streak} (best ${row.bestStreak})`;
            });
            return ctx.reply({
              embeds: [baseEmbed({
                color: BRAND.danger,
                title: 'Duel streak leaderboard',
                description: lines.join('\n'),
                footerExtra: 'pvp · streaks',
              })],
            });
          }
          const top = wallet.topDuelists(ctx.guild.id, 10);
          if (!top.length) return ctx.reply('No duel stats yet — `,duel @user` to start.');
          const lines = top.map((row, i) => {
            const medal = MEDALS[i] || `**${i + 1}.**`;
            return `${medal} <@${row.userId}> — ${row.wins}W / ${row.losses}L · ${row.forfeits || 0}F`;
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

        if (sub === 'open') {
          const wagerResult = parseWager(ctx, cfg);
          if (wagerResult.error) return ctx.reply(wagerResult.error);
          return postChallenge(ctx, cfg, {
            challengerId: ctx.user.id,
            opponentId: null,
            open: true,
            wager: wagerResult.wager,
          });
        }

        const opponent = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
        if (!opponent || opponent.bot) {
          return ctx.reply('Usage: `,duel @user [wager]` · `,duel open [wager]` · `,duel lb [weekly|streak]`');
        }
        if (opponent.id === ctx.user.id) return ctx.reply('You cannot duel yourself.');

        const wagerResult = parseWager(ctx, cfg);
        if (wagerResult.error) return ctx.reply(wagerResult.error);

        return postChallenge(ctx, cfg, {
          challengerId: ctx.user.id,
          opponentId: opponent.id,
          open: false,
          wager: wagerResult.wager,
        });
      },
    });

    registry.register({
      name: 'forfeit',
      description: 'Forfeit your active duel',
      module: 'pvp',
      // Rare/emergency action — always reachable via `,forfeit`, but doesn't
      // need to eat slash-command budget from the 100-cap.
      slash: false,
      public: true,
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

  /** Rebuilds a fresh challenge between the same two players, same wager. */
  async function handleRematch(interaction, oldMatchId) {
    const info = rematchInfo.get(oldMatchId);
    const uid = interaction.user.id;
    if (!info) {
      await interaction.reply({ content: 'Rematch unavailable — start a new one with `,duel`.', ephemeral: true }).catch(() => {});
      return;
    }
    if (uid !== info.challengerId && uid !== info.opponentId) {
      await interaction.reply({ content: 'Not your duel.', ephemeral: true }).catch(() => {});
      return;
    }
    // Winner (if any) leads the rematch challenge; draws keep the original challenger.
    const challengerId = info.winnerId || info.challengerId;
    const opponentId = challengerId === info.challengerId ? info.opponentId : info.challengerId;

    if (byUser.has(challengerId) || byUser.has(opponentId)) {
      await interaction.reply({ content: 'One of you is already in a duel.', ephemeral: true }).catch(() => {});
      return;
    }
    if (wallet.isHeld(info.guildId, challengerId) || wallet.isHeld(info.guildId, opponentId)) {
      await interaction.reply({ content: 'Someone is on PVP hold.', ephemeral: true }).catch(() => {});
      return;
    }
    if (info.wager > 0 && (
      wallet.getBalance(info.guildId, challengerId) < info.wager
      || wallet.getBalance(info.guildId, opponentId) < info.wager
    )) {
      await interaction.reply({ content: "Someone can't cover that wager anymore.", ephemeral: true }).catch(() => {});
      return;
    }

    rematchInfo.delete(oldMatchId);
    // Rematches bypass duel cooldown once; a fresh cooldown still applies once this one ends.
    const cfg = ecoCfg(info.guildId);
    const { match, payload } = createPendingMatch({
      guildId: info.guildId,
      channelId: info.channelId,
      challengerId,
      opponentId,
      wager: info.wager,
      duelCooldownMs: cfg.duelCooldownMs,
    });
    match.message = interaction.message;
    await interaction.update(payload).catch(() => {});
  }

  async function onInteraction(interaction) {
    if (!interaction.isButton?.()) return;
    const id = interaction.customId || '';
    if (!id.startsWith('duel:')) return;

    const parts = id.split(':');
    const action = parts[1];
    const matchId = parts[2];
    const move = parts[3];

    if (action === 'rematch') {
      await handleRematch(interaction, matchId);
      return;
    }

    const match = matches.get(matchId);
    if (!match) {
      await interaction.reply({ content: 'That duel is over.', ephemeral: true }).catch(() => {});
      return;
    }

    const uid = interaction.user.id;

    if (action === 'accept') {
      if (uid === match.challengerId) {
        await interaction.reply({ content: 'You cannot accept your own challenge.', ephemeral: true }).catch(() => {});
        return;
      }
      if (!match.open && uid !== match.opponentId) {
        await interaction.reply({ content: 'Only the challenged user can accept.', ephemeral: true }).catch(() => {});
        return;
      }
      if (match.open && !match.opponentId) {
        if (byUser.has(uid)) {
          await interaction.reply({ content: 'You already have an active duel.', ephemeral: true }).catch(() => {});
          return;
        }
        if (wallet.isBlacklisted?.(match.guildId, uid)) {
          await interaction.reply({ content: 'You cannot duel here.', ephemeral: true }).catch(() => {});
          return;
        }
        const cdB = wallet.duelCooldownRemaining(match.guildId, uid);
        if (cdB > 0) {
          await interaction.reply({ content: 'You are on duel cooldown.', ephemeral: true }).catch(() => {});
          return;
        }
        if (match.wager > 0 && wallet.getBalance(match.guildId, uid) < match.wager) {
          await interaction.reply({ content: "You can't cover that wager.", ephemeral: true }).catch(() => {});
          return;
        }
        match.opponentId = uid;
        match.open = false;
        match.hp[uid] = HP_MAX;
        byUser.set(uid, match.id);
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
      const startNote = match.wager > 0
        ? `Fight! Pot: **${match.pot}** credits · both fighters start at ${HP_MAX}/${HP_MAX} HP.`
        : `Fight! Friendly duel · both fighters start at ${HP_MAX}/${HP_MAX} HP.`;
      await interaction.update({
        embeds: [fightEmbed(match, startNote)],
        components: [fightRow(match.id)],
      }).catch(() => {});
      return;
    }

    if (action === 'decline') {
      if (match.open) {
        if (uid !== match.challengerId) {
          await interaction.reply({ content: 'Only the challenger can cancel an open challenge.', ephemeral: true }).catch(() => {});
          return;
        }
      } else if (uid !== match.opponentId && uid !== match.challengerId) {
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
      const label = match.open ? 'Cancelled' : 'Declined';
      const verb = match.open ? 'cancelled' : 'declined';
      await interaction.update({
        embeds: [dangerEmbed(label, `<@${uid}> ${verb} the duel.`)],
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
        await interaction.reply({ content: 'Already locked in.', ephemeral: true }).catch(() => {});
        return;
      }
      match.picks[uid] = move;
      match.message = interaction.message;
      armIdleTimer(match.id);
      mapPose(match.guildId, uid, move);

      const bothReady = match.picks[match.challengerId] && match.picks[match.opponentId];
      if (!bothReady) {
        const otherId = uid === match.challengerId ? match.opponentId : match.challengerId;
        await interaction.reply({
          content: `${MOVE_EMOJI[move]} Locked in.`,
          ephemeral: true,
        }).catch(() => {});
        // Nudge public embed without revealing the move.
        await interaction.message.edit({
          embeds: [fightEmbed(match, `⏳ Waiting on <@${otherId}>…`)],
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
