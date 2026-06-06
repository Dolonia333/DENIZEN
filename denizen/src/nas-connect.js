/**
 * nas-connect.js
 *
 * Windows NAS / network-drive helper for Node.js.
 *
 * Provides a small, dependency-free wrapper around the Windows `net use`
 * (and `net view`) commands so an assistant can map, verify, list and
 * unmap network drives. This lets file operations span both local disks
 * and NAS shares.
 *
 * Design notes:
 *   - Windows only. Every method guards on process.platform === 'win32'
 *     and returns a clear, structured error on other platforms.
 *   - Uses only Node built-ins: child_process, fs, path, os.
 *   - Never throws to the caller. Command failures are captured and
 *     returned as { ok: false, error } (stderr included where useful).
 *   - Passwords are NEVER logged or echoed back in any returned object.
 *
 * Parser tolerance:
 *   `net use` output is locale- and format-sensitive. The parser scans
 *   line by line, locates a drive token (e.g. "Z:") and a UNC remote
 *   (e.g. "\\nas\share"), and infers status from known English/connected
 *   keywords while falling back gracefully for unknown locales.
 *
 * Example:
 *   const { NasConnect } = require('./nas-connect');
 *   const nas = new NasConnect();
 *   console.log(nas.listMappedDrives());
 *   console.log(nas.status());
 *
 * @module nas-connect
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/** Default timeout (ms) for any net command. */
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Helper: standardized "not on Windows" error result.
 * @param {string} method
 * @returns {{ok:false, error:string, platform:string}}
 */
function notWindows(method) {
  return {
    ok: false,
    error: `${method} is only supported on Windows (process.platform === 'win32'). Current platform: ${process.platform}.`,
    platform: process.platform,
  };
}

/**
 * Run a command via execFileSync, capturing stdout/stderr without throwing.
 * @param {string} file - executable (e.g. 'net')
 * @param {string[]} args - arguments
 * @param {object} [opts]
 * @returns {{ok:boolean, stdout:string, stderr:string, code:number|null}}
 */
