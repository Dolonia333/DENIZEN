'use strict';

/**
 * File-backed avatar store keyed by Discord user id.
 * Path: denizen/data/discord-avatars/{userId}.json + baked .png
 */

const fs = require('fs');
const path = require('path');
const catalog = require('./catalog');

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'data', 'discord-avatars');

class AvatarStore {
  /**
   * @param {{ dir?: string }} [opts]
   */
  constructor(opts = {}) {
    this.dir = opts.dir || process.env.DISCORD_AVATAR_DIR || DEFAULT_DIR;
    this._mem = new Map();
    this._ensureDir();
  }

  _ensureDir() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch (_) { /* ignore */ }
  }

  _jsonPath(userId) {
    const id = String(userId || '').replace(/[^0-9a-zA-Z_-]/g, '');
    if (!id) throw new Error('invalid userId');
    return path.join(this.dir, `${id}.json`);
  }

  pngPath(userId) {
    const id = String(userId || '').replace(/[^0-9a-zA-Z_-]/g, '');
    if (!id) throw new Error('invalid userId');
    return path.join(this.dir, `${id}.png`);
  }

  previewPath(userId) {
    const id = String(userId || '').replace(/[^0-9a-zA-Z_-]/g, '');
    return path.join(this.dir, `${id}.preview.png`);
  }

  get(userId) {
    const id = String(userId || '').trim();
    if (!id) return null;
    if (this._mem.has(id)) return this._mem.get(id);
    try {
      const p = this._jsonPath(id);
      if (!fs.existsSync(p)) {
        const def = catalog.defaultAvatar(id);
        this._mem.set(id, def);
        return def;
      }
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      const av = catalog.normalizeAvatar(raw, id);
      this._mem.set(id, av);
      return av;
    } catch (_) {
      return catalog.defaultAvatar(id);
    }
  }

  /**
   * @param {string} userId
   * @param {object} avatar
   * @param {{ bumpRev?: boolean }} [opts]
   */
  set(userId, avatar, opts = {}) {
    const id = String(userId || '').trim();
    if (!id) throw new Error('userId required');
    const prev = this.get(id);
    const next = catalog.normalizeAvatar(avatar, id);
    if (opts.bumpRev !== false) {
      next.rev = (prev?.rev || 0) + 1;
    }
    next.updatedAt = new Date().toISOString();
    this._ensureDir();
    fs.writeFileSync(this._jsonPath(id), JSON.stringify(next, null, 2), 'utf8');
    this._mem.set(id, next);
    return next;
  }

  hasCustom(userId) {
    try {
      return fs.existsSync(this._jsonPath(userId));
    } catch (_) {
      return false;
    }
  }

  hasPng(userId) {
    try {
      return fs.existsSync(this.pngPath(userId));
    } catch (_) {
      return false;
    }
  }

  readPng(userId) {
    const p = this.pngPath(userId);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p);
  }

  writePng(userId, buffer) {
    this._ensureDir();
    // Atomic write (tmp + rename): plain writeFileSync truncates first, so a
    // concurrent read (another map viewer) could be served a torn PNG.
    const dest = this.pngPath(userId);
    const tmp = `${dest}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, dest);
  }

  writePreview(userId, buffer) {
    this._ensureDir();
    const dest = this.previewPath(userId);
    const tmp = `${dest}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, dest);
  }

  readPreview(userId) {
    const p = this.previewPath(userId);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p);
  }

  /** All known user ids with saved JSON. */
  listUserIds() {
    this._ensureDir();
    try {
      return fs.readdirSync(this.dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''));
    } catch (_) {
      return [];
    }
  }

  /** Map for presence enrichment. */
  snapshotMap() {
    const out = {};
    for (const id of this.listUserIds()) {
      out[id] = catalog.clientAvatar(this.get(id), id);
    }
    // also include mem-only defaults that were touched
    for (const [id, av] of this._mem) {
      if (!out[id]) out[id] = catalog.clientAvatar(av, id);
    }
    return out;
  }
}

let _singleton = null;
function getAvatarStore(opts) {
  if (opts?.dir) return new AvatarStore(opts);
  if (!_singleton) _singleton = new AvatarStore();
  return _singleton;
}

module.exports = {
  AvatarStore,
  getAvatarStore,
  DEFAULT_DIR,
};
