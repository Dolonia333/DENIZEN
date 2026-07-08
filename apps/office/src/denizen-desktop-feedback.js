'use strict';
/**
 * Desktop user-testing feedback — append-only JSONL at
 * data/desktop-feedback.jsonl (same durability model as llm-telemetry).
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_LOG_FILE = path.join(ROOT, 'data', 'desktop-feedback.jsonl');

let _logFile = DEFAULT_LOG_FILE;
let _counter = 0;

function configureLogFile(filePath) {
  _logFile = filePath || DEFAULT_LOG_FILE;
}

function resetCounter(n = 0) {
  _counter = Number.isFinite(n) ? n : 0;
}

function resolveLogFile() {
  return _logFile;
}

function appendJsonl(rec) {
  try {
    fs.mkdirSync(path.dirname(_logFile), { recursive: true });
    fs.appendFileSync(_logFile, JSON.stringify(rec) + '\n', 'utf8');
  } catch (err) {
    if (!appendJsonl._lastLogErrorAt || Date.now() - appendJsonl._lastLogErrorAt > 60000) {
      console.warn('[desktop-feedback] log append failed:', err?.message || err);
      appendJsonl._lastLogErrorAt = Date.now();
    }
  }
}

/**
 * @param {object} entry
 * @returns {object} normalized record
 */
function submitFeedback(entry = {}) {
  _counter += 1;
  const at = new Date().toISOString();
  const rec = {
    id: `dfb_${Date.now()}_${_counter.toString(36)}`,
    at,
    sessionId: entry.sessionId || entry.session_id || null,
    installId: entry.installId || entry.install_id || null,
    appVersion: entry.appVersion || entry.app_version || null,
    platform: entry.platform || null,
    arch: entry.arch || null,
    osVersion: entry.osVersion || entry.os_version || null,
    channel: entry.channel || null,
    event: entry.event || null,
    detail: entry.detail != null ? String(entry.detail).slice(0, 8000) : null,
    logsTail: entry.logsTail || entry.logs_tail
      ? String(entry.logsTail || entry.logs_tail).slice(-16000)
      : null,
  };
  appendJsonl(rec);
  return rec;
}

function parseJsonlLines(text) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch (_) {
      /* skip corrupt lines */
    }
  }
  return rows;
}

/**
 * @param {object} opts { limit }
 * @returns {object[]} newest first
 */
function listRecentFeedback(opts = {}) {
  const limit = Math.max(1, Math.min(500, Number(opts.limit) || 50));
  let text = '';
  try {
    if (fs.existsSync(_logFile)) {
      text = fs.readFileSync(_logFile, 'utf8');
    }
  } catch (_) {
    return [];
  }
  const rows = parseJsonlLines(text);
  return rows.slice(-limit).reverse();
}

module.exports = {
  configureLogFile,
  resetCounter,
  resolveLogFile,
  submitFeedback,
  listRecentFeedback,
  parseJsonlLines,
};