function runCommand(file, args, opts = {}) {
  try {
    const stdout = execFileSync(file, args, {
      encoding: 'utf8',
      timeout: opts.timeout || DEFAULT_TIMEOUT_MS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: stdout || '', stderr: '', code: 0 };
  } catch (err) {
    // execFileSync throws on non-zero exit; gather whatever we can.
    const stdout = (err && err.stdout && err.stdout.toString()) || '';
    const stderr = (err && err.stderr && err.stderr.toString()) || '';
    const message = (err && err.message) || 'Unknown command failure';
    return {
      ok: false,
      stdout,
      stderr: stderr || message,
      code: typeof err.status === 'number' ? err.status : null,
    };
  }
}

class NasConnect {
  /**
   * @param {object} [options]
   * @param {number} [options.timeout] - default command timeout in ms.
   */
  constructor(options = {}) {
    this.timeout = options.timeout || DEFAULT_TIMEOUT_MS;
    this.isWindows = process.platform === 'win32';
  }

  /**
   * Parse the raw text output of `net use`.
   *
   * Tolerant of locale and spacing variations. Looks for lines containing
   * a UNC path (\\host\share). The drive letter (if any) and status are
   * taken from the same line. Lines without a UNC remote are ignored.
   *
   * @param {string} raw - stdout of `net use`.
   * @returns {Array<{drive:string|null, remote:string, status:string}>}
   */
  parseNetUse(raw) {
    const results = [];
    if (!raw || typeof raw !== 'string') return results;

    const lines = raw.split(/\r?\n/);
    // Drive letter token like "Z:" appearing as its own column.
    const driveRe = /(?:^|\s)([A-Za-z]):(?=\s|$)/;
    // UNC remote like \\server\share (allow trailing path).
    const uncRe = /(\\\\[^\s]+)/;

    // Known status keywords (English). Unknown -> first column token.
    const statusMap = [
      { re: /\bdisconnected\b/i, value: 'Disconnected' },
      { re: /\bunavailable\b/i, value: 'Unavailable' },
      { re: /\breconnecting\b/i, value: 'Reconnecting' },
      { re: /\bok\b/i, value: 'OK' },
      { re: /\bconnected\b/i, value: 'OK' },
    ];

    for (const line of lines) {
      if (!line || !line.trim()) continue;
      const uncMatch = line.match(uncRe);
      if (!uncMatch) continue; // only care about lines with a remote share

      const remote = uncMatch[1];

      // Drive letter: search the portion of the line before the UNC path
      // so we don't accidentally grab a letter from inside the path.
      const beforeRemote = line.slice(0, uncMatch.index);
      const driveMatch = beforeRemote.match(driveRe);
      const drive = driveMatch ? `${driveMatch[1].toUpperCase()}:` : null;

      // Status: scan known keywords; default to 'OK' if a drive is mapped
      // and no negative keyword is present, otherwise 'Unknown'.
      let status = null;
      for (const s of statusMap) {
        if (s.re.test(line)) {
          status = s.value;
          break;
        }
      }
      if (!status) {
        // First whitespace-delimited token is often the status in localized
        // output; fall back to that, else 'Unknown'.
        const firstTok = line.trim().split(/\s+/)[0];
        status = firstTok && !/^[A-Za-z]:$/.test(firstTok) && !firstTok.startsWith('\\\\')
          ? firstTok
          : 'Unknown';
      }

      results.push({ drive, remote, status });
    }

    return results;
  }

  /**
   * List currently mapped network drives by running `net use`.
   * @returns {{ok:true, drives:Array}|{ok:false, error:string}}
   */
  listMappedDrives() {
    if (!this.isWindows) return notWindows('listMappedDrives');

    const res = runCommand('net', ['use'], { timeout: this.timeout });
    if (!res.ok && !res.stdout) {
      return { ok: false, error: res.stderr || 'net use failed', drives: [] };
    }
    const drives = this.parseNetUse(res.stdout);
    return { ok: true, drives };
  }

  /**
   * Enumerate shares exposed by a host via `net view \\host`.
   * Best-effort: may fail without permissions or if host is offline.
   *
   * @param {string} host - hostname or IP (without leading backslashes).
   * @returns {{ok:true, host:string, shares:Array<{name:string, type:string}>}|{ok:false, error:string}}
   */
  listNetworkShares(host) {
    if (!this.isWindows) return notWindows('listNetworkShares');
    if (!host || typeof host !== 'string') {
      return { ok: false, error: 'host is required (hostname or IP).' };
    }
    // Normalize: strip any leading backslashes the caller may have included.
    const clean = host.replace(/^\\+/, '');
    const target = `\\\\${clean}`;

    const res = runCommand('net', ['view', target], { timeout: this.timeout });
    if (!res.ok && !res.stdout) {
      return {
        ok: false,
        error: res.stderr || `net view ${target} failed (host may be offline or access denied).`,
      };
    }

    const shares = [];
    const lines = res.stdout.split(/\r?\n/);
    for (const line of lines) {
      // Share lines typically: "ShareName   Disk   Comment"
      const m = line.match(/^(\S.*?)\s{2,}(Disk|Print|IPC|Diskette)\b/i);
      if (m) {
        shares.push({ name: m[1].trim(), type: m[2] });
      }
    }
    return { ok: true, host: clean, shares };
  }

  /**
   * Map a network drive using `net use`.
   *
   * Builds: net use <letter>: <uncPath> [password] [/user:username] [/persistent:yes|no]
   * (Windows accepts the password as a positional argument; we pass it as a
   *  separate argv element so it never appears in any logged command string.)
   *
   * @param {object} params
   * @param {string} params.letter - single drive letter A-Z (with or without colon).
   * @param {string} params.uncPath - UNC path starting with \\.
   * @param {string} [params.username] - optional credential username.
   * @param {string} [params.password] - optional credential password (never logged).
   * @param {boolean} [params.persistent=false] - reconnect at logon.
   * @returns {{ok:boolean, drive?:string, message?:string, error?:string}}
   */
  mapDrive({ letter, uncPath, username, password, persistent = false } = {}) {
    if (!this.isWindows) return notWindows('mapDrive');

    // Validate letter: single A-Z (tolerate trailing colon).
    const letterClean = String(letter || '').replace(/:$/, '').toUpperCase();
    if (!/^[A-Z]$/.test(letterClean)) {
      return { ok: false, error: `Invalid drive letter "${letter}". Expected a single A-Z.` };
    }
    // Validate UNC path.
    if (!uncPath || typeof uncPath !== 'string' || !uncPath.startsWith('\\\\')) {
      return { ok: false, error: `Invalid uncPath "${uncPath}". Must start with \\\\ (e.g. \\\\nas\\share).` };
    }

    const drive = `${letterClean}:`;
    const args = ['use', drive, uncPath];

    // Positional password BEFORE /user per net use syntax: net use x: \\h\s [pwd] [/user:u]
    if (password != null && password !== '') {
      args.push(String(password));
    }
    if (username) {
      args.push(`/user:${username}`);
    }
    args.push(`/persistent:${persistent ? 'yes' : 'no'}`);

    const res = runCommand('net', args, { timeout: this.timeout });
    if (!res.ok) {
      // Build a safe error message that NEVER includes the password.
      return {
        ok: false,
        drive,
        error: (res.stderr || res.stdout || 'net use failed').trim(),
      };
    }
    return {
      ok: true,
      drive,
      message: `Mapped ${drive} -> ${uncPath}${persistent ? ' (persistent)' : ''}.`,
    };
  }

  /**
   * Verify a drive or path is reachable and check read/write access.
   *
   * @param {string} driveOrPath - e.g. 'Z:', 'Z:\\', or a full path.
   * @returns {{ok:boolean, target:string, reachable:boolean, writable:boolean, error?:string}}
   */
  verify(driveOrPath) {
    if (!this.isWindows) {
      const nw = notWindows('verify');
      return { ...nw, target: driveOrPath, reachable: false, writable: false };
    }
    if (!driveOrPath || typeof driveOrPath !== 'string') {
      return { ok: false, target: String(driveOrPath), reachable: false, writable: false, error: 'driveOrPath is required.' };
    }

    // Normalize a bare drive letter like "Z:" to "Z:\" so existsSync works.
    let target = driveOrPath;
    if (/^[A-Za-z]:$/.test(target)) target = `${target}\\`;

    let reachable = false;
    let writable = false;
    let error;

    try {
      reachable = fs.existsSync(target);
    } catch (e) {
      reachable = false;
      error = e && e.message;
    }

    if (reachable) {
      // Read access check.
      try {
        fs.accessSync(target, fs.constants.R_OK);
      } catch (e) {
        error = (error ? error + '; ' : '') + `read check failed: ${e.message}`;
      }
      // Write access check (non-destructive: only probes the access bit).
      try {
        fs.accessSync(target, fs.constants.W_OK);
        writable = true;
      } catch (e) {
        writable = false;
      }
    }

    return {
      ok: reachable,
      target,
      reachable,
      writable,
      ...(error ? { error } : {}),
    };
  }

  /**
   * Unmap (delete) a mapped drive via `net use <letter>: /delete /y`.
   *
   * @param {string} letter - single drive letter A-Z (with or without colon).
   * @returns {{ok:boolean, drive?:string, message?:string, error?:string}}
   */
  unmapDrive(letter) {
    if (!this.isWindows) return notWindows('unmapDrive');

    const letterClean = String(letter || '').replace(/:$/, '').toUpperCase();
    if (!/^[A-Z]$/.test(letterClean)) {
      return { ok: false, error: `Invalid drive letter "${letter}". Expected a single A-Z.` };
    }
    const drive = `${letterClean}:`;

    const res = runCommand('net', ['use', drive, '/delete', '/y'], { timeout: this.timeout });
    if (!res.ok) {
      return { ok: false, drive, error: (res.stderr || res.stdout || 'net use /delete failed').trim() };
    }
    return { ok: true, drive, message: `Unmapped ${drive}.` };
  }

  /**
   * Convenience summary: list mapped drives and report reachability for each.
   *
   * @returns {{ok:boolean, platform:string, count:number, drives:Array, error?:string}}
   */
  status() {
    if (!this.isWindows) {
      const nw = notWindows('status');
      return { ...nw, platform: process.platform, count: 0, drives: [] };
    }

    const listed = this.listMappedDrives();
    if (!listed.ok) {
      return { ok: false, platform: process.platform, count: 0, drives: [], error: listed.error };
    }

    const drives = listed.drives.map((d) => {
      let reachable = false;
      let writable = false;
      if (d.drive) {
        const v = this.verify(d.drive);
        reachable = v.reachable;
        writable = v.writable;
      }
      return { ...d, reachable, writable };
    });

    return {
      ok: true,
      platform: process.platform,
      count: drives.length,
      drives,
    };
  }
}

module.exports = { NasConnect };

// Convenience: allow `node nas-connect.js` to print a quick status summary.
if (require.main === module) {
  const nas = new NasConnect();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(nas.status(), null, 2));
}
