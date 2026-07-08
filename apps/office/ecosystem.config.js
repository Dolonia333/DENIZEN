/**
 * PM2 production config — loads key env from .env.production when present.
 * Usage: pm2 start ecosystem.config.js --env production
 */
const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').splitlines()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

const prodEnv = loadEnvFile(path.join(__dirname, '.env.production'));

const productionKeys = [
  'PORT',
  'NODE_ENV',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'DENIZEN_PUBLIC_URL',
  'DENIZEN_ECONOMY_MODE',
  'DENIZEN_COFOUNDER_LLM',
  'DENIZEN_REAL_WORK_MODE',
  'LM_STUDIO_REMOTE_URLS',
  'LM_STUDIO_ROUTER',
  'LM_STUDIO_MODEL',
  'LM_STUDIO_FAST_MODEL',
  'LM_STUDIO_PARALLEL',
  'DENIZEN_INTERNAL_API_TOKEN',
];

const productionEnv = { PORT: 8080, NODE_ENV: 'production' };
for (const key of productionKeys) {
  if (prodEnv[key] != null && prodEnv[key] !== '') productionEnv[key] = prodEnv[key];
}

module.exports = {
  apps: [
    {
      name: 'denizen',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        PORT: 8080,
        NODE_ENV: 'development',
      },
      env_production: productionEnv,
    },
  ],
};
