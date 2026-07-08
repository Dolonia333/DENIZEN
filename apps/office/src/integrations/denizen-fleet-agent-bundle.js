'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const BUILD_SCRIPT = path.resolve(__dirname, '../scripts/build-fleet-agent-bundle.py');

function createAgentBundleBuffer(opts = {}) {
  const args = [
    '-3',
    BUILD_SCRIPT,
    '--machine-id', String(opts.machineId || 'hp81081d'),
    '--agent-root', String(opts.agentRoot || '~/denizen-agent'),
  ];
  if (opts.label) args.push('--label', String(opts.label));
  if (opts.denizenUrl) args.push('--denizen-url', String(opts.denizenUrl));
  if (opts.publicUrl) args.push('--public-url', String(opts.publicUrl));
  if (opts.identityId) args.push('--identity-id', String(opts.identityId));
  if (opts.sessionId) args.push('--session-id', String(opts.sessionId));
  if (opts.sessionToken) args.push('--session-token', String(opts.sessionToken));
  if (opts.fleetToken) args.push('--fleet-token', String(opts.fleetToken));

  const py = process.platform === 'win32' ? 'py' : 'python3';
  const result = spawnSync(py, args, {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`fleet agent bundle build failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const err = (result.stderr || Buffer.alloc(0)).toString('utf8').trim();
    throw new Error(err || `fleet agent bundle build exited ${result.status}`);
  }
  return result.stdout;
}

function createAgentBundleStream(opts = {}) {
  const { PassThrough } = require('node:stream');
  const out = new PassThrough();
  try {
    out.end(createAgentBundleBuffer(opts));
  } catch (err) {
    out.destroy(err);
  }
  return out;
}

module.exports = {
  createAgentBundleBuffer,
  createAgentBundleStream,
};
