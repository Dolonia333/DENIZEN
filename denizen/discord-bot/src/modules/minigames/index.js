'use strict';

/**
 * Quick minigames — coinflip and rock-paper-scissors with optional Credits wagers.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { successEmbed, infoEmbed, dangerEmbed, baseEmbed, BRAND } = require('../../core/ui-kit');
const { WalletStore } = require('../../core/wallet-store');

const IDLE_MS = 60_000;
const FLIP_COOLDOWN_MS = 15_000;
const RPS_CHOICES = ['rock', 'paper', 'scissors'];
const RPS_LABEL = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' };
const RPS_EMOJI = { rock: '🪨', paper: '📄', scissors: '✂️' };

/** @returns {'heads'|'tails'} */
function flipCoin() {
  return Math.random() < 0.5 ? 'heads' : 'tails';
}

/**
 * @param {'rock'|'paper'|'scissors'} a
 * @param {'rock'|'paper'|'scissors'} b
 * @returns {{ winner: 'a'|'b'|null, note: string }}
 */
function resolveRps(a, b) {
  if (a === b) return { winner: null, note: 'Same pick — draw!' };
  const beats = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
  if (beats[a] === b) {
    return { winner: 'a', note: `${RPS_EMOJI[a]} **${RPS_LABEL[a]}** beats **${RPS_LABEL[b]}**` };
  }
  return { winner: 'b', note: `${RPS_EMOJI[b]} **${RPS_LABEL[b]}** beats **${RPS_LABEL[a]}**` };
}

