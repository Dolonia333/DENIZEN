/**
 * Load denizen/.env and .env.production into process.env.
 * - Does not override non-empty shell/Docker env vars.
 * - Empty strings (common Docker "LM_STUDIO_URL=") ARE fillable from files.
 * Safe to require multiple times (idempotent).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const ENV_PRODUCTION_PATH = path.join(ROOT, '.env.production');
let loaded = false;

function parseAndApply(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch (_) {
    return 0;
  }
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    const cur = process.env[key];
    // Skip only when already set to a non-empty value.
    if (cur !== undefined && String(cur).trim() !== '') continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"'))
      || (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
    n += 1;
  }
  return n;
}

function loadEnv() {
  if (loaded) return;
  loaded = true;
  // Base local defaults, then production pins (production fills empties).
  parseAndApply(ENV_PATH);
  parseAndApply(ENV_PRODUCTION_PATH);
  // Optional explicit override file for NAS one-offs
  parseAndApply(path.join(ROOT, '.env.local'));
}

loadEnv();

module.exports = { loadEnv, ENV_PATH, ENV_PRODUCTION_PATH };
