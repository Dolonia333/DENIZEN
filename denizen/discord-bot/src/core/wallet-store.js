'use strict';

/**
 * Per-guild Credits wallet (SlotBot-style JSON stores).
 * data/credits/{guildId}.json
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'data', 'credits');
const START_BALANCE = 100;
const HISTORY_MAX = 80;

function emptyGuild() {
  return {
    balances: {},
    dailyClaims: {},
    duelCd: {},
    heldUntil: {},
    duelStats: {},
    history: [],
  };
}

class WalletStore {
  constructor(opts = {}) {
    this.dir = opts.dir || process.env.DISCORD_CREDITS_DIR || DEFAULT_DIR;
    this.startBalance = opts.startBalance ?? START_BALANCE;
    fs.mkdirSync(this.dir, { recursive: true });
    /** @type {Map<string, object>} */
    this.cache = new Map();
  }

  _file(guildId) {
    return path.join(this.dir, `${String(guildId)}.json`);
  }

  load(guildId) {
    const id = String(guildId);
    if (this.cache.has(id)) return this.cache.get(id);
    let data = emptyGuild();
    const file = this._file(id);
    if (fs.existsSync(file)) {
      try {
        data = { ...emptyGuild(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
        data.balances = data.balances || {};
        data.dailyClaims = data.dailyClaims || {};
        data.duelCd = data.duelCd || {};
        data.heldUntil = data.heldUntil || {};
        data.duelStats = data.duelStats || {};
        data.history = Array.isArray(data.history) ? data.history : [];
      } catch (err) {
        console.warn('[wallet-store] corrupt', id, err.message);
        data = emptyGuild();
      }
    }
    this.cache.set(id, data);
    return data;
  }

  save(guildId) {
    const id = String(guildId);
    const data = this.load(id);
    const file = this._file(id);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return data;
  }

  ensure(guildId, userId) {
    const data = this.load(guildId);
    const uid = String(userId);
    if (data.balances[uid] == null) {
      data.balances[uid] = this.startBalance;
      this.save(guildId);
    }
    return data;
  }

  getBalance(guildId, userId) {
    this.ensure(guildId, userId);
    return Number(this.load(guildId).balances[String(userId)] || 0);
  }

  setBalance(guildId, userId, amount) {
    const data = this.ensure(guildId, userId);
    data.balances[String(userId)] = Math.max(0, Math.floor(Number(amount) || 0));
    this.save(guildId);
    return data.balances[String(userId)];
  }

  add(guildId, userId, amount, meta = {}) {
    const delta = Math.floor(Number(amount) || 0);
    if (!delta) return this.getBalance(guildId, userId);
    const data = this.ensure(guildId, userId);
    const uid = String(userId);
    data.balances[uid] = Math.max(0, (Number(data.balances[uid]) || 0) + delta);
    this._pushHistory(data, {
      type: delta > 0 ? 'credit' : 'debit',
      userId: uid,
      amount: delta,
      ...meta,
    });
    this.save(guildId);
    return data.balances[uid];
  }

  /** Atomic transfer. Returns { ok, error?, fromBal?, toBal? }. */
  transfer(guildId, fromId, toId, amount, meta = {}) {
    const n = Math.floor(Number(amount) || 0);
    if (n <= 0) return { ok: false, error: 'Amount must be positive.' };
    if (String(fromId) === String(toId)) return { ok: false, error: 'Cannot pay yourself.' };
    const data = this.ensure(guildId, fromId);
    this.ensure(guildId, toId);
    const from = String(fromId);
    const to = String(toId);
    if ((data.balances[from] || 0) < n) return { ok: false, error: 'Insufficient credits.' };
    data.balances[from] -= n;
    data.balances[to] = (data.balances[to] || 0) + n;
    this._pushHistory(data, {
      type: 'transfer',
      from,
      to,
      amount: n,
      ...meta,
    });
    this.save(guildId);
    return { ok: true, fromBal: data.balances[from], toBal: data.balances[to] };
  }

  /**
   * Deduct from two users into escrow (duel wager).
   * @returns {{ ok: boolean, error?: string }}
   */
  escrowPair(guildId, aId, bId, amount, meta = {}) {
    const n = Math.floor(Number(amount) || 0);
    if (n < 0) return { ok: false, error: 'Invalid wager.' };
    if (n === 0) return { ok: true };
    const data = this.ensure(guildId, aId);
    this.ensure(guildId, bId);
    const a = String(aId);
    const b = String(bId);
    if ((data.balances[a] || 0) < n) return { ok: false, error: 'Challenger cannot cover the wager.' };
    if ((data.balances[b] || 0) < n) return { ok: false, error: 'Opponent cannot cover the wager.' };
    data.balances[a] -= n;
    data.balances[b] -= n;
    this._pushHistory(data, {
      type: 'escrow',
      a,
      b,
      amount: n,
      ...meta,
    });
    this.save(guildId);
    return { ok: true };
  }

  /** Refund escrow to both fighters. */
  refundEscrow(guildId, aId, bId, amount, meta = {}) {
    const n = Math.floor(Number(amount) || 0);
    if (n <= 0) return;
    this.add(guildId, aId, n, { reason: 'duel_refund', ...meta });
    this.add(guildId, bId, n, { reason: 'duel_refund', ...meta });
  }

  /** Pay pot (2x wager) to winner. */
  payPot(guildId, winnerId, pot, meta = {}) {
    const n = Math.floor(Number(pot) || 0);
    if (n <= 0) return this.getBalance(guildId, winnerId);
    return this.add(guildId, winnerId, n, { reason: 'duel_win', ...meta });
  }

  canClaimDaily(guildId, userId) {
    const data = this.load(guildId);
    const last = Number(data.dailyClaims[String(userId)] || 0);
    return Date.now() - last >= 24 * 60 * 60 * 1000;
  }

  markClaimed(guildId, userId) {
    const data = this.ensure(guildId, userId);
    data.dailyClaims[String(userId)] = Date.now();
    this.save(guildId);
  }

  nextClaimAt(guildId, userId) {
    const data = this.load(guildId);
    const last = Number(data.dailyClaims[String(userId)] || 0);
    return last + 24 * 60 * 60 * 1000;
  }

  isHeld(guildId, userId) {
    const until = Number(this.load(guildId).heldUntil[String(userId)] || 0);
    return until > Date.now();
  }

  holdUntil(guildId, userId) {
    return Number(this.load(guildId).heldUntil[String(userId)] || 0);
  }

  setHold(guildId, userId, untilMs) {
    const data = this.ensure(guildId, userId);
    data.heldUntil[String(userId)] = Math.max(0, Number(untilMs) || 0);
    this.save(guildId);
  }

  clearHold(guildId, userId) {
    const data = this.load(guildId);
    delete data.heldUntil[String(userId)];
    this.save(guildId);
  }

  duelCooldownRemaining(guildId, userId) {
    const until = Number(this.load(guildId).duelCd[String(userId)] || 0);
    return Math.max(0, until - Date.now());
  }

  setDuelCooldown(guildId, userId, durationMs) {
    const data = this.ensure(guildId, userId);
    data.duelCd[String(userId)] = Date.now() + Math.max(0, Number(durationMs) || 0);
    this.save(guildId);
  }

  getDuelStats(guildId, userId) {
    const s = this.load(guildId).duelStats[String(userId)];
    return {
      wins: Number(s?.wins || 0),
      losses: Number(s?.losses || 0),
      forfeits: Number(s?.forfeits || 0),
    };
  }

  recordDuelResult(guildId, winnerId, loserId, opts = {}) {
    const data = this.load(guildId);
    const w = String(winnerId);
    const l = String(loserId);
    data.duelStats[w] = data.duelStats[w] || { wins: 0, losses: 0, forfeits: 0 };
    data.duelStats[l] = data.duelStats[l] || { wins: 0, losses: 0, forfeits: 0 };
    data.duelStats[w].wins += 1;
    if (opts.forfeit) data.duelStats[l].forfeits += 1;
    else data.duelStats[l].losses += 1;
    this._pushHistory(data, {
      type: 'duel',
      winnerId: w,
      loserId: l,
      wager: opts.wager || 0,
      forfeit: !!opts.forfeit,
    });
    this.save(guildId);
  }

  topBalances(guildId, limit = 10) {
    const data = this.load(guildId);
    return Object.entries(data.balances)
      .map(([userId, bal]) => ({ userId, bal: Number(bal) || 0 }))
      .sort((a, b) => b.bal - a.bal)
      .slice(0, limit);
  }

  topDuelists(guildId, limit = 10) {
    const data = this.load(guildId);
    return Object.entries(data.duelStats)
      .map(([userId, s]) => ({
        userId,
        wins: Number(s.wins || 0),
        losses: Number(s.losses || 0),
        forfeits: Number(s.forfeits || 0),
      }))
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
      .slice(0, limit);
  }

  _pushHistory(data, entry) {
    data.history = data.history || [];
    data.history.unshift({ ts: Date.now(), ...entry });
    if (data.history.length > HISTORY_MAX) data.history.length = HISTORY_MAX;
  }
}

module.exports = {
  WalletStore,
  START_BALANCE,
  emptyGuild,
};
