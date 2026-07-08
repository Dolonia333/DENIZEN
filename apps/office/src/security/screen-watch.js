'use strict';

/**
 * screen-watch.js — continuous screen-observation module for Windows.
 *
 * Spawns the existing screen-capture skill
 * (openclaw/skills/screen-capture/screen-capture.mjs) on an interval so an AI
 * assistant can periodically "see" the user's screen. The skill captures the
 * Windows desktop via ffmpeg's gdigrab input and writes a PNG.
 *
 * Design notes:
 *  - Built-ins + child_process only (no third-party deps).
 *  - CommonJS module.
 *  - EventEmitter-based: emits 'frame', 'change', 'error', 'start', 'stop'.
 *  - Robust: if ffmpeg / the skill is unavailable, emits 'error' and returns a
 *    clear status object instead of throwing/crashing the host process.
 *  - Ring buffer: keeps only the last N frames on disk.
 *  - Cheap change detection via byte hash of consecutive frames.
 */

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const jellyPaths = require('../../jelly/paths');
const DEFAULT_SKILL_PATH = jellyPaths.vendorScriptPath('screen-capture')
  || path.resolve(__dirname, '..', 'jelly', 'vendor', 'skills', 'screen-capture', 'screen-capture.mjs');

class ScreenWatch extends EventEmitter {
  /**
   * @param {object} opts
   * @param {number} [opts.intervalMs=4000] Capture cadence in ms.
   * @param {string|null} [opts.region=null] "x,y,w,h" region, or null for full desktop.
   * @param {string|null} [opts.title=null] Window title to capture, or null.
   * @param {string} opts.outDir Directory to write frames into (required).
   * @param {number} [opts.keepFrames=10] Ring-buffer size (max frames on disk).
   * @param {string} [opts.skillPath] Override path to the screen-capture skill.
   * @param {string} [opts.nodePath] Node executable used to run the skill.
   * @param {string[]} [opts.captureCmd] Override [cmd, ...args]; args get
   *        ["--output", <path>] appended. Mainly for testing/stubbing.
   * @param {number} [opts.captureTimeoutMs=20000] Per-capture timeout.
   */
  constructor(opts = {}) {
    super();

    const {
      intervalMs = 4000,
      region = null,
      title = null,
      outDir,
      keepFrames = 10,
      skillPath = DEFAULT_SKILL_PATH,
      nodePath = process.execPath,
      captureCmd = null,
      captureTimeoutMs = 20000,
    } = opts;

    if (!outDir || typeof outDir !== 'string') {
      throw new Error('ScreenWatch: outDir (string) is required');
    }

    this.intervalMs = Math.max(250, Number(intervalMs) || 4000);
    this.region = region || null;
    this.title = title || null;
    this.outDir = path.resolve(outDir);
    this.keepFrames = Math.max(1, Number(keepFrames) || 10);
    this.skillPath = skillPath;
    this.nodePath = nodePath;
    this.captureCmd = Array.isArray(captureCmd) && captureCmd.length ? captureCmd.slice() : null;
    this.captureTimeoutMs = Math.max(1000, Number(captureTimeoutMs) || 20000);

    // Runtime state
    this._timer = null;
    this._running = false;
    this._capturing = false; // guard against overlapping captures
    this._latest = null; // { path, ts }
    this._lastHash = null; // hash of last successfully captured frame
    this._frames = []; // ring buffer of file paths (oldest first)
    this._available = null; // null=unknown, true/false once probed

    this._ensureOutDir();
  }

  // ---- Public API -------------------------------------------------------

  /**
   * Begin the capture loop. Fires an immediate capture, then every intervalMs.
   * @returns {{started: boolean, reason?: string}}
   */
  start() {
    if (this._running) {
      return { started: false, reason: 'already-running' };
    }
    this._running = true;
    this.emit('start', { intervalMs: this.intervalMs, outDir: this.outDir });

    // Kick off an immediate capture, then schedule the loop.
    this._tick();
    this._timer = setInterval(() => this._tick(), this.intervalMs);
    // Don't keep the event loop alive solely for the watcher.
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();

    return { started: true };
  }

  /**
   * Stop the capture loop and clear scheduled work.
   * @returns {{stopped: boolean}}
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    const was = this._running;
    this._running = false;
    if (was) this.emit('stop', { latest: this._latest });
    return { stopped: was };
  }

  /** @returns {{path: string, ts: number}|null} */
  getLatest() {
    return this._latest ? { ...this._latest } : null;
  }

  /** @returns {boolean} whether the loop is active. */
  isRunning() {
    return this._running;
  }

  /** @returns {string[]} copy of the current on-disk frame ring buffer. */
  listFrames() {
    return this._frames.slice();
  }

  /**
   * Single on-demand capture ("look at my screen now").
   * Never throws; resolves with a status object instead.
   * @returns {Promise<{ok: boolean, path?: string, ts?: number,
   *                     changed?: boolean, error?: string}>}
   */
  async captureOnce() {
    if (this._capturing) {
      return { ok: false, error: 'busy', skipped: true };
    }
    return this._runCapture();
  }

  // ---- Internal ---------------------------------------------------------

  _ensureOutDir() {
    try {
      if (!fs.existsSync(this.outDir)) {
        fs.mkdirSync(this.outDir, { recursive: true });
      }
    } catch (err) {
      // Surface as an error event but don't crash the constructor's caller.
      queueMicrotask(() =>
        this.emit('error', new Error(`ScreenWatch: cannot create outDir: ${err.message}`))
      );
    }
  }

