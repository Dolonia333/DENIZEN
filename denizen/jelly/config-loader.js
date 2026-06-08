'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ENV_KEY_MAP = {
  ANTHROPIC_API_KEY: ['providers', 'anthropic', 'apiKey'],
  MOONSHOT_API_KEY: ['providers', 'moonshot', 'apiKey'],
  XAI_API_KEY: ['providers', 'xai', 'apiKey'],
  GOOGLE_API_KEY: ['providers', 'google', 'apiKey'],
  BRAVE_SEARCH_API_KEY: ['tools', 'web', 'search', 'apiKey'],
  BRAVE_API_KEY: ['tools', 'web', 'search', 'apiKey'],
  SUPABASE_URL: ['supabase', 'url'],
  SUPABASE_BRIDGE_URL: ['supabase', 'bridgeUrl'],
  AGENT_TOKEN: ['supabase', 'agentToken'],
  BROWSERCLAW_URL: ['browser', 'browserclawUrl'],
};

function deepGet(obj, keys) {
  let cur = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

function deepSet(obj, keys, value) {
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function homeDir() {
  return process.env.USERPROFILE || process.env.HOME || '';
}

/**
 * Load Jelly config. Prefers denizen/config/jelly.json,
 * falls back to legacy harness.json and ~/.openclaw/openclaw.json during migration.
 */
function loadConfig(denizenRoot) {
  const candidates = [
    path.join(denizenRoot, 'config', 'jelly.json'),
    path.join(homeDir(), '.denizen', 'jelly.json'),
    path.join(denizenRoot, 'config', 'harness.json'),
    path.join(homeDir(), '.denizen', 'harness.json'),
    path.join(homeDir(), '.openclaw', 'openclaw.json'),
  ];

  let config = {};
  for (const file of candidates) {
    const data = readJsonIfExists(file);
    if (data) {
      config = { ...config, ...data, _source: file };
      break;
    }
  }

  for (const [envKey, keyPath] of Object.entries(ENV_KEY_MAP)) {
    const val = process.env[envKey];
    if (val) deepSet(config, keyPath, val);
  }

  if (!config.supabase) config.supabase = {};
  if (!config.supabase.url && process.env.SUPABASE_URL) {
    config.supabase.url = process.env.SUPABASE_URL;
  }
  if (!config.supabase.bridgeUrl) {
    config.supabase.bridgeUrl = process.env.SUPABASE_BRIDGE_URL || 'http://127.0.0.1:18790';
  }
  if (!config.supabase.agentToken && process.env.AGENT_TOKEN) {
    config.supabase.agentToken = process.env.AGENT_TOKEN;
  }
  if (!config.browser) config.browser = {};
  if (!config.browser.browserclawUrl) {
    config.browser.browserclawUrl = process.env.BROWSERCLAW_URL || 'http://127.0.0.1:18792';
  }

  return config;
}

function braveSearchKey(config) {
  return config?.tools?.web?.search?.apiKey
    || process.env.BRAVE_SEARCH_API_KEY
    || process.env.BRAVE_API_KEY
    || '';
}

function lmStudioConfig(config) {
  const providers = config?.models?.providers || {};
  const openai = providers.openai || {};
  return {
    baseUrl: openai.baseUrl || process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1',
    apiKey: openai.apiKey || 'lmstudio',
    model: openai.models?.[0]?.id || process.env.LM_STUDIO_MODEL || '',
  };
}

module.exports = {
  loadConfig,
  braveSearchKey,
  lmStudioConfig,
  ENV_KEY_MAP,
};
