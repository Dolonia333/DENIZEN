'use strict';
const path = require('path');
const fs   = require('fs');

const PERM_FILE = path.join(__dirname, '..', '..', 'data', 'permissions.json');

class PermissionRegistry {
  constructor() {
    this._cache = null;
  }

  _load() {
    if (this._cache) return this._cache;
    try {
      if (!fs.existsSync(PERM_FILE)) return (this._cache = {});
      this._cache = JSON.parse(fs.readFileSync(PERM_FILE, 'utf-8'));
    } catch (_) {
      this._cache = {};
    }
    return this._cache;
  }

  _save(data) {
    this._cache = data;
    try {
      fs.mkdirSync(path.dirname(PERM_FILE), { recursive: true });
      // Atomic write: write to a temp file then rename over the target.
      const tmp = PERM_FILE + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmp, PERM_FILE);
    } catch (_) {
      // Fall back to a direct write if the atomic rename path fails.
      try {
        fs.writeFileSync(PERM_FILE, JSON.stringify(data, null, 2), 'utf-8');
      } catch (__) {}
    }
  }

  // ---- internal helpers for scope-based grants ----------------------------

  /** Returns the per-npc container for path scopes, creating it if needed. */
  _pathScopes(data, npcName, create) {
    if (!data.__pathScopes) {
      if (!create) return [];
      data.__pathScopes = {};
    }
    if (!data.__pathScopes[npcName]) {
      if (!create) return [];
      data.__pathScopes[npcName] = [];
    }
    return data.__pathScopes[npcName];
  }

  /** Returns the per-npc container for screen grants. */
  _screenScopes(data, create) {
    if (!data.__screenScopes) {
      if (!create) return null;
      data.__screenScopes = {};
    }
    return data.__screenScopes;
  }

  /** True when a grant carries an expiresAt that is already in the past. */
  _isExpired(grant) {
    return !!(grant && grant.expiresAt && grant.expiresAt <= Date.now());
  }

  /** Normalize a folder path to an absolute, resolved form. */
  _normPath(p) {
    return path.resolve(String(p || ''));
  }

  /**
   * Path containment: returns true when targetPath is inside (or equal to)
   * folderPath. Uses resolve + separator-guarded startsWith so that
   * "C:\\foo" does not match "C:\\foobar".
   */
  _isInside(folderPath, targetPath) {
    const folder = this._normPath(folderPath);
    const target = this._normPath(targetPath);
    if (target === folder) return true;
    const folderWithSep = folder.endsWith(path.sep) ? folder : folder + path.sep;
    // Case-insensitive comparison on Windows where paths are not case-sensitive.
    if (process.platform === 'win32') {
      return target.toLowerCase().startsWith(folderWithSep.toLowerCase());
    }
    return target.startsWith(folderWithSep);
  }

  /**
   * Grant a named permission to an NPC.
   * Idempotent — same permission for the same NPC is silently deduped.
   * Returns true if this is a new grant.
   */
  grantPermission(npcName, permission, grantedBy, scope) {
    const data = this._load();
    if (!data[npcName]) data[npcName] = [];
    const norm = String(permission).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
    if (data[npcName].some(p => p.norm === norm)) return false;
    data[npcName].push({
      permission,
      norm,
      scope: scope || permission,
      grantedBy: grantedBy || 'CEO',
      grantedAt: Date.now(),
    });
    this._save(data);
    return true;
  }

  /**
   * Check whether an NPC has a permission covering a given task description.
   * Returns the matching grant object or null.
   */
  checkPermission(npcName, task) {
    const data = this._load();
    const perms = data[npcName] || [];
    const normTask = String(task).toLowerCase().replace(/\s+/g, ' ');
    return perms.find(p =>
      normTask.includes(p.norm) || p.norm.includes(normTask.slice(0, 50))
    ) || null;
  }

  getPermissions(npcName) {
    return (this._load()[npcName] || []);
  }

  revokePermission(npcName, permission) {
    const data = this._load();
    if (!data[npcName]) return;
    const norm = String(permission).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
    data[npcName] = data[npcName].filter(p => p.norm !== norm);
    this._save(data);
  }

  // ---- FILE-PATH access scopes -------------------------------------------

  /**
   * Grant filesystem access to an NPC for a folder (and everything under it).
   * @param {string} npcName
   * @param {string} folderPath  absolute path; normalized on store
   * @param {'read'|'readwrite'} mode  defaults to 'read'
   * @param {object} [opts]  { grantedBy, expiresAt }
   * Idempotent on (folderPath): re-granting updates the mode/metadata.
   * Returns the stored grant object.
   */
  grantPathAccess(npcName, folderPath, mode, opts) {
    const data = this._load();
    const scopes = this._pathScopes(data, npcName, true);
    const norm = this._normPath(folderPath);
    const m = mode === 'readwrite' ? 'readwrite' : 'read';
    const o = opts || {};
    let grant = scopes.find(s => this._normPath(s.folderPath) === norm);
    if (grant) {
      grant.mode = m;
      grant.grantedBy = o.grantedBy || grant.grantedBy || 'user';
      grant.grantedAt = Date.now();
      grant.expiresAt = o.expiresAt || null;
    } else {
      grant = {
        folderPath: norm,
        mode: m,
        grantedBy: o.grantedBy || 'user',
        grantedAt: Date.now(),
        expiresAt: o.expiresAt || null,
      };
      scopes.push(grant);
    }
    this._save(data);
    return grant;
  }

  /**
   * Check whether an NPC may access targetPath at the required mode.
   * A 'readwrite' grant satisfies a 'read' check; a 'read' grant does NOT
   * satisfy a 'write'/'readwrite' check. Expired grants are ignored.
   * @param {'read'|'readwrite'|'write'} mode  defaults to 'read'
   */
  checkPathAccess(npcName, targetPath, mode) {
    const data = this._load();
    const scopes = this._pathScopes(data, npcName, false);
    if (!scopes.length) return false;
    const needWrite = mode === 'readwrite' || mode === 'write';
    return scopes.some(s => {
      if (this._isExpired(s)) return false;
      if (!this._isInside(s.folderPath, targetPath)) return false;
      if (needWrite) return s.mode === 'readwrite';
      return true; // any non-expired grant satisfies a read check
    });
  }

  revokePathAccess(npcName, folderPath) {
    const data = this._load();
    if (!data.__pathScopes || !data.__pathScopes[npcName]) return;
    const norm = this._normPath(folderPath);
    data.__pathScopes[npcName] =
      data.__pathScopes[npcName].filter(s => this._normPath(s.folderPath) !== norm);
    this._save(data);
  }

  /** List active (non-expired) path scopes for an NPC. */
  listPathScopes(npcName) {
    const data = this._load();
    const scopes = this._pathScopes(data, npcName, false);
    return scopes
      .filter(s => !this._isExpired(s))
      .map(s => ({
        folderPath: s.folderPath,
        mode: s.mode,
        grantedAt: s.grantedAt,
        ...(s.expiresAt ? { expiresAt: s.expiresAt } : {}),
      }));
  }

  // ---- SCREEN access scopes ----------------------------------------------

  /**
   * Consent for an NPC to observe the user's screen.
   * @param {object} [opts]  { watch:boolean, grantedBy, expiresAt }
   *   watch=true means continuous watching is allowed (not just one-off).
   * Returns the stored screen grant.
   */
  grantScreenAccess(npcName, opts) {
    const data = this._load();
    const screen = this._screenScopes(data, true);
    const o = opts || {};
    const grant = {
      granted: true,
      watch: !!o.watch,
      grantedBy: o.grantedBy || 'user',
      grantedAt: Date.now(),
      expiresAt: o.expiresAt || null,
    };
    screen[npcName] = grant;
    this._save(data);
    return grant;
  }

  /**
   * @returns {{granted:boolean, watch:boolean}}
   * Expired or absent grants report { granted:false, watch:false }.
   */
  checkScreenAccess(npcName) {
    const data = this._load();
    const screen = this._screenScopes(data, false);
    const grant = screen && screen[npcName];
    if (!grant || !grant.granted || this._isExpired(grant)) {
      return { granted: false, watch: false };
    }
    return { granted: true, watch: !!grant.watch };
  }

  revokeScreenAccess(npcName) {
    const data = this._load();
    if (data.__screenScopes && data.__screenScopes[npcName]) {
      delete data.__screenScopes[npcName];
      this._save(data);
    }
  }

  /**
   * Returns a prompt block listing this NPC's granted permissions.
   * Empty string when the NPC has no permissions yet.
   */
  buildPermissionBlock(npcName) {
    const perms = this.getPermissions(npcName);
    const scopeBlock = this.buildScopeBlock(npcName);
    if (!perms.length) return scopeBlock;
    const lines = perms.map(p =>
      `- [PERMISSION:granted] ${p.scope} (approved by ${p.grantedBy})`
    ).join('\n');
    return (
      `## Granted Permissions\n` +
      `You have been explicitly approved for the following. ` +
      `Do NOT ask again — just proceed.\n${lines}\n\n` +
      scopeBlock
    );
  }

  /**
   * Prompt-injectable text describing this NPC's granted file-path and
   * screen access scopes. Empty string when none are active.
   */
  buildScopeBlock(npcName) {
    const paths = this.listPathScopes(npcName);
    const screen = this.checkScreenAccess(npcName);
    if (!paths.length && !screen.granted) return '';
    let out = `## Granted Access Scopes\n`;
    if (paths.length) {
      out += `You may access the following folders (and everything inside them):\n`;
      out += paths.map(p =>
        `- [SCOPE:path] ${p.folderPath} (${p.mode})`
      ).join('\n') + '\n';
    }
    if (screen.granted) {
      out += `- [SCOPE:screen] You may observe the user's screen` +
        (screen.watch ? ' continuously (watch allowed).' : ' (one-off, no continuous watching).') + '\n';
    }
    out += '\n';
    return out;
  }

  /**
   * Persist a permission directly into the NPC's MEMORY.md so it survives
   * across sessions without needing the JSON file to be re-read.
   */
  saveToMemory(npcName, permission, grantedBy, npcMemoryPath) {
    try {
      const tag = `[PERMISSION:granted] ${permission} (by ${grantedBy})`;
      const existing = fs.existsSync(npcMemoryPath)
        ? fs.readFileSync(npcMemoryPath, 'utf-8')
        : '';
      if (existing.includes(tag)) return;
      fs.appendFileSync(npcMemoryPath, `\n${tag}\n`, 'utf-8');
    } catch (_) {}
  }
}

module.exports = new PermissionRegistry();
