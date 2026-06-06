/**
 * Load denizen/.env into process.env without overriding shell variables.
 * Safe to require multiple times (idempotent).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');
let loaded = false;

function loadEnv() {
  if (loaded) return;
  loaded = true;
  let text;
  try {
    text = fs.readFileSync(ENV_PATH, 'utf-8');
  } catch (_) {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnv();

module.exports = { loadEnv, ENV_PATH };