  // The scheduled loop body. Skips if a capture is already in flight.
  _tick() {
    if (!this._running) return;
    if (this._capturing) {
      // Previous capture still running — throttle/skip this tick.
      this.emit('skip', { reason: 'capture-in-progress', ts: Date.now() });
      return;
    }
    // Fire and forget; errors are emitted as events inside _runCapture.
    this._runCapture().catch((err) => {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    });
  }

  _buildCommand(outputPath) {
    // Explicit override (used for stubbing in tests).
    if (this.captureCmd) {
      const [cmd, ...rest] = this.captureCmd;
      return { cmd, args: [...rest, '--output', outputPath] };
    }

    const args = [this.skillPath];
    if (this.region) {
      args.push('--region', this.region);
    } else if (this.title) {
      args.push('--title', this.title);
    }
    args.push('--output', outputPath);
    return { cmd: this.nodePath, args };
  }

  // Spawns the capture command, parses its JSON, updates state, manages the
  // ring buffer, and emits events. Always resolves (never rejects).
  _runCapture() {
    this._capturing = true;
    const ts = Date.now();
    const outputPath = path.join(this.outDir, `frame-${ts}.png`);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        this._capturing = false;
        resolve(result);
      };

      let cmd, args;
      try {
        ({ cmd, args } = this._buildCommand(outputPath));
      } catch (err) {
        this.emit('error', err);
        return finish({ ok: false, error: err.message });
      }

      let child;
      try {
        child = spawn(cmd, args, { windowsHide: true });
      } catch (err) {
        this._available = false;
        const e = new Error(`ScreenWatch: failed to spawn capture: ${err.message}`);
        this.emit('error', e);
        return finish({ ok: false, error: e.message, available: false });
      }

      let stdout = '';
      let stderr = '';
      if (child.stdout) child.stdout.on('data', (d) => (stdout += d.toString()));
      if (child.stderr) child.stderr.on('data', (d) => (stderr += d.toString()));

      const killTimer = setTimeout(() => {
        try {
          child.kill();
        } catch (_) {
          /* ignore */
        }
      }, this.captureTimeoutMs);
      if (killTimer && typeof killTimer.unref === 'function') killTimer.unref();

      // spawn-level error (e.g. ENOENT for missing node/ffmpeg launcher).
      child.on('error', (err) => {
        clearTimeout(killTimer);
        this._available = false;
        const e = new Error(`ScreenWatch: capture process error: ${err.message}`);
        this.emit('error', e);
        finish({ ok: false, error: e.message, available: false });
      });

      child.on('close', (code) => {
        clearTimeout(killTimer);

        // Try to parse the skill's JSON output (last JSON line).
        const parsed = this._parseSkillOutput(stdout);

        // Determine success: skill says success AND file exists on disk.
        const fileExists = fs.existsSync(outputPath);
        const skillOk = parsed && parsed.success === true;

        if (!skillOk || !fileExists) {
          // Distinguish "tool unavailable" from "capture failed".
          const detail = (parsed && parsed.error) || stderr || `exit code ${code}`;
          const unavailable = /ENOENT|not recognized|cannot find|no such file/i.test(detail);
          if (unavailable) this._available = false;

          const e = new Error(
            `ScreenWatch: capture ${unavailable ? 'unavailable' : 'failed'}: ${String(detail).slice(0, 300)}`
          );
          this.emit('error', e);
          // Clean up a possibly-empty/partial file.
          this._safeUnlink(outputPath);
          return finish({
            ok: false,
            error: e.message,
            available: unavailable ? false : this._available,
          });
        }

        // Success path.
        this._available = true;

        // Some captures write to the path we requested; honor whatever the
        // skill reported if it differs (it shouldn't, since we pass --output).
        const finalPath =
          parsed.filePath && fs.existsSync(parsed.filePath) ? parsed.filePath : outputPath;

        let changed = true;
        let hash = null;
        try {
          hash = this._hashFile(finalPath);
          if (this._lastHash !== null && hash === this._lastHash) {
            changed = false;
          }
          this._lastHash = hash;
        } catch (_) {
          // If hashing fails, treat as changed (fail-open).
          changed = true;
        }

        this._latest = { path: finalPath, ts };
        this._pushFrame(finalPath);

        this.emit('frame', { path: finalPath, ts, changed, hash });
        if (changed) {
          this.emit('change', { path: finalPath, ts, hash });
        }

        finish({ ok: true, path: finalPath, ts, changed, available: true });
      });
    });
  }

  _parseSkillOutput(stdout) {
    if (!stdout) return null;
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    // Scan from the end for the last valid JSON object.
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.startsWith('{') && line.endsWith('}')) {
        try {
          return JSON.parse(line);
        } catch (_) {
          /* keep scanning */
        }
      }
    }
    return null;
  }

  _hashFile(filePath) {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha1').update(buf).digest('hex');
  }

  // Add a frame to the ring buffer, evicting + deleting the oldest if over cap.
  _pushFrame(filePath) {
    this._frames.push(filePath);
    while (this._frames.length > this.keepFrames) {
      const old = this._frames.shift();
      // Never delete the current latest frame.
      if (this._latest && old === this._latest.path) continue;
      this._safeUnlink(old);
    }
  }

  _safeUnlink(filePath) {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_) {
      /* ignore cleanup failures */
    }
  }
}

module.exports = { ScreenWatch, DEFAULT_SKILL_PATH };
