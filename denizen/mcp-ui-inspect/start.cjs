'use strict';
/**
 * MCP launcher — loads denizen/.env (probe creds, DENIZEN_URL) then starts the stdio server.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

require(path.join(__dirname, '../src/load-env.js'));

if (!process.env.PROBE_OWNER_USER) process.env.PROBE_OWNER_USER = 'Dolonia';
if (!process.env.PROBE_OWNER_EMAIL && process.env.DENIZEN_TEAM_OWNER_EMAIL) {
  process.env.PROBE_OWNER_EMAIL = process.env.DENIZEN_TEAM_OWNER_EMAIL;
}
if (!process.env.PROBE_TEAM_CODE && process.env.DENIZEN_TEAM_CODE) {
  process.env.PROBE_TEAM_CODE = process.env.DENIZEN_TEAM_CODE;
}
if (!process.env.DENIZEN_URL) {
  process.env.DENIZEN_URL = process.env.DENIZEN_PUBLIC_URL || 'http://127.0.0.1:8081';
}

const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
  stdio: 'inherit',
  env: process.env,
  cwd: path.join(__dirname, '..'),
});

child.on('exit', (code) => process.exit(code ?? 0));
