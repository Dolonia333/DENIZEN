/**
 * FileAgent — scoped, safe file-management capability for "Lucy"
 *
 * SECURITY MODEL
 * ──────────────
 * Lucy may only touch files inside an explicit allowlist of absolute root
 * folders (`allowedRoots`) passed to the constructor. EVERY operation resolves
 * the target with path.resolve() and verifies that the resolved absolute path
 * lies inside one of the allowed roots before any I/O happens.
 *
 * The containment check compares the resolved path against each root WITH a
 * trailing path separator appended (root + path.sep). This prevents the classic
 * sibling-prefix bypass — e.g. allowing "C:\data" must NOT permit "C:\data-evil".
 * The root itself is also allowed (a path equal to the root). Symlinks, "..",
 * absolute re-rooting, and drive-letter tricks all collapse during path.resolve,
 * so traversal attempts land outside the allowlist and are rejected with
 * `{ ok:false, error:'path not permitted' }`.
 *
 * On Windows path comparison is case-insensitive (the filesystem is), so roots
 * and targets are lower-cased for the containment test only — the real,
 * original-case resolved path is what gets used for I/O.
 *
 * No operation ever permanently destroys data: remove() relocates the target
 * into a `.lucy-trash` folder inside the same root instead of unlinking it.
 *
 * Every method returns a plain result object of the shape `{ ok, ... }` and
 * never throws — all failures are caught and reported as `{ ok:false, error }`.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const TRASH_DIR = '.lucy-trash';

// Extension → bucket folder used by organize({ by:'ext' }).
const EXT_BUCKETS = {
  // images
  '.png': 'images', '.jpg': 'images', '.jpeg': 'images', '.gif': 'images',
  '.bmp': 'images', '.webp': 'images', '.svg': 'images', '.tiff': 'images',
  '.ico': 'images',
  // documents
  '.doc': 'docs', '.docx': 'docs', '.txt': 'docs', '.md': 'docs',
  '.rtf': 'docs', '.odt': 'docs',
  // pdfs
  '.pdf': 'pdfs',
  // spreadsheets
  '.xls': 'spreadsheets', '.xlsx': 'spreadsheets', '.csv': 'spreadsheets',
  // data / config
  '.json': 'data', '.xml': 'data', '.yml': 'data', '.yaml': 'data',
  // archives
  '.zip': 'archives', '.rar': 'archives', '.7z': 'archives',
  '.tar': 'archives', '.gz': 'archives',
  // audio
  '.mp3': 'audio', '.wav': 'audio', '.flac': 'audio', '.ogg': 'audio',
  // video
  '.mp4': 'video', '.mov': 'video', '.avi': 'video', '.mkv': 'video',
  // code
  '.js': 'code', '.ts': 'code', '.py': 'code', '.html': 'code',
  '.css': 'code', '.c': 'code', '.cpp': 'code', '.java': 'code',
};

class FileAgent {
  /**
   * @param {string[]} allowedRoots - absolute root folders Lucy may touch.
   */
  constructor(allowedRoots = []) {
    // Normalize each root to an absolute, resolved path. Keep both the real
    // (original-case) form for I/O and a lower-cased form for comparison.
    this.allowedRoots = (Array.isArray(allowedRoots) ? allowedRoots : [allowedRoots])
      .filter(Boolean)
      .map((r) => {
        const real = path.resolve(String(r));
        return { real, cmp: real.toLowerCase() };
      });
  }

  // ── Security core ────────────────────────────────────────────────────────

  /**
   * Resolve `target` and verify it is inside one of allowedRoots.
   * Returns { ok:true, resolved, root } or { ok:false, error:'path not permitted' }.
   * @private
   */
  _resolveSafe(target) {
    try {
      if (target === undefined || target === null || target === '') {
        return { ok: false, error: 'path not permitted' };
      }
      const resolved = path.resolve(String(target));
      const cmp = resolved.toLowerCase();

      for (const root of this.allowedRoots) {
        // Allow the root itself, or anything strictly inside it (root + sep).
        if (cmp === root.cmp || cmp.startsWith(root.cmp + path.sep)) {
          return { ok: true, resolved, root: root.real };
        }
      }
      return { ok: false, error: 'path not permitted' };
    } catch (_) {
      return { ok: false, error: 'path not permitted' };
    }
  }

  /** Classify a fs.Stats object as 'dir' or 'file'. @private */
  _type(stat) {
    return stat.isDirectory() ? 'dir' : 'file';
  }

  // ── Listing / reading ────────────────────────────────────────────────────

  /**
   * List directory entries with metadata.
   * @returns {{ok, dir?, entries?, error?}}
   */
  list(dir) {
    const safe = this._resolveSafe(dir);
    if (!safe.ok) return safe;
    try {
      const names = fs.readdirSync(safe.resolved);
      const entries = [];
      for (const name of names) {
        try {
          const full = path.join(safe.resolved, name);
          const st = fs.statSync(full);
          const type = this._type(st);
          entries.push({
            name,
            type,
            size: st.size,
            modified: st.mtime.toISOString(),
            ext: type === 'file' ? path.extname(name).toLowerCase() : '',
          });
        } catch (_) { /* skip entries we cannot stat */ }
      }
      return { ok: true, dir: safe.resolved, entries };
    } catch (e) {
      return { ok: false, error: e.code === 'ENOENT' ? 'not found' : e.message };
    }
  }

  /**
   * Read text content (utf8), truncated to maxBytes.
   * @returns {{ok, file?, content?, bytes?, truncated?, error?}}
   */
  read(file, maxBytes = 200000) {
    const safe = this._resolveSafe(file);
    if (!safe.ok) return safe;
    try {
      const st = fs.statSync(safe.resolved);
      if (st.isDirectory()) return { ok: false, error: 'target is a directory' };

      const cap = Math.max(0, Number(maxBytes) || 0);
      const fd = fs.openSync(safe.resolved, 'r');
      try {
        const toRead = Math.min(st.size, cap);
        const buf = Buffer.alloc(toRead);
        fs.readSync(fd, buf, 0, toRead, 0);
        return {
          ok: true,
          file: safe.resolved,
          content: buf.toString('utf8'),
          bytes: toRead,
          truncated: st.size > cap,
        };
      } finally {
        fs.closeSync(fd);
      }
    } catch (e) {
      return { ok: false, error: e.code === 'ENOENT' ? 'not found' : e.message };
    }
  }

  // ── Writing ──────────────────────────────────────────────────────────────

  /**
   * Create or overwrite a file (inside allowedRoots).
   * @returns {{ok, file?, bytes?, error?}}
   */
  write(file, content) {
    const safe = this._resolveSafe(file);
    if (!safe.ok) return safe;
    try {
      const data = content == null ? '' : String(content);
      fs.mkdirSync(path.dirname(safe.resolved), { recursive: true });
      fs.writeFileSync(safe.resolved, data, 'utf8');
      return { ok: true, file: safe.resolved, bytes: Buffer.byteLength(data, 'utf8') };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * Append text to a file (creates it if missing).
   * @returns {{ok, file?, bytes?, error?}}
   */
  append(file, content) {
    const safe = this._resolveSafe(file);
    if (!safe.ok) return safe;
    try {
      const data = content == null ? '' : String(content);
      fs.mkdirSync(path.dirname(safe.resolved), { recursive: true });
      fs.appendFileSync(safe.resolved, data, 'utf8');
      return { ok: true, file: safe.resolved, bytes: Buffer.byteLength(data, 'utf8') };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── Moving / renaming / copying ──────────────────────────────────────────

  /**
   * Move src → dest. Both must be inside allowedRoots.
   * @returns {{ok, src?, dest?, error?}}
   */
  move(src, dest) {
    const s = this._resolveSafe(src);
    if (!s.ok) return s;
    const d = this._resolveSafe(dest);
    if (!d.ok) return d;
    try {
      if (!fs.existsSync(s.resolved)) return { ok: false, error: 'not found' };
      fs.mkdirSync(path.dirname(d.resolved), { recursive: true });
      this._relocate(s.resolved, d.resolved);
      return { ok: true, src: s.resolved, dest: d.resolved };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * Rename src to a new base name within the same directory.
   * newName must be a bare filename (no path separators).
   * @returns {{ok, src?, dest?, error?}}
   */
  rename(src, newName) {
    const s = this._resolveSafe(src);
    if (!s.ok) return s;
    if (!newName || /[\\/]/.test(String(newName)) || String(newName).includes('..')) {
      return { ok: false, error: 'invalid name' };
    }
    const dest = path.join(path.dirname(s.resolved), String(newName));
    return this.move(s.resolved, dest);
  }

  /**
   * Copy src → dest (recursively for directories). Both inside allowedRoots.
   * @returns {{ok, src?, dest?, error?}}
   */
  copy(src, dest) {
    const s = this._resolveSafe(src);
    if (!s.ok) return s;
    const d = this._resolveSafe(dest);
    if (!d.ok) return d;
    try {
      if (!fs.existsSync(s.resolved)) return { ok: false, error: 'not found' };
      fs.mkdirSync(path.dirname(d.resolved), { recursive: true });
      // fs.cpSync (Node 16.7+) handles files and directories recursively.
      fs.cpSync(s.resolved, d.resolved, { recursive: true });
      return { ok: true, src: s.resolved, dest: d.resolved };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── Directory creation ───────────────────────────────────────────────────

  /**
   * Create a directory (recursive).
   * @returns {{ok, dir?, error?}}
   */
  mkdir(dir) {
    const safe = this._resolveSafe(dir);
    if (!safe.ok) return safe;
    try {
      fs.mkdirSync(safe.resolved, { recursive: true });
      return { ok: true, dir: safe.resolved };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── Safe delete ──────────────────────────────────────────────────────────

  /**
   * SAFE delete: move the target into `.lucy-trash` inside the same root rather
   * than hard-deleting. Never permanently destroys data.
   * @returns {{ok, trashed?, original?, error?}}
   */
  remove(target) {
    const safe = this._resolveSafe(target);
    if (!safe.ok) return safe;
    try {
      if (!fs.existsSync(safe.resolved)) return { ok: false, error: 'not found' };

      const trashRoot = path.join(safe.root, TRASH_DIR);

      // Never let remove() recurse on the trash folder itself.
      if (safe.resolved === trashRoot ||
          safe.resolved.toLowerCase().startsWith(trashRoot.toLowerCase() + path.sep)) {
        return { ok: false, error: 'cannot trash the trash folder' };
      }

      fs.mkdirSync(trashRoot, { recursive: true });

      // Timestamp-prefix the trashed name to avoid collisions.
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const base = path.basename(safe.resolved);
      let trashed = path.join(trashRoot, `${stamp}__${base}`);
      let n = 1;
      while (fs.existsSync(trashed)) {
        trashed = path.join(trashRoot, `${stamp}__${n++}__${base}`);
      }

      this._relocate(safe.resolved, trashed);
      return { ok: true, trashed, original: safe.resolved };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── Search ───────────────────────────────────────────────────────────────

  /**
   * Find files by name substring and/or extension.
   * @param {string} dir
   * @param {{query?:string, ext?:string, recursive?:boolean}} [opts]
   * @returns {{ok, matches?, count?, error?}}
   */
  search(dir, opts = {}) {
    const safe = this._resolveSafe(dir);
    if (!safe.ok) return safe;

    const query = opts.query ? String(opts.query).toLowerCase() : null;
    let ext = opts.ext ? String(opts.ext).toLowerCase() : null;
    if (ext && !ext.startsWith('.')) ext = '.' + ext;
    const recursive = opts.recursive !== false; // default true

    const matches = [];
    const walk = (current) => {
      let names;
      try { names = fs.readdirSync(current); } catch (_) { return; }
      for (const name of names) {
        const full = path.join(current, name);
        let st;
        try { st = fs.statSync(full); } catch (_) { continue; }
        if (st.isDirectory()) {
          if (name === TRASH_DIR) continue; // don't surface trashed files
          if (recursive) walk(full);
          continue;
        }
        const lname = name.toLowerCase();
        const fext = path.extname(name).toLowerCase();
        if (query && !lname.includes(query)) continue;
        if (ext && fext !== ext) continue;
        matches.push({
          name,
          path: full,
          size: st.size,
          modified: st.mtime.toISOString(),
          ext: fext,
        });
      }
    };

    try {
      walk(safe.resolved);
      return { ok: true, matches, count: matches.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── Organize ─────────────────────────────────────────────────────────────

  /**
   * Group files in `dir` into subfolders. Only files at the top level of `dir`
   * are moved — subdirectories are left untouched.
   *   by:'ext'  → buckets like images/, docs/, pdfs/ (unknown exts → 'other')
   *   by:'date' → year-month folders like '2026-06' (by mtime)
   * @returns {{ok, by?, moved?, summary?, error?}}
   */
  organize(dir, opts = {}) {
    const safe = this._resolveSafe(dir);
    if (!safe.ok) return safe;
    const by = opts.by === 'date' ? 'date' : 'ext';

    try {
      const st = fs.statSync(safe.resolved);
      if (!st.isDirectory()) return { ok: false, error: 'target is not a directory' };
    } catch (e) {
      return { ok: false, error: e.code === 'ENOENT' ? 'not found' : e.message };
    }

    let names;
    try { names = fs.readdirSync(safe.resolved); }
    catch (e) { return { ok: false, error: e.message }; }

    const moved = [];
    const summary = {}; // bucket → count

    for (const name of names) {
      if (name === TRASH_DIR) continue;
      const full = path.join(safe.resolved, name);
      let st;
      try { st = fs.statSync(full); } catch (_) { continue; }
      if (st.isDirectory()) continue; // don't move folders, only files

      let bucket;
      if (by === 'ext') {
        const ext = path.extname(name).toLowerCase();
        bucket = EXT_BUCKETS[ext] || 'other';
      } else {
        const d = st.mtime;
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        bucket = `${d.getFullYear()}-${mm}`;
      }

      const bucketDir = path.join(safe.resolved, bucket);
      try {
        fs.mkdirSync(bucketDir, { recursive: true });
        let dest = path.join(bucketDir, name);
        // Avoid overwriting an existing file in the bucket.
        if (fs.existsSync(dest)) {
          const ext = path.extname(name);
          const stem = path.basename(name, ext);
          let n = 1;
          do { dest = path.join(bucketDir, `${stem}_${n++}${ext}`); }
          while (fs.existsSync(dest));
        }
        this._relocate(full, dest);
        moved.push({ name, from: full, to: dest, bucket });
        summary[bucket] = (summary[bucket] || 0) + 1;
      } catch (_) { /* skip files we cannot move */ }
    }

    return { ok: true, by, moved, summary };
  }

  // ── Stat ─────────────────────────────────────────────────────────────────

  /**
   * Stat a single target.
   * @returns {{ok, path?, type?, size?, modified?, created?, ext?, error?}}
   */
  stat(target) {
    const safe = this._resolveSafe(target);
    if (!safe.ok) return safe;
    try {
      const st = fs.statSync(safe.resolved);
      const type = this._type(st);
      return {
        ok: true,
        path: safe.resolved,
        type,
        size: st.size,
        modified: st.mtime.toISOString(),
        created: st.birthtime.toISOString(),
        ext: type === 'file' ? path.extname(safe.resolved).toLowerCase() : '',
      };
    } catch (e) {
      return { ok: false, error: e.code === 'ENOENT' ? 'not found' : e.message };
    }
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  /**
   * Relocate src→dest, falling back to copy+delete when rename() fails
   * (e.g. cross-device moves on Windows between different volumes).
   * @private
   */
  _relocate(src, dest) {
    try {
      fs.renameSync(src, dest);
    } catch (e) {
      if (e.code === 'EXDEV') {
        fs.cpSync(src, dest, { recursive: true });
        fs.rmSync(src, { recursive: true, force: true });
      } else {
        throw e;
      }
    }
  }
}

module.exports = { FileAgent };
