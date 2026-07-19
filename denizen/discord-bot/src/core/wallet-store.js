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
const CHAT_DRIP_DAILY_CAP = 100;

function emptyGuild() {
  return {
    balances: {},
    dailyClaims: {},
    duelCd: {},
    heldUntil: {},
    duelStats: {},
    history: [],
    // Phase 4 additions — see WalletStore methods below.
    redeems: {},
    weekKey: null,
    weeklyDuelWins: {},
    chatDrip: {},
  };
}

function normalizeRedeemCode(code) {
  return String(code || '').trim().toUpperCase();
}

/** UTC-day key, used to cap chat-drip earnings per calendar day. */
function utcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** ISO-8601 week key (e.g. `2026-W29`), computed in UTC. */
function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday determines the ISO year
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNum = 1 + Math.round((d - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function historyMatchesType(entry, type) {
  if (!type) return true;
  const t = String(type).toLowerCase();
  const isDuelish = entry.type === 'duel' || entry.type === 'escrow';
  if (t === 'duel' || t === 'duels') return isDuelish;
  if (t === 'credit' || t === 'credits') return !isDuelish;
  return entry.type === t;
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
        data.redeems = data.redeems || {};
        data.weekKey = typeof data.weekKey === 'string' ? data.weekKey : null;
        data.weeklyDuelWins = data.weeklyDuelWins || {};
        data.chatDrip = data.chatDrip || {};
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

  /**
   * Recent history, newest first. `opts.type`: 'credits' (everything non-duel)
   * or 'duels' (duel/escrow entries only); omit for everything.
   */
  getHistory(guildId, opts = {}) {
    const data = this.load(guildId);
    const limit = Math.max(1, Math.min(HISTORY_MAX, Math.floor(Number(opts.limit) || 15)));
    const all = Array.isArray(data.history) ? data.history : [];
    const filtered = opts.type ? all.filter((h) => historyMatchesType(h, opts.type)) : all;
    return filtered.slice(0, limit);
  }

  // ---------------------------------------------------------------------
  // Redeem codes (SlotBot-style `,createredeem` / `,redeem`)
  // ---------------------------------------------------------------------

  /**
   * @param {{ code?: string, amount: number, maxUses?: number, createdBy?: string }} opts
   * @returns {{ ok: boolean, error?: string, code?: string, entry?: object }}
   */
  createRedeem(guildId, opts = {}) {
    const data = this.load(guildId);
    data.redeems = data.redeems || {};
    const amount = Math.floor(Number(opts.amount) || 0);
    if (amount <= 0) return { ok: false, error: 'Amount must be a positive number.' };
    const maxUses = Math.max(1, Math.floor(Number(opts.maxUses) || 1));
    const code = normalizeRedeemCode(opts.code) || null;
    if (!code) return { ok: false, error: 'Missing code.' };
    if (data.redeems[code]) return { ok: false, error: `Code \`${code}\` already exists.` };
    const entry = {
      code,
      amount,
      maxUses,
      usesLeft: maxUses,
      createdBy: String(opts.createdBy || ''),
      createdAt: Date.now(),
      redeemedBy: {},
    };
    data.redeems[code] = entry;
    this._pushHistory(data, {
      type: 'redeem_create',
      code,
      amount,
      maxUses,
      by: String(opts.createdBy || ''),
    });
    this.save(guildId);
    return { ok: true, code, entry };
  }

  /** All redeem codes for a guild, newest first. */
  listRedeems(guildId) {
    const data = this.load(guildId);
    return Object.values(data.redeems || {}).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  getRedeem(guildId, code) {
    const data = this.load(guildId);
    return (data.redeems || {})[normalizeRedeemCode(code)] || null;
  }

  deleteRedeem(guildId, code) {
    const data = this.load(guildId);
    const key = normalizeRedeemCode(code);
    if (!data.redeems || !data.redeems[key]) return { ok: false, error: `Code \`${key}\` not found.` };
    delete data.redeems[key];
    this.save(guildId);
    return { ok: true, code: key };
  }

  /**
   * Redeem a code into a user's balance.
   * @returns {{ ok: boolean, error?: string, amount?: number, balance?: number }}
   */
  redeemCode(guildId, userId, code) {
    const data = this.load(guildId);
    const key = normalizeRedeemCode(code);
    const entry = (data.redeems || {})[key];
    if (!entry) return { ok: false, error: 'That code is invalid or has expired.' };
    const uid = String(userId);
    entry.redeemedBy = entry.redeemedBy || {};
    if (entry.redeemedBy[uid]) return { ok: false, error: 'You already redeemed this code.' };
    if (Number(entry.usesLeft) <= 0) return { ok: false, error: 'This code has no uses left.' };
    entry.usesLeft = Number(entry.usesLeft) - 1;
    entry.redeemedBy[uid] = Date.now();
    this.ensure(guildId, uid);
    data.balances[uid] = Math.max(0, (Number(data.balances[uid]) || 0) + entry.amount);
    this._pushHistory(data, {
      type: 'redeem',
      userId: uid,
      code: key,
      amount: entry.amount,
    });
    this.save(guildId);
    return { ok: true, amount: entry.amount, balance: data.balances[uid] };
  }

  // ---------------------------------------------------------------------
  // Weekly reset helper (foundation for future streak/bonus features)
  // ---------------------------------------------------------------------

  /** Current UTC ISO week key, e.g. `2026-W29`. */
  getWeekKey(date) {
    return isoWeekKey(date);
  }

  /** Rolls `weeklyDuelWins` (and stamps `weekKey`) whenever the ISO week changes. */
  ensureWeeklyReset(guildId) {
    const data = this.load(guildId);
    const wk = this.getWeekKey();
    if (data.weekKey !== wk) {
      data.weekKey = wk;
      data.weeklyDuelWins = {};
      this.save(guildId);
    }
    return data;
  }

  addWeeklyWin(guildId, userId) {
    this.ensureWeeklyReset(guildId);
    const data = this.load(guildId);
    const uid = String(userId);
    data.weeklyDuelWins = data.weeklyDuelWins || {};
    data.weeklyDuelWins[uid] = Number(data.weeklyDuelWins[uid] || 0) + 1;
    this.save(guildId);
    return data.weeklyDuelWins[uid];
  }

  getWeeklyWins(guildId, userId) {
    this.ensureWeeklyReset(guildId);
    const data = this.load(guildId);
    return Number((data.weeklyDuelWins || {})[String(userId)] || 0);
  }

  // ---------------------------------------------------------------------
  // Chat-drip anti-abuse cap
  // ---------------------------------------------------------------------

  _chatDripRecord(data, userId) {
    const uid = String(userId);
    const today = utcDayKey();
    data.chatDrip = data.chatDrip || {};
    const rec = data.chatDrip[uid];
    if (!rec || rec.date !== today) {
      data.chatDrip[uid] = { date: today, amount: 0 };
    }
    return data.chatDrip[uid];
  }

  /** Credits left today before the chat-drip cap kicks in. */
  chatDripRemaining(guildId, userId, cap = CHAT_DRIP_DAILY_CAP) {
    const data = this.load(guildId);
    const rec = this._chatDripRecord(data, userId);
    return Math.max(0, Number(cap) - Number(rec.amount || 0));
  }

  /**
   * Adds chat-drip credits, capped at `opts.cap` (default 100/day per user).
   * @returns {{ credited: number, capped: boolean, balance: number }}
   */
  addChatDrip(guildId, userId, amount, opts = {}) {
    const cap = Number(opts.cap ?? CHAT_DRIP_DAILY_CAP);
    const requested = Math.max(0, Math.floor(Number(amount) || 0));
    const data = this.ensure(guildId, userId);
    const uid = String(userId);
    if (!requested) {
      return { credited: 0, capped: false, balance: Number(data.balances[uid]) || 0 };
    }
    const rec = this._chatDripRecord(data, userId);
    const remaining = Math.max(0, cap - Number(rec.amount || 0));
    const credited = Math.min(requested, remaining);
    if (credited <= 0) {
      this.save(guildId);
      return { credited: 0, capped: true, balance: Number(data.balances[uid]) || 0 };
    }
    rec.amount = Number(rec.amount || 0) + credited;
    data.balances[uid] = Math.max(0, (Number(data.balances[uid]) || 0) + credited);
    this._pushHistory(data, { type: 'credit', userId: uid, amount: credited, reason: 'chat_drip' });
    this.save(guildId);
    return { credited, capped: credited < requested, balance: data.balances[uid] };
  }
}

module.exports = {
  WalletStore,
  START_BALANCE,
  CHAT_DRIP_DAILY_CAP,
  emptyGuild,
  isoWeekKey,
};
