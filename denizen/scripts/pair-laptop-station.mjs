#!/usr/bin/env node
'use strict';

/**
 * Pair HP laptop (Denizen Desktop) to the Dolonia account on the home server.
 * Updates laptop setup JSON, registers the station, enables City Power, launches app.
 *
 * Usage: node --env-file=.env scripts/pair-laptop-station.mjs
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v;
}

const SERVER_URL = requireEnv('DENIZEN_HOME_URL').replace(/\/+$/, '');
const LAPTOP_HOST = requireEnv('LAPTOP_SSH_HOST');
const LAPTOP_USER = requireEnv('LAPTOP_SSH_USER');
const LAPTOP_PASS = requireEnv('LAPTOP_SSH_PASS');
const SETUP_PATH = '~/.config/Denizen/denizen-desktop-setup.json';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function j(method, path, body, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`${SERVER_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: r.status, ...data };
  } finally {
    clearTimeout(t);
  }
}

function sshExec(script) {
  const py = join(__dirname, 'pair-laptop-station-ssh.py');
  writeFileSync(py, `#!/usr/bin/env python3
import paramiko, json, sys
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(${JSON.stringify(LAPTOP_HOST)}, username=${JSON.stringify(LAPTOP_USER)}, password=${JSON.stringify(LAPTOP_PASS)}, timeout=25)
cmd = sys.stdin.read()
_, o, e = ssh.exec_command(cmd, timeout=120)
out = o.read().decode('utf-8', 'replace')
err = e.read().decode('utf-8', 'replace')
code = o.channel.recv_exit_status()
print(out, end='')
if err.strip():
    print(err, file=sys.stderr, end='')
ssh.close()
sys.exit(code)
`);
  const res = spawnSync('py', ['-3', py], {
    input: script,
    encoding: 'utf-8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(res.stderr || res.stdout || `ssh exit ${res.status}`);
  }
  return res.stdout;
}

function readLaptopSetup() {
  const out = sshExec(`cat ${SETUP_PATH} 2>/dev/null || echo ""`);
  if (!out.trim()) return null;
  return JSON.parse(out);
}

function writeLaptopSetup(setup) {
  const payload = JSON.stringify(setup, null, 2);
  sshExec(`mkdir -p ~/.config/Denizen && cat > ${SETUP_PATH} << 'DENIZEN_SETUP_EOF'\n${payload}\nDENIZEN_SETUP_EOF`);
}

function launchLaptopDesktop() {
  try {
    sshExec(`bash -lc '
      PID=$(pgrep -u dolo -n gnome-shell 2>/dev/null || pgrep -u dolo -n gnome-session 2>/dev/null)
      tr "\\0" "\\n" < /proc/$PID/environ | grep -E "^(DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|DBUS_SESSION_BUS_ADDRESS|XDG_RUNTIME_DIR)=" > /tmp/denizen-gui.env
      set -a; source /tmp/denizen-gui.env; set +a
      if pgrep -f Denizen.AppImage >/dev/null; then echo already-running; exit 0; fi
      if [ ! -x "$HOME/Applications/Denizen.AppImage" ]; then echo "AppImage missing"; exit 1; fi
      nohup "$HOME/Applications/Denizen.AppImage" >> /tmp/denizen-laptop.log 2>&1 &
      sleep 4
      pgrep -af Denizen.AppImage || echo "launch failed"
    '`);
  } catch (err) {
    console.warn('Launch warning (station still registered):', err?.message || err);
  }
}

async function loginDolonia() {
  const login = await j('POST', '/api/visitor/auth/login', {
    username: 'Dolonia',
    password: requireEnv('PROBE_OWNER_PASS'),
    team_code: process.env.DENIZEN_TEAM_CODE || '1921',
  });
  if (!login.ok || !login.access_grant) {
    throw new Error(login.error || 'Dolonia login failed');
  }
  const headers = {
    'X-Display-Name': 'Dolonia',
    'X-Access-Grant': login.access_grant,
    'X-Access-Method': 'ceo',
    'X-Denizen-Ceo-Grant': login.ceo_grant || '',
    'X-Email': login.identity?.email || 'zionvanzandt@gmail.com',
  };
  const sess = await j('GET', '/api/visitor/session/open', null, headers);
  if (!sess.ok || !sess.session?.id) {
    throw new Error(sess.error || 'session open failed');
  }
  return {
    sessionId: sess.session.id,
    sessionToken: sess.session_token || null,
    identityId: sess.identity?.id || login.identity?.id || null,
    email: sess.identity?.email || login.identity?.email || null,
  };
}

function desktopHeaders(sessionId, sessionToken, email) {
  return {
    'X-Session-Id': sessionId,
    'X-Session-Token': sessionToken || '',
    'X-Denizen-Client': 'desktop',
    'X-Email': email || 'zionvanzandt@gmail.com',
    'X-Display-Name': 'Dolonia',
  };
}

async function main() {
  console.log(`Home server: ${SERVER_URL}`);

  let setup = readLaptopSetup();
  console.log('Laptop setup:', setup
    ? { serverUrl: setup.serverUrl, sessionId: setup.sessionId?.slice(0, 8), installId: setup.desktopInstallId?.slice(0, 8) }
    : 'none');

  const account = await loginDolonia();
  console.log('Account session:', account.sessionId.slice(0, 8), account.email);

  const sessionId = account.sessionId;
  const sessionToken = account.sessionToken;
  const installId = setup?.desktopInstallId || randomUUID();
  const h = desktopHeaders(sessionId, sessionToken, account.email);

  const machine = {
    hostname: 'HP81081D',
    platform: 'linux',
    cpu_cores: 8,
    ram_mb: 31829,
    gpu_model: 'integrated',
    capabilities: {
      read_files: true,
      write_files: false,
      run_code: true,
      screen_access: true,
      contribute_compute: true,
    },
  };

  const wizard = await j('POST', '/api/desktop/wizard/complete', {
    session_id: sessionId,
    desktop_install_id: installId,
    agent_permission_level: 'trusted',
    opt_in: true,
    setup_wizard_completed: true,
    home_server_url: SERVER_URL,
    machine,
    desktop_capabilities: machine.capabilities,
  }, h);
  if (!wizard.ok) throw new Error(wizard.error || 'wizard/complete failed');
  console.log('Wizard complete:', wizard.profile?.desktop_install_id?.slice(0, 8));

  const liveMetrics = {
    machine_id: `desktop-${wizard.profile?.desktop_install_id || installId}`,
    hostname: 'HP81081D',
    label: 'HP81081D',
    role: 'desktop',
    platform: 'linux',
    cpu_cores: 8,
    cpu_percent: 12,
    contributing: true,
    ram: { total_mb: 31829, used_mb: 3846, used_percent: 12 },
    gpu: { model: 'integrated', utilization_percent: 0 },
  };

  const sync = await j('POST', '/api/desktop/capabilities/sync', {
    session_id: sessionId,
    desktop_install_id: wizard.profile?.desktop_install_id || installId,
    machine,
    live_metrics: liveMetrics,
    machine_id: liveMetrics.machine_id,
    agent_permission_level: 'trusted',
    opt_in: true,
    desktop_capabilities: machine.capabilities,
    platform: 'linux',
    arch: 'x64',
  }, h);
  if (!sync.ok) throw new Error(sync.error || 'capabilities/sync failed');
  console.log('Fleet machine:', sync.fleet_machine?.label, sync.fleet_machine?.machine_id);

  const optIn = await j('POST', '/api/compute/node/opt-in', {
    session_id: sessionId,
    opt_in: true,
    contribution_level: 'standard',
    hardware: machine,
  }, h);
  console.log('City Power opt-in:', optIn.ok, optIn.contribution_level || optIn.contribution_summary?.contribution_level);

  const nextSetup = {
    completed: true,
    serverUrl: SERVER_URL,
    sessionId,
    sessionToken,
    permission: 'trusted',
    optIn: true,
    capabilities: machine.capabilities,
    hasSessionToken: !!sessionToken,
    desktopInstallId: wizard.profile?.desktop_install_id || installId,
    identityId: wizard.identity?.id || account.identityId,
    nodeId: wizard.node?.id || setup?.nodeId || null,
    nodeToken: wizard.node?.endpoint_token || setup?.nodeToken || null,
    diagnosticsOptIn: true,
    updateChannel: 'stable',
    completedAt: Date.now(),
  };
  writeLaptopSetup(nextSetup);
  console.log('Updated laptop setup →', SERVER_URL);

  launchLaptopDesktop();
  console.log('Launched Denizen Desktop on laptop');

  const status = await j('GET', `/api/compute/node/status?session_id=${encodeURIComponent(sessionId)}`, null, {
    ...h,
    'X-Denizen-Client': 'browser',
  });
  const fleet = status.contribution_summary?.fleet || [];
  console.log('\nYour stations:');
  for (const m of fleet) {
    console.log(`  - ${m.label || m.hostname || m.machine_id} (${m.role})`);
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('pair-laptop-station failed:', err?.message || err);
  process.exit(1);
});