function createMinigames(deps) {
  const { config } = deps;
  const wallet = deps.wallet || new WalletStore();
  deps.wallet = wallet;

  /** @type {Map<string, object>} */
  const matches = new Map();
  /** userId -> matchId */
  const byUser = new Map();
  /** `${guildId}:${userId}` -> last coinflip challenge ts */
  const flipCooldown = new Map();

  function ecoCfg(guildId) {
    const c = config.get(guildId).economy || {};
    return {
      enabled: c.enabled !== false,
      maxWager: Number(c.maxWager ?? 250),
    };
  }

  function isBlacklisted(guildId, userId) {
    return typeof wallet.isBlacklisted === 'function' && wallet.isBlacklisted(guildId, userId);
  }

  function flipCdRemaining(guildId, userId) {
    const last = flipCooldown.get(`${guildId}:${userId}`) || 0;
    return Math.max(0, FLIP_COOLDOWN_MS - (Date.now() - last));
  }

  function touchFlipCooldown(guildId, userId) {
    flipCooldown.set(`${guildId}:${userId}`, Date.now());
  }

  function newMatchId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function clearUser(match) {
    if (!match) return;
    byUser.delete(match.challengerId);
    if (match.opponentId) byUser.delete(match.opponentId);
  }

  function challengeRow(kind, matchId) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mg:${kind}:accept:${matchId}`)
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`mg:${kind}:decline:${matchId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger),
    );
  }

  function rpsPickRow(matchId, disabled = false) {
    return new ActionRowBuilder().addComponents(
      RPS_CHOICES.map((pick) =>
        new ButtonBuilder()
          .setCustomId(`mg:rps:pick:${matchId}:${pick}`)
          .setLabel(RPS_LABEL[pick])
          .setEmoji(RPS_EMOJI[pick])
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled),
      ),
    );
  }

  function parseWager(raw, maxWager) {
    let wager = Math.floor(Number(raw) || 0);
    if (!Number.isFinite(wager) || wager < 0) wager = 0;
    if (wager > maxWager) return { error: `Max wager is **${maxWager}** credits.` };
    return { wager };
  }

  function parseTarget(ctx) {
    const modeOpen = String(ctx.getString?.('mode') || '').toLowerCase() === 'open';
    const first = String(ctx.args?.[0] || '').toLowerCase();
    if (modeOpen || first === 'open') {
      const wagerRaw = ctx.args?.find((a, i) => i > 0 && /^\d+$/.test(String(a)));
      return { open: true, opponent: null, wagerRaw };
    }
    const opponent = ctx.getUser?.('user') || ctx.message?.mentions?.users?.first?.();
    const wagerRaw = ctx.getInteger?.('wager')
      ?? ctx.args?.find((a) => /^\d+$/.test(String(a)));
    return { open: false, opponent, wagerRaw };
  }

  function guardChallenge(ctx, cfg, opponent, wager) {
    if (!cfg.enabled) return 'Credits / minigames are disabled here.';
    if (isBlacklisted(ctx.guild.id, ctx.user.id)) return 'You cannot wager here.';
    if (opponent && isBlacklisted(ctx.guild.id, opponent.id)) return 'That user cannot wager.';

    if (wallet.isHeld(ctx.guild.id, ctx.user.id)) return 'You are on PVP hold.';
    if (opponent && wallet.isHeld(ctx.guild.id, opponent.id)) return 'That user is on PVP hold.';

    if (byUser.has(ctx.user.id)) return 'You already have an active minigame.';
    if (opponent && byUser.has(opponent.id)) return 'That user is already in a minigame.';

    if (wager > 0) {
      if (wallet.getBalance(ctx.guild.id, ctx.user.id) < wager) {
        return 'You cannot cover that wager. Check `,balance`.';
      }
      if (opponent && wallet.getBalance(ctx.guild.id, opponent.id) < wager) {
        return 'They cannot cover that wager.';
      }
    }
    return null;
  }

  function armIdleTimer(matchId) {
    const match = matches.get(matchId);
    if (!match) return;
    if (match.idleTimer) clearTimeout(match.idleTimer);
    match.idleTimer = setTimeout(() => {
      void expireMatch(matchId);
    }, IDLE_MS);
  }

  async function expireMatch(matchId) {
    const match = matches.get(matchId);
    if (!match || match.status === 'done') return;
    match.status = 'done';
    if (match.idleTimer) clearTimeout(match.idleTimer);
    if (match.escrowed && match.wager > 0) {
      wallet.refundEscrow(match.guildId, match.challengerId, match.opponentId, match.wager, {
        matchId,
        reason: 'minigame_idle',
      });
    }
    clearUser(match);
    matches.delete(matchId);
    try {
      if (match.message?.edit) {
        await match.message.edit({
          embeds: [dangerEmbed(
            'Challenge expired',
            match.escrowed
              ? 'No action for 60s — wager refunded.'
              : 'Challenge timed out — no credits moved.',
          )],
          components: [],
        });
      }
    } catch (_) { /* ignore */ }
  }

  async function finishCoinflip(match) {
    const side = flipCoin();
    const challengerSide = 'heads';
    const opponentSide = 'tails';
    const winnerId = side === 'heads' ? match.challengerId : match.opponentId;

    match.status = 'done';
    if (match.idleTimer) clearTimeout(match.idleTimer);
    if (match.escrowed && match.pot > 0) {
      wallet.payPot(match.guildId, winnerId, match.pot, { matchId: match.id, game: 'coinflip' });
      match.escrowed = false;
    }
    clearUser(match);
    matches.delete(match.id);

    const desc = [
      `The coin landed on **${side}**!`,
      `<@${match.challengerId}> had **${challengerSide}**, <@${match.opponentId}> had **${opponentSide}**.`,
      `<@${winnerId}> wins${match.wager > 0 ? ` **${match.pot}** credits` : ''}!`,
    ].join('\n');

    await match.message?.edit?.({
      embeds: [successEmbed('Coinflip', desc)],
      components: [],
    }).catch(() => {});
  }

  async function finishRps(match) {
    const a = match.challengerId;
    const b = match.opponentId;
    const pickA = match.picks[a];
    const pickB = match.picks[b];
    const result = resolveRps(pickA, pickB);

    match.status = 'done';
    if (match.idleTimer) clearTimeout(match.idleTimer);

    if (result.winner === null) {
      if (match.escrowed && match.wager > 0) {
        wallet.refundEscrow(match.guildId, a, b, match.wager, { matchId: match.id, reason: 'rps_draw' });
        match.escrowed = false;
      }
      clearUser(match);
      matches.delete(match.id);
      await match.message?.edit?.({
        embeds: [infoEmbed('Rock Paper Scissors — Draw', [
          `<@${a}> ${RPS_EMOJI[pickA]} **${RPS_LABEL[pickA]}**`,
          `<@${b}> ${RPS_EMOJI[pickB]} **${RPS_LABEL[pickB]}**`,
          result.note,
          match.wager > 0 ? 'Wager refunded.' : '',
        ].filter(Boolean).join('\n'))],
        components: [],
      }).catch(() => {});
      return;
    }

    const winnerId = result.winner === 'a' ? a : b;
    const loserId = result.winner === 'a' ? b : a;
    if (match.escrowed && match.pot > 0) {
      wallet.payPot(match.guildId, winnerId, match.pot, { matchId: match.id, game: 'rps' });
      match.escrowed = false;
    }
    clearUser(match);
    matches.delete(match.id);

    const desc = [
      `<@${a}> ${RPS_EMOJI[pickA]} **${RPS_LABEL[pickA]}**`,
      `<@${b}> ${RPS_EMOJI[pickB]} **${RPS_LABEL[pickB]}**`,
      result.note,
      `<@${winnerId}> wins${match.wager > 0 ? ` **${match.pot}** credits` : ''}!`,
    ].join('\n');

    await match.message?.edit?.({
      embeds: [successEmbed('Rock Paper Scissors', desc)],
      components: [],
    }).catch(() => {});
  }

  function challengeEmbed(kind, match) {
    const title = kind === 'cf' ? 'Coinflip challenge' : 'RPS challenge';
    const lines = match.open
      ? [`<@${match.challengerId}> posted an open **${kind === 'cf' ? 'coinflip' : 'rock-paper-scissors'}** challenge!`]
      : [`<@${match.challengerId}> challenged <@${match.opponentId}>!`];
    if (match.wager > 0) {
      lines.push(`Wager: **${match.wager}** credits each (pot **${match.pot}**)`);
    } else {
      lines.push('Friendly match — no wager.');
    }
    lines.push(
      match.open ? 'Anyone can Accept (except the challenger). Expires in 60s.' : 'Accept or Cancel. Expires in 60s.',
    );
    return infoEmbed(title, lines.join('\n'));
  }

  function createPendingMatch({ kind, guildId, channelId, challengerId, opponentId, open, wager }) {
    const matchId = newMatchId();
    const match = {
      id: matchId,
      kind,
      guildId,
      channelId,
      challengerId,
      opponentId: opponentId || null,
      open: !!open,
      wager,
      pot: wager * 2,
      status: 'pending',
      escrowed: false,
      picks: {},
      message: null,
      idleTimer: null,
    };
    matches.set(matchId, match);
    byUser.set(challengerId, matchId);
    if (opponentId) byUser.set(opponentId, matchId);
    armIdleTimer(matchId);
    return {
      match,
      payload: {
        embeds: [challengeEmbed(kind, match)],
        components: [challengeRow(kind, matchId)],
      },
    };
  }

  async function startChallenge(ctx, kind) {
    if (!ctx.guild?.id) return ctx.reply('Use this in a server.');
    const cfg = ecoCfg(ctx.guild.id);
    const { open, opponent, wagerRaw } = parseTarget(ctx);
    const wagerResult = parseWager(wagerRaw, cfg.maxWager);
    if (wagerResult.error) return ctx.reply(wagerResult.error);
    const wager = wagerResult.wager;

    if (!open) {
      if (!opponent || opponent.bot) {
        const usage = kind === 'cf'
          ? 'Usage: `,coinflip @user [wager]` · `,coinflip open [wager]`'
          : 'Usage: `,rps @user [wager]` · `,rps open [wager]`';
        return ctx.reply(usage);
      }
      if (opponent.id === ctx.user.id) return ctx.reply('You cannot challenge yourself.');
    }

    const guard = guardChallenge(ctx, cfg, opponent, wager);
    if (guard) return ctx.reply(guard);

    if (kind === 'cf') {
      const cd = flipCdRemaining(ctx.guild.id, ctx.user.id);
      if (cd > 0) {
        return ctx.reply(`Coinflip cooldown — try again <t:${Math.ceil((Date.now() + cd) / 1000)}:R>.`);
      }
      touchFlipCooldown(ctx.guild.id, ctx.user.id);
    }

    const { match, payload } = createPendingMatch({
      kind,
      guildId: ctx.guild.id,
      channelId: ctx.channel?.id,
      challengerId: ctx.user.id,
      opponentId: open ? null : opponent.id,
      open,
      wager,
    });

    const msg = await ctx.reply(payload);
    if (msg && typeof msg.edit === 'function') {
      match.message = msg;
    } else if (ctx.interaction?.fetchReply) {
      match.message = await ctx.interaction.fetchReply().catch(() => null);
    }
    return msg;
  }

  async function handleAccept(interaction, match, kind) {
    const uid = interaction.user.id;
    if (match.status !== 'pending') {
      await interaction.reply({ content: 'Already started.', ephemeral: true }).catch(() => {});
      return;
    }
    if (uid === match.challengerId) {
      await interaction.reply({ content: 'You cannot accept your own challenge.', ephemeral: true }).catch(() => {});
      return;
    }
    if (!match.open && uid !== match.opponentId) {
      await interaction.reply({ content: 'Only the challenged user can accept.', ephemeral: true }).catch(() => {});
      return;
    }
    if (match.open && byUser.has(uid)) {
      await interaction.reply({ content: 'You already have an active minigame.', ephemeral: true }).catch(() => {});
      return;
    }

    if (isBlacklisted(match.guildId, uid)) {
      await interaction.reply({ content: 'You cannot wager here.', ephemeral: true }).catch(() => {});
      return;
    }
    if (wallet.isHeld(match.guildId, match.challengerId) || wallet.isHeld(match.guildId, uid)) {
      await interaction.reply({ content: 'Someone is on PVP hold.', ephemeral: true }).catch(() => {});
      return;
    }

    if (match.open) {
      match.opponentId = uid;
      match.open = false;
      byUser.set(uid, match.id);
    }

    if (match.wager > 0) {
      const esc = wallet.escrowPair(
        match.guildId,
        match.challengerId,
        match.opponentId,
        match.wager,
        { matchId: match.id, game: kind },
      );
      if (!esc.ok) {
        match.status = 'done';
        if (match.idleTimer) clearTimeout(match.idleTimer);
        clearUser(match);
        matches.delete(match.id);
        await interaction.update({
          embeds: [dangerEmbed('Challenge cancelled', esc.error)],
          components: [],
        }).catch(() => {});
        return;
      }
      match.escrowed = true;
    }

    match.message = interaction.message;
    armIdleTimer(match.id);

    if (kind === 'cf') {
      match.status = 'active';
      await interaction.update({
        embeds: [infoEmbed('Coinflip', 'Flipping…')],
        components: [],
      }).catch(() => {});
      await finishCoinflip(match);
      return;
    }

    match.status = 'picking';
    await interaction.update({
      embeds: [baseEmbed({
        color: BRAND.primary,
        title: 'Rock Paper Scissors',
        description: [
          `<@${match.challengerId}> vs <@${match.opponentId}>`,
          match.wager > 0 ? `Pot: **${match.pot}** credits` : 'Friendly match',
          'Both players — pick Rock, Paper, or Scissors!',
        ].join('\n'),
        footerExtra: 'minigames',
      })],
      components: [rpsPickRow(match.id)],
    }).catch(() => {});
  }

  async function handleDecline(interaction, match) {
    const uid = interaction.user.id;
    if (match.open) {
      if (uid !== match.challengerId) {
        await interaction.reply({ content: 'Only the challenger can cancel an open challenge.', ephemeral: true }).catch(() => {});
        return;
      }
    } else if (uid !== match.challengerId && uid !== match.opponentId) {
      await interaction.reply({ content: 'Not your challenge.', ephemeral: true }).catch(() => {});
      return;
    }
    if (match.status !== 'pending') {
      await interaction.reply({ content: 'Too late — match already started.', ephemeral: true }).catch(() => {});
      return;
    }
    match.status = 'done';
    if (match.idleTimer) clearTimeout(match.idleTimer);
    clearUser(match);
    matches.delete(match.id);
    await interaction.update({
      embeds: [dangerEmbed('Cancelled', `<@${uid}> cancelled the challenge.`)],
      components: [],
    }).catch(() => {});
  }

  async function handleRpsPick(interaction, match, pick) {
    const uid = interaction.user.id;
    if (match.status !== 'picking') {
      await interaction.reply({ content: 'Not accepting picks.', ephemeral: true }).catch(() => {});
      return;
    }
    if (uid !== match.challengerId && uid !== match.opponentId) {
      await interaction.reply({ content: 'Not your match.', ephemeral: true }).catch(() => {});
      return;
    }
    if (!RPS_CHOICES.includes(pick)) {
      await interaction.reply({ content: 'Unknown pick.', ephemeral: true }).catch(() => {});
      return;
    }
    if (match.picks[uid]) {
      await interaction.reply({ content: 'Already locked in.', ephemeral: true }).catch(() => {});
      return;
    }

    match.picks[uid] = pick;
    match.message = interaction.message;
    armIdleTimer(match.id);

    const a = match.challengerId;
    const b = match.opponentId;
    if (!match.picks[a] || !match.picks[b]) {
      const otherId = uid === a ? b : a;
      await interaction.reply({
        content: `${RPS_EMOJI[pick]} Locked in.`,
        ephemeral: true,
      }).catch(() => {});
      await interaction.message.edit({
        embeds: [baseEmbed({
          color: BRAND.primary,
          title: 'Rock Paper Scissors',
          description: [
            `<@${a}> vs <@${b}>`,
            match.wager > 0 ? `Pot: **${match.pot}** credits` : 'Friendly match',
            `⏳ Waiting on <@${otherId}>…`,
          ].join('\n'),
          footerExtra: 'minigames',
        })],
        components: [rpsPickRow(match.id)],
      }).catch(() => {});
      return;
    }

    await interaction.deferUpdate().catch(() => {});
    await finishRps(match);
  }

  function register(registry) {
    registry.register({
      name: 'coinflip',
      description: 'Challenge someone to a coinflip (optional wager)',
      module: 'minigames',
      aliases: ['flip', 'cf'],
      public: true,
      options: [
        { type: 6, name: 'user', description: 'Opponent (omit for open challenge)', required: false },
        { type: 4, name: 'wager', description: 'Credits each side puts in', required: false },
        {
          type: 3,
          name: 'mode',
          description: 'open = anyone can accept',
          required: false,
          choices: [{ name: 'open', value: 'open' }],
        },
      ],
      async run(ctx) {
        return startChallenge(ctx, 'cf');
      },
    });

    registry.register({
      name: 'rps',
      description: 'Rock paper scissors duel (optional wager)',
      module: 'minigames',
      public: true,
      options: [
        { type: 6, name: 'user', description: 'Opponent (omit for open challenge)', required: false },
        { type: 4, name: 'wager', description: 'Credits each side puts in', required: false },
        {
          type: 3,
          name: 'mode',
          description: 'open = anyone can accept',
          required: false,
          choices: [{ name: 'open', value: 'open' }],
        },
      ],
      async run(ctx) {
        return startChallenge(ctx, 'rps');
      },
    });
  }

  async function onInteraction(interaction) {
    if (!interaction.isButton?.()) return;
    const id = interaction.customId || '';
    if (!id.startsWith('mg:')) return;

    const parts = id.split(':');
    const kind = parts[1];
    const action = parts[2];
    const matchId = parts[3];
    const extra = parts[4];

    const match = matches.get(matchId);
    if (!match) {
      await interaction.reply({ content: 'That challenge is over.', ephemeral: true }).catch(() => {});
      return;
    }

    if (action === 'accept' && (kind === 'cf' || kind === 'rps')) {
      await handleAccept(interaction, match, kind);
      return;
    }

    if (action === 'decline' && (kind === 'cf' || kind === 'rps')) {
      await handleDecline(interaction, match);
      return;
    }

    if (kind === 'rps' && action === 'pick') {
      await handleRpsPick(interaction, match, extra);
    }
  }

  return {
    register,
    onInteraction,
    matches,
  };
}

module.exports = { createMinigames, resolveRps, flipCoin };
