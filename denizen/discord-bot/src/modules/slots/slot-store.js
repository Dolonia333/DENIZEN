'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, '..', '..', '..', 'data', 'slots');
const HISTORY_MAX = 500;

function emptyGuild() {
  return {
    slots: {},
    blacklist: {},
    history: [],
    redeems: {},
    tickets: {},
  };
}

function computeEndTime(amount, unit) {
  const now = Math.floor(Date.now() / 1000);
  const n = Number(amount);
  if (unit === 'd') return now + n * 86400;
  if (unit === 'm') return now + n * 30 * 86400;
  throw new Error(`invalid unit: ${unit}`);
}

function mergeGuild(parsed) {
  const base = emptyGuild();
  if (!parsed || typeof parsed !== 'object') return base;
  return {
    slots: parsed.slots && typeof parsed.slots === 'object' ? parsed.slots : base.slots,
    blacklist: parsed.blacklist && typeof parsed.blacklist === 'object' ? parsed.blacklist : base.blacklist,
    history: Array.isArray(parsed.history) ? parsed.history.slice(0, HISTORY_MAX) : base.history,
    redeems: parsed.redeems && typeof parsed.redeems === 'object' ? parsed.redeems : base.redeems,
    tickets: parsed.tickets && typeof parsed.tickets === 'object' ? parsed.tickets : base.tickets,
  };
}

function genCode() {
  return crypto.randomBytes(5).toString('hex');
}

class SlotStore {
  constructor(opts = {}) {
    this.dir = opts.dir || process.env.DISCORD_SLOTS_DIR || DEFAULT_DIR;
    fs.mkdirSync(this.dir, { recursive: true });
    /** @type {Map<string, object>} */
    this.cache = new Map();
  }

  _file(guildId) {
    return path.join(this.dir, `${guildId}.json`);
  }

  load(guildId) {
    const id = String(guildId);
    if (this.cache.has(id)) return this.cache.get(id);
    let data = emptyGuild();
    const file = this._file(id);
    if (fs.existsSync(file)) {
      try {
        data = mergeGuild(JSON.parse(fs.readFileSync(file, 'utf8')));
      } catch (err) {
        console.warn('[slot-store] corrupt', id, err.message);
      }
    }
    this.cache.set(id, data);
    return data;
  }

  save(guildId) {
    const id = String(guildId);
    const data = this.cache.get(id) ?? this.load(id);
    const file = this._file(id);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return data;
  }

  ensure(guildId) {
    const id = String(guildId);
    const data = this.load(id);
    if (!fs.existsSync(this._file(id))) this.save(id);
    return data;
  }

  getSlot(guildId, channelId) {
    return this.load(guildId).slots[String(channelId)] ?? null;
  }

  getSlotByUser(guildId, userId) {
    const uid = String(userId);
    for (const slot of Object.values(this.load(guildId).slots)) {
      if (String(slot.userId) === uid) return slot;
    }
    return null;
  }

  listSlots(guildId) {
    return Object.values(this.load(guildId).slots);
  }

  upsertSlot(guildId, entry) {
    const data = this.load(guildId);
    const channelId = String(entry.channelId);
    data.slots[channelId] = { ...entry, channelId };
    this.save(guildId);
    return data.slots[channelId];
  }

  removeSlot(guildId, channelId) {
    const data = this.load(guildId);
    const id = String(channelId);
    const prev = data.slots[id] ?? null;
    delete data.slots[id];
    this.save(guildId);
    return prev;
  }

  setHeld(guildId, channelId, held) {
    const slot = this.getSlot(guildId, channelId);
    if (!slot) return null;
    slot.held = !!held;
    this.save(guildId);
    return slot;
  }

  warnUser(guildId, userId) {
    const slot = this.getSlotByUser(guildId, userId);
    if (!slot) return 0;
    slot.warnings = (Number(slot.warnings) || 0) + 1;
    this.save(guildId);
    return slot.warnings;
  }

  isBlacklisted(guildId, userId) {
    return !!this.load(guildId).blacklist[String(userId)];
  }

