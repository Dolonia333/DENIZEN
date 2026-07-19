'use strict';

/**
 * Persist weekly VC hangout minutes across bot restarts.
 * Shape: { week: "YYYY-Www", users: { [userId]: { hangoutMs, displayName } } }
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, '..', 'data', 'hangout');

function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

class HangoutStore {
  constructor(opts = {}) {
    this.dir = opts.dir || process.env.DISCORD_HANGOUT_DIR || DEFAULT_DIR;
    fs.mkdirSync(this.dir, { recursive: true });
    /** @type {Map<string, object>} */
    this.cache = new Map();
    this._dirty = new Set();
  }

  _file(guildId) {
    return path.join(this.dir, `${guildId}.json`);
  }

  load(guildId) {
    const id = String(guildId);
    if (this.cache.has(id)) return this.cache.get(id);
    const week = isoWeekKey();
    let data = { week, users: {} };
    const file = this._file(id);
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          if (parsed.week === week && parsed.users && typeof parsed.users === 'object') {
            data = { week, users: parsed.users };
          } else {
            // New ISO week → start fresh
            data = { week, users: {} };
          }
        }
      } catch (err) {
        console.warn('[hangout-store] corrupt', id, err.message);
      }
    }
    this.cache.set(id, data);
    return data;
  }

  hydrateMember(guildId, userId, member) {
    const data = this.load(guildId);
    const row = data.users?.[userId];
    if (!row) return member;
    if (data.week !== (member.hangoutWeek || isoWeekKey())) return member;
    member.hangoutWeek = data.week;
    member.hangoutMs = Math.max(member.hangoutMs || 0, Number(row.hangoutMs) || 0);
    if (row.displayName && !member.displayName) member.displayName = row.displayName;
    return member;
  }

  record(guildId, userId, { hangoutMs, displayName, hangoutWeek } = {}) {
    const data = this.load(guildId);
    const week = hangoutWeek || isoWeekKey();
    if (data.week !== week) {
      data.week = week;
      data.users = {};
    }
    data.users[userId] = {
      hangoutMs: Math.max(0, Number(hangoutMs) || 0),
      displayName: displayName || data.users[userId]?.displayName || userId,
    };
    this.cache.set(String(guildId), data);
    this._dirty.add(String(guildId));
  }

  flush(guildId) {
    const id = String(guildId);
    const data = this.cache.get(id);
    if (!data) return;
    const file = this._file(id);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, file);
    this._dirty.delete(id);
  }

  flushAll() {
    for (const id of [...this._dirty]) this.flush(id);
    // Also flush cached guilds that may have been recorded without dirty mark edge cases
    for (const id of this.cache.keys()) {
      if (this._dirty.has(id)) this.flush(id);
    }
  }

  flushDirty() {
    for (const id of [...this._dirty]) this.flush(id);
  }
}

module.exports = { HangoutStore, DEFAULT_DIR };
