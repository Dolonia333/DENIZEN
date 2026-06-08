'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TAIL_BYTES = 2048;

let crashLogPath = null;
let submitFeedbackFn = null;
let getSetupStateFn = null;
let initialized = false;

function resolveCrashLogPath(userDataDir) {
  return path.join(userDataDir, 'crash-log.jsonl');
}

function appendCrashRecord(record) {
  if (!crashLogPath) return;
  try {
    fs.mkdirSync(path.dirname(crashLogPath), { recursive: true });
    fs.appendFileSync(crashLogPath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    if (!appendCrashRecord._lastLogErrorAt || Date.now() - appendCrashRecord._lastLogErrorAt > 60000) {
      console.warn('[crash-reporter] log append failed:', err?.message || err);
      appendCrashRecord._lastLogErrorAt = Date.now();
    }
  }
}

function normalizeError(reason) {
  if (reason instanceof Error) {
    return {
      message: reason.message || String(reason),
      stack: reason.stack || null,
      name: reason.name || 'Error',
    };
  }
  return {
    message: String(reason),
    stack: null,
    name: 'Error',
  };
}

function buildCrashRecord(kind, reason) {
  const err = normalizeError(reason);
  return {
    at: new Date().toISOString(),
    kind,
    name: err.name,
    message: err.message,
    stack: err.stack,
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
  };
}

function maybeAutoSubmitCrash(record) {
  const setup = typeof getSetupStateFn === 'function' ? getSetupStateFn() : {};
  if (!setup?.diagnosticsOptIn || typeof submitFeedbackFn !== 'function') return;

  const detail = [record.message, record.stack].filter(Boolean).join('\n\n');
  try {
    const result = submitFeedbackFn({
      event: 'crash',
      detail,
    });
    if (result && typeof result.catch === 'function') {
      result.catch((err) => {
        console.warn('[crash-reporter] auto-submit failed:', err?.message || err);
      });
    }
  } catch (err) {
    console.warn('[crash-reporter] auto-submit failed:', err?.message || err);
  }
}

function handleCrash(kind, reason) {
  const record = buildCrashRecord(kind, reason);
  appendCrashRecord(record);
  console.error(`[crash-reporter] ${kind}:`, record.message);
  if (record.stack) console.error(record.stack);
  maybeAutoSubmitCrash(record);
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

function readCrashLogText() {
  if (!crashLogPath) return '';
  try {
    if (!fs.existsSync(crashLogPath)) return '';
    return fs.readFileSync(crashLogPath, 'utf8');
  } catch (_) {
    return '';
  }
}

function readCrashLogTail(maxBytes = DEFAULT_TAIL_BYTES) {
  const text = readCrashLogText();
  if (!text) return null;
  const limit = Math.max(1, Number(maxBytes) || DEFAULT_TAIL_BYTES);
  if (text.length <= limit) return text;
  return text.slice(-limit);
}

function readRecentCrashes(limit = 10) {
  const rows = parseJsonlLines(readCrashLogText());
  const capped = Math.max(1, Math.min(500, Number(limit) || 10));
  return rows.slice(-capped).reverse();
}

function initCrashReporter(opts = {}) {
  if (initialized) return;
  const userDataDir = opts.userDataDir;
  if (!userDataDir) {
    throw new Error('initCrashReporter requires userDataDir');
  }

  crashLogPath = resolveCrashLogPath(userDataDir);
  submitFeedbackFn = opts.submitFeedbackFn || null;
  getSetupStateFn = opts.getSetupState || null;

  process.on('uncaughtException', (err) => {
    handleCrash('uncaughtException', err);
  });

  process.on('unhandledRejection', (reason) => {
    handleCrash('unhandledRejection', reason);
  });

  initialized = true;
}

module.exports = {
  initCrashReporter,
  readRecentCrashes,
  readCrashLogTail,
  resolveCrashLogPath,
};