  setBlacklist(guildId, userId, { reason, by, at } = {}) {
    const data = this.load(guildId);
    const id = String(userId);
    data.blacklist[id] = {
      reason: reason ?? '',
      by: by ?? null,
      at: at ?? Math.floor(Date.now() / 1000),
    };
    this.save(guildId);
    return data.blacklist[id];
  }

  clearBlacklist(guildId, userId) {
    const data = this.load(guildId);
    const id = String(userId);
    const prev = data.blacklist[id] ?? null;
    delete data.blacklist[id];
    this.save(guildId);
    return prev;
  }

  addHistory(guildId, action, fields = {}) {
    const data = this.load(guildId);
    data.history.unshift({
      action,
      at: Math.floor(Date.now() / 1000),
      ...fields,
    });
    if (data.history.length > HISTORY_MAX) data.history.length = HISTORY_MAX;
    this.save(guildId);
    return data.history[0];
  }

  getHistory(guildId, limit = 50) {
    const n = Math.max(0, Number(limit) || 0);
    return this.load(guildId).history.slice(0, n || undefined);
  }

  createRedeem(guildId, opts = {}) {
    const data = this.load(guildId);
    const code = String(opts.code || genCode());
    if (data.redeems[code]) throw new Error('code_exists');
    const now = Math.floor(Date.now() / 1000);
    data.redeems[code] = {
      code,
      duration: Number(opts.duration) || 0,
      unit: opts.unit === 'm' ? 'm' : 'd',
      pings: Number(opts.pings) || 0,
      categoryIndex: opts.categoryIndex === 2 ? 2 : 1,
      maxUses: Math.max(1, Number(opts.maxUses) || 1),
      uses: 0,
      createdBy: opts.createdBy ?? null,
      createdAt: now,
      redeemedBy: {},
    };
    this.save(guildId);
    return data.redeems[code];
  }

  listRedeems(guildId) {
    return Object.values(this.load(guildId).redeems);
  }

  deleteRedeem(guildId, code) {
    const data = this.load(guildId);
    const key = String(code);
    const prev = data.redeems[key] ?? null;
    delete data.redeems[key];
    this.save(guildId);
    return prev;
  }

  redeemCode(guildId, userId, code) {
    const data = this.load(guildId);
    const key = String(code);
    const redeem = data.redeems[key];
    if (!redeem) return { error: 'not_found' };
    const uid = String(userId);
    if (redeem.redeemedBy?.[uid]) return { error: 'already_redeemed' };
    if (redeem.uses >= redeem.maxUses) return { error: 'exhausted' };
    redeem.uses += 1;
    if (!redeem.redeemedBy) redeem.redeemedBy = {};
    redeem.redeemedBy[uid] = Math.floor(Date.now() / 1000);
    this.save(guildId);
    return redeem;
  }

  openTicket(guildId, userId, channelId) {
    const data = this.load(guildId);
    const cid = String(channelId);
    data.tickets[cid] = {
      userId: String(userId),
      channelId: cid,
      createdAt: Math.floor(Date.now() / 1000),
    };
    this.save(guildId);
    return data.tickets[cid];
  }

  getTicketByUser(guildId, userId) {
    const uid = String(userId);
    for (const ticket of Object.values(this.load(guildId).tickets)) {
      if (String(ticket.userId) === uid) return ticket;
    }
    return null;
  }

  closeTicket(guildId, channelId) {
    const data = this.load(guildId);
    const id = String(channelId);
    const prev = data.tickets[id] ?? null;
    delete data.tickets[id];
    this.save(guildId);
    return prev;
  }

  leaderboard(guildId) {
    const now = Math.floor(Date.now() / 1000);
    return this.listSlots(guildId)
      .map((slot) => ({ ...slot, remaining: Math.max(0, Number(slot.endtime) - now) }))
      .sort((a, b) => b.remaining - a.remaining);
  }
}

module.exports = { SlotStore, emptyGuild, computeEndTime };
