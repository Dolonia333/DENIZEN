'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, braveSearchKey, lmStudioConfig } = require('./config-loader');
const { DENIZEN_ROOT, jellyHome } = require('./paths');

let _cache = null;

function getConfig(force = false) {
  if (!_cache || force) {
    _cache = loadConfig(DENIZEN_ROOT);
  }
  return _cache;
}

function configPath() {
  return _cache?._source || null;
}

function readEnvFile() {
  const candidates = [
    path.join(jellyHome(), '.env'),
    path.join(process.env.USERPROFILE || process.env.HOME || '', '.denizen', '.env'),
    path.join(process.env.USERPROFILE || process.env.HOME || '', '.openclaw', '.env'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const out = {};
      for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
      return out;
    } catch (_) {}
  }
  return {};
}

function getBraveKey() {
  return braveSearchKey(getConfig());
}

function getLmStudio() {
  return lmStudioConfig(getConfig());
}

function getProviders() {
  return getConfig()?.models?.providers || {};
}

module.exports = {
  getConfig,
  configPath,
  readEnvFile,
  getBraveKey,
  getLmStudio,
  getProviders,
  loadConfig,
};
