'use strict';
/**
 * Linux Agent — runs real security commands in Kali WSL on behalf of Bouncer.
 *
 * Two layers:
 *   1. runCommand(cmd)  — executes a WSL bash command, returns stdout/stderr
 *   2. investigate(threat) — picks the right commands for the threat type,
 *      runs them, returns a structured findings object
 *
 * Commands are deliberately safe for read-only investigation:
 *   ss / netstat   — active connections
 *   nmap           — network scan (localhost / attacker IP)
 *   ps aux         — running processes
 *   last / who     — recent logins
 *   journalctl     — auth log lines
 *   lsof           — open files / sockets
 *
 * All commands run with a 20s timeout so a hung nmap never blocks the server.
 */

const { exec } = require('node:child_process');
const fs   = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT   = path.resolve(__dirname, '..');
const BASELINE_PATH  = path.join(PROJECT_ROOT, 'data', 'bouncer-baseline.json');

const WSL_DISTRO = process.env.WSL_DISTRO || 'kali-linux';
const CMD_TIMEOUT_MS = 20000;

/** Whether the 5-min Bouncer perimeter patrol should run (WSL nmap on Windows). */
function isBouncerPatrolEnabled() {
  const v = String(process.env.BOUNCER_PATROL || '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'yes' || v === 'container') return true;
  return process.platform === 'win32';
}

function parseHostPort(raw, fallbackHost, fallbackPort) {
  const s = String(raw || '').trim();
  if (!s) return { host: fallbackHost, port: fallbackPort };
  try {
    const u = new URL(s.includes('://') ? s : `http://${s}`);
    return {
      host: u.hostname || fallbackHost,
      port: parseInt(u.port, 10) || fallbackPort,
    };
  } catch (_) {
    return { host: fallbackHost, port: fallbackPort };
  }
}

/** WebSocket + LM Studio targets for patrol probes (respects PORT / LM_STUDIO_* env). */
function getPatrolProbeTargets() {
  const wsPort = parseInt(process.env.PORT, 10) || 8080;
  const lmRaw = process.env.LM_STUDIO_URL
    || String(process.env.LM_STUDIO_REMOTE_URLS || '').split(',')[0].trim()
    || '';
  const lm = parseHostPort(lmRaw, '127.0.0.1', 1234);
  return { ws: { host: '127.0.0.1', port: wsPort }, lm };
}

// ── Threat → command sets ────────────────────────────────────────────────────

const THREAT_COMMANDS = {
  network_scan: (ip) => [
    { label: 'Active connections', cmd: "ss -tnp 2>/dev/null | head -30" },
    { label: 'Established TCP',    cmd: "netstat -an 2>/dev/null | grep ESTABLISHED | head -20" },
    ip ? { label: `Quick nmap of attacker`, cmd: `nmap -T4 -F --open ${ip} 2>/dev/null` } : null,
  ],

  packet_anomaly: (ip, tsharkReady) => [
    { label: 'Active connections', cmd: "ss -tnp 2>/dev/null | head -30" },
    { label: 'Listening sockets',  cmd: "ss -tlnp 2>/dev/null | head -20" },
    ip ? { label: `Connections to/from attacker`, cmd: `netstat -an 2>/dev/null | grep ${ip}` } : null,
    { label: 'Recent packets (5s capture)', cmd: "timeout 5 tcpdump -i any -c 40 -nn 2>/dev/null || echo 'tcpdump needs root — skipping'" },
    // Tshark capture — only added at runtime if tshark is installed and ip is present
  ],

  brute_force: (ip) => [
    { label: 'Failed auth attempts', cmd: "grep -iE 'failed|invalid|refused' /var/log/auth.log 2>/dev/null | tail -20 || journalctl -n 20 --no-pager 2>/dev/null | grep -iE 'fail|auth|refused' || echo 'No auth log accessible'" },
    { label: 'Recent logins',        cmd: "last -n 15 2>/dev/null" },
    { label: 'Active sessions',      cmd: "who 2>/dev/null" },
    ip ? { label: `Port scan attacker`, cmd: `nmap -T4 -F ${ip} 2>/dev/null` } : null,
  ],

  data_breach: (ip) => [
    { label: 'Open files / sockets', cmd: "lsof -i -n 2>/dev/null | grep ESTABLISHED | head -20 || netstat -an 2>/dev/null | grep ESTABLISHED | head -20" },
    { label: 'Active sessions',      cmd: "who 2>/dev/null && last -n 10 2>/dev/null" },
    ip ? { label: `Connections to suspected IP`, cmd: `netstat -an 2>/dev/null | grep ${ip}` } : null,
  ],

  shell_exec: () => [
    { label: 'Running processes',    cmd: "ps aux 2>/dev/null | sort -rk3 | head -30" },
    { label: 'Recent commands (history)', cmd: "cat /root/.bash_history 2>/dev/null | tail -20 || echo 'History not accessible'" },
    { label: 'Listening on new ports', cmd: "ss -tlnp 2>/dev/null" },
  ],

  api_abuse: (ip) => [
    { label: 'Established connections', cmd: "netstat -an 2>/dev/null | grep ESTABLISHED | head -30" },
    { label: 'Connection counts by IP', cmd: "netstat -an 2>/dev/null | grep ESTABLISHED | awk '{print $5}' | cut -d: -f1 | sort | uniq -c | sort -rn | head -15" },
    ip ? { label: `Connections from attacker`, cmd: `netstat -an 2>/dev/null | grep ${ip}` } : null,
  ],

  exfiltration: (ip) => [
    { label: 'Outbound connections',  cmd: "ss -tnp 2>/dev/null | grep ESTAB | head -20" },
    { label: 'Large data transfers',  cmd: "netstat -s 2>/dev/null | grep -iE 'send|receive|byte' | head -15 || echo 'Stats unavailable'" },
    ip ? { label: `Traffic to suspected target`, cmd: `netstat -an 2>/dev/null | grep ${ip}` } : null,
  ],

  scan_probe: (ip) => [
    { label: 'Listening services',    cmd: "ss -tlnp 2>/dev/null" },
    { label: 'Recent connection attempts', cmd: "netstat -an 2>/dev/null | grep SYN | head -20" },
    ip ? { label: `nmap back at attacker`, cmd: `nmap -T4 -F --open ${ip} 2>/dev/null` } : null,
  ],

  process_spawn: () => [
    { label: 'All running processes', cmd: "ps aux 2>/dev/null | head -40" },
    { label: 'New processes (by start time)', cmd: "ps aux 2>/dev/null | sort -k9 | tail -20" },
    { label: 'Listening ports',       cmd: "ss -tlnp 2>/dev/null" },
  ],

  unknown: (ip) => [
    { label: 'Connections overview',  cmd: "ss -tnp 2>/dev/null | head -20" },
    { label: 'Processes',             cmd: "ps aux 2>/dev/null | head -20" },
    ip ? { label: `nmap of source`,   cmd: `nmap -T4 -F ${ip} 2>/dev/null` } : null,
  ],
};

// ── Core runner ──────────────────────────────────────────────────────────────

/**
 * Run a single bash command in WSL. Returns { stdout, stderr, exitCode, ms }.
 */
function runCommand(cmd) {
  return new Promise((resolve) => {
    const start = Date.now();
    // wsl -d kali-linux bash -c "cmd" — fall back to default wsl if distro not found
    const wslCmd = `wsl -d ${WSL_DISTRO} bash -c ${JSON.stringify(cmd)}`;
    const fallback = `wsl bash -c ${JSON.stringify(cmd)}`;

    let proc = exec(wslCmd, { timeout: CMD_TIMEOUT_MS, windowsHide: true }, (err, stdout, stderr) => {
      const ms = Date.now() - start;
      if (err && err.code === 1 && !stdout && !stderr) {
        // Distro not found — retry with default distro
        exec(fallback, { timeout: CMD_TIMEOUT_MS, windowsHide: true }, (err2, stdout2, stderr2) => {
          resolve({
            stdout:   (stdout2  || '').trim(),
            stderr:   (stderr2  || '').trim(),
            exitCode: err2 ? err2.code : 0,
            ms: Date.now() - start,
          });
        });
        return;
      }
      resolve({
        stdout:   (stdout  || '').trim(),
        stderr:   (stderr  || '').trim(),
        exitCode: err ? err.code : 0,
        ms,
      });
    });
  });
}

/**
 * Run a series of { label, cmd } pairs in sequence.
 * Returns an array of { label, output, ms } results.
 * Stops early if a command fails badly.
 */
async function runCommands(steps) {
  const results = [];
  for (const step of steps) {
    if (!step) continue; // null entries (ip-conditional commands skipped when no ip)
    try {
      const r = await runCommand(step.cmd);
      const output = r.stdout || r.stderr || '(no output)';
      results.push({ label: step.label, output: output.slice(0, 1500), ms: r.ms });
      console.log(`[LinuxAgent] ${step.label} (${r.ms}ms): ${output.slice(0, 80).replace(/\n/g, ' ')}`);
    } catch (err) {
      results.push({ label: step.label, output: `Error: ${err.message}`, ms: 0 });
    }
  }
  return results;
}

/**
 * Run the full investigation for a threat. Returns:
 * {
 *   ok: boolean,
 *   category, ip, steps: [{ label, output, ms }],
 *   summary: string,   // plain-text summary for Bouncer to report
 *   elapsed: number,   // total ms
 * }
 */
async function investigate(threat) {
  const category = threat.category || 'unknown';
  const ip       = extractIp(threat.source || threat.detail || '');
  const start    = Date.now();

  console.log(`[LinuxAgent] Investigating ${category} threat${ip ? ` from ${ip}` : ''}`);

  const cmdFn = THREAT_COMMANDS[category] || THREAT_COMMANDS.unknown;
  const steps = (cmdFn(ip) || []).filter(Boolean);

  // Feature 5: tshark integration for packet_anomaly — add step if tshark present
  if (category === 'packet_anomaly' && ip) {
    try {
      const tsharkCheck = await checkTshark();
      if (tsharkCheck.installed) {
        steps.push({
          label: 'Tshark packet capture (5s)',
          cmd: `timeout 5 tshark -i any -c 50 -Y "ip.src == ${ip} or ip.dst == ${ip}" -T fields -e ip.src -e ip.dst -e tcp.dstport -e tcp.flags.syn 2>/dev/null || echo "tshark not available"`,
        });
      }
    } catch (_) {}
  }

  let results;
  try {
    results = await runCommands(steps);
  } catch (err) {
    return { ok: false, error: err.message, category, ip, steps: [], summary: '', elapsed: Date.now() - start };
  }

  // If we have an attacker IP, run whois in parallel for threat intel
  if (ip) {
    try {
      const w = await whoisLookup(ip);
      if (w.ok && w.raw) {
        // Extract just the org/country lines from whois output
        const orgLines = w.raw.split('\n')
          .filter(l => /^(org|orgname|country|netname|descr|abuse)/i.test(l.trim()))
          .slice(0, 5)
          .join('\n');
        if (orgLines) {
          results.push({ label: `whois ${ip}`, output: orgLines, ms: 0 });
        }
      }
    } catch (_) {}
  }

  // Build a readable summary
  const lines = results.map(r =>
    `[${r.label}]\n${r.output}`
  ).join('\n\n');

  const elapsed = Date.now() - start;
  return { ok: true, category, ip, steps: results, summary: lines, elapsed };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractIp(str) {
  const m = String(str || '').match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
  return m ? m[1] : null;
}

// ── Proactive tools — Bouncer runs these on a schedule, not just on threats ──

/**
 * Baseline port scan of Denizen's known service ports.
 * Runs nmap -sV against localhost so Bouncer sees exactly what's exposed.
 * Returns structured { ports: [{port, state, service, version}], raw }
 */
async function baselineScan() {
  const { ws, lm } = getPatrolProbeTargets();
  const extra = [ws.port, lm.port, 5432, 3000, 80, 443, 8443, 27017];
  const DENIZEN_PORTS = [...new Set(extra)].join(',');
  const r = await runCommand(`nmap -sV -p ${DENIZEN_PORTS} --open localhost 2>/dev/null`);
  const raw = r.stdout || r.stderr || '(no output)';

  // Parse nmap output into structured port list
  const ports = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^(\d+)\/(tcp|udp)\s+(\w+)\s+(\S+)\s*(.*)/);
    if (m) ports.push({ port: m[1], proto: m[2], state: m[3], service: m[4], version: m[5].trim() });
  }

  return { ok: r.exitCode === 0, ports, raw: raw.slice(0, 1500) };
}

/**
 * Quick connectivity probe using netcat.
 * Useful for checking if a specific port is actually open before escalating.
 * Returns { open: bool, ms }
 */
async function probePort(host, port) {
  const r = await runCommand(`nc -zv -w 2 ${host} ${port} 2>&1`);
  const out = (r.stdout + r.stderr).toLowerCase();
  const open = out.includes('succeeded') || out.includes('open') || r.exitCode === 0;
  return { open, ms: r.ms, detail: (r.stdout + r.stderr).trim().slice(0, 200) };
}

/**
 * WHOIS lookup on a suspicious IP for threat intel context.
 * Bouncer uses this to identify who owns an attacker IP.
 */
async function whoisLookup(ip) {
  if (!extractIp(ip)) return { ok: false, error: 'invalid IP' };
  const r = await runCommand(`whois ${ip} 2>/dev/null | head -40`);
  return { ok: r.exitCode === 0, raw: (r.stdout || r.stderr || '').slice(0, 800) };
}

/**
 * tcpdump loopback snapshot — capture 30 packets on the loopback interface
 * for 5 seconds max. Shows what's actually flowing between server components.
 * NOTE: Requires root in WSL (runs with sudo -n, silently skips if not available).
 */
async function trafficSnapshot() {
  // -c 30 = cap at 30 packets, -q = quiet, -i lo = loopback, timeout via timeout cmd
  const r = await runCommand(`timeout 5 sudo tcpdump -i lo -c 30 -q -n 2>/dev/null || echo "(tcpdump requires root — run: sudo tcpdump -i lo -c 30 -q)"`)
  return { ok: r.exitCode === 0 || r.exitCode === 124, raw: (r.stdout || r.stderr || '').slice(0, 1200) };
}

/**
 * DNS investigation — resolve a hostname and check for suspicious patterns.
 */
async function dnsInvestigate(hostname) {
  const r = await runCommand(`dig +short ${hostname} 2>/dev/null; dig +short -x $(dig +short ${hostname} 2>/dev/null | head -1) 2>/dev/null`);
  return { ok: r.exitCode === 0, raw: (r.stdout || r.stderr || '').trim().slice(0, 400) };
}

/**
 * Check if tshark is installed (CLI Wireshark).
 * If not, returns an install hint. Wireshark libs are already present in Kali.
 */
async function checkTshark() {
  const r = await runCommand(`which tshark 2>/dev/null && tshark --version 2>/dev/null | head -1 || echo "NOT INSTALLED — run: sudo apt install -y tshark"`);
  return { installed: !r.stdout.includes('NOT INSTALLED'), detail: r.stdout.trim() };
}

// ── Baseline helpers ──────────────────────────────────────────────────────────

/**
 * Load the stored baseline from disk. Returns null if not found or unreadable.
 * @returns {{ ts: string, openPorts: Array, wsServer: object, lmStudio: object }|null}
 */
function loadBaseline() {
  try {
    const raw = fs.readFileSync(BASELINE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/**
 * Save the current scan result as the new baseline.
 * @param {{ openPorts: Array, wsServer: object, lmStudio: object }} scanResult
 */
function saveBaseline(scanResult) {
  try {
    const baseline = {
      ts: new Date().toISOString(),
      openPorts: (scanResult.openPorts || []).map(p => ({
        port: p.port,
        service: p.service || '',
        state: p.state || 'open',
      })),
      wsServer:  { open: !!(scanResult.wsServer && scanResult.wsServer.open) },
      lmStudio:  { open: !!(scanResult.lmStudio && scanResult.lmStudio.open) },
    };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2), 'utf8');
  } catch (err) {
    console.warn('[LinuxAgent] Could not save baseline:', err.message);
  }
}

// ── Structured report builder ─────────────────────────────────────────────────

/**
 * Build a structured markdown investigation report.
 *
 * @param {object} threat       - { category, severity, source, detail }
 * @param {object} investigation - { ok, category, ip, steps, summary, elapsed }
 * @param {object|null} whoisData - optional whois info already embedded in steps
 * @returns {string}  markdown report
 */
function buildReport(threat, investigation, whoisData) {
  const ts       = new Date().toISOString();
  const category = threat.category || investigation.category || 'unknown';
  const severity = threat.severity || 'unknown';
  const ip       = investigation.ip || extractIp(threat.source || threat.detail || '') || 'unknown';
  const steps    = Array.isArray(investigation.steps) ? investigation.steps : [];

  // ── Findings sections ──────────────────────────────────────────────────────
  let findingsSection = '';
  if (steps.length === 0) {
    findingsSection = '_No command output collected._\n';
  } else {
    findingsSection = steps.map(s => {
      const ms  = typeof s.ms === 'number' ? `${s.ms}ms` : '';
      const hdr = ms ? `### ${s.label} (${ms})` : `### ${s.label}`;
      return `${hdr}\n\`\`\`\n${(s.output || '').trim()}\n\`\`\``;
    }).join('\n\n');
  }

  // ── Threat intel section ───────────────────────────────────────────────────
  let threatIntel = 'No IP identified.';
  if (ip !== 'unknown') {
    // Look for whois step already in the steps array
    const whoisStep = steps.find(s => s.label && s.label.toLowerCase().includes('whois'));
    if (whoisStep && whoisStep.output) {
      threatIntel = whoisStep.output.trim();
    } else if (whoisData && whoisData.raw) {
      threatIntel = whoisData.raw.trim().slice(0, 400);
    } else {
      threatIntel = `Source IP: ${ip} (no whois data retrieved)`;
    }
  }

  // ── Assessment & Recommended Actions (pattern-based) ──────────────────────
  const allOutput = steps.map(s => (s.output || '')).join('\n').toLowerCase();
  const summary   = (investigation.summary || '').toLowerCase();

  const hasEstablished   = allOutput.includes('established');
  const hasFailed        = allOutput.includes('failed') || allOutput.includes('invalid user');
  const hasRefused       = allOutput.includes('refused') || allOutput.includes('rejected');
  const hasBrute         = summary.includes('brute') || (hasFailed && allOutput.includes('ssh'));
  const openPortCount    = (allOutput.match(/\bopen\b/g) || []).length;
  const hasHighConnCount = /\b([2-9]\d|\d{3,})\s+ESTABLISHED/.test(allOutput) ||
                           /^\s*([2-9]\d|\d{3,})\s+\d/.test(allOutput);

  let assessment = '';
  let recommendations = [];
  let status = 'INCONCLUSIVE';

  if (hasBrute || (hasFailed && hasEstablished)) {
    assessment = `Evidence of brute force or repeated failed authentication from ${ip !== 'unknown' ? ip : 'an unknown source'}. `
      + `Active established connections were detected alongside auth failures, suggesting the attacker may have obtained or is actively attempting credentials. `
      + `Immediate action is warranted.`;
    recommendations = [
      `Block source IP ${ip !== 'unknown' ? ip : '(identify from logs)'} at the firewall`,
      'Review /var/log/auth.log for full scope of login attempts',
      'Rotate credentials for any accounts targeted',
      'Enable fail2ban or equivalent rate-limiting on SSH/RDP',
    ];
    status = 'THREAT CONFIRMED';
  } else if (hasFailed && !hasEstablished) {
    assessment = `Multiple failed authentication attempts detected from ${ip !== 'unknown' ? ip : 'an unknown source'}. `
      + `No active established connections were found, suggesting the attempts have not yet succeeded. `
      + `Monitor closely — escalation to confirmed breach is possible.`;
    recommendations = [
      `Rate-limit or temporarily block ${ip !== 'unknown' ? ip : 'source IP'}`,
      'Check for other IPs showing similar patterns (distributed brute force)',
      'Verify account lockout policies are in effect',
    ];
    status = 'THREAT CONFIRMED';
  } else if (openPortCount > 3) {
    assessment = `Scan identified ${openPortCount} open port references across the host. `
      + `Some of these may represent unexpected or unpatched services. `
      + `Cross-reference against the approved service baseline to identify anomalies.`;
    recommendations = [
      'Audit each open port against the approved service list',
      'Disable or firewall any services not required for operations',
      'Verify service versions are patched',
    ];
    status = 'THREAT CONFIRMED';
  } else if (hasHighConnCount) {
    assessment = `Unusually high connection count detected, which may indicate a DoS attempt, connection flood, or compromised process making excessive outbound connections. `
      + `Further investigation into process ownership of these connections is recommended.`;
    recommendations = [
      'Identify processes behind high connection counts using lsof or ss -tp',
      `If ${ip !== 'unknown' ? ip : 'source'} is responsible, consider rate-limiting at the network level`,
      'Check for zombie or unresponsive processes consuming sockets',
    ];
    status = 'THREAT CONFIRMED';
  } else if (hasEstablished || hasRefused) {
    assessment = `Established or refused connections were observed. No definitive indicators of compromise were found in this scan, `
      + `though activity from ${ip !== 'unknown' ? ip : 'unknown sources'} warrants continued monitoring. `
      + `The threat cannot be ruled out.`;
    recommendations = [
      'Continue monitoring connection logs for escalating activity',
      'Run a follow-up scan in 15 minutes to check for persistence',
      'Review application logs for corresponding request anomalies',
    ];
    status = 'INCONCLUSIVE';
  } else {
    assessment = `No significant indicators of compromise were found in this scan. `
      + `The threat trigger may have been a transient anomaly or false positive. `
      + `Standard monitoring should continue.`;
    recommendations = [
      'Retain this report for baseline comparison',
      'Continue scheduled perimeter patrols',
    ];
    status = 'LIKELY FALSE POSITIVE';
  }

  const recList = recommendations.map(r => `- ${r}`).join('\n');

  return [
    `# Security Investigation Report`,
    `**Date:** ${ts}`,
    `**Threat Category:** ${category}`,
    `**Severity:** ${severity}`,
    `**Source IP:** ${ip}`,
    `**Investigated by:** Bouncer`,
    ``,
    `## Findings`,
    ``,
    findingsSection,
    ``,
    `## Threat Intel`,
    ``,
    threatIntel,
    ``,
    `## Assessment`,
    ``,
    assessment,
    ``,
    `## Recommended Actions`,
    ``,
    recList,
    ``,
    `**Status:** ${status}`,
  ].join('\n');
}

/**
 * Container / NAS patrol — TCP probes only (no WSL). Enabled with BOUNCER_PATROL=container.
 */
async function perimeterPatrolContainer() {
  const start = Date.now();
  const { ws, lm } = getPatrolProbeTargets();
  const [wsServer, lmStudio] = await Promise.all([
    probePort(ws.host, ws.port),
    probePort(lm.host, lm.port),
  ]);
  const elapsed = Date.now() - start;
  const openPorts = [];
  if (wsServer.open) openPorts.push({ port: String(ws.port), service: 'denizen-ws', state: 'open' });
  if (lmStudio.open) openPorts.push({ port: String(lm.port), service: 'lm-studio', state: 'open' });

  return {
    ok: true,
    elapsed,
    openPorts,
    wsServer,
    lmStudio,
    summary: [
      `Container patrol (TCP probes, no WSL nmap)`,
      `WebSocket server (${ws.host}:${ws.port}): ${wsServer.open ? 'UP' : 'DOWN'}`,
      `LM Studio (${lm.host}:${lm.port}): ${lmStudio.open ? 'UP' : 'DOWN'}`,
      `Elapsed: ${elapsed}ms`,
    ].join('\n'),
  };
}

/**
 * Full perimeter check — everything Bouncer does on a patrol cycle.
 * Compares current open ports against the stored baseline and saves a new one.
 * Returns a summary object with all findings and comparison deltas.
 */
async function perimeterPatrol() {
  const patrolMode = String(process.env.BOUNCER_PATROL || '').trim().toLowerCase();
  if (process.platform !== 'win32' && patrolMode === 'container') {
    return perimeterPatrolContainer();
  }
  const start    = Date.now();
  const baseline = loadBaseline();
  const scan     = await baselineScan();

  const { ws, lm } = getPatrolProbeTargets();

  // Quick port probes on Denizen's critical services
  const [wsServer, lmStudio] = await Promise.all([
    probePort(ws.host, ws.port),
    probePort(lm.host, lm.port),
  ]);

  // Auth log check + active connections
  const [authLog, connections] = await Promise.all([
    runCommand(`grep -iE 'failed|refused|invalid|error' /var/log/auth.log 2>/dev/null | tail -10 || journalctl -n 10 --no-pager 2>/dev/null | grep -iE 'fail|auth|refused' || echo "(no auth log)"`)
      .then(r => r.stdout.slice(0, 600)),
    runCommand(`ss -tnp 2>/dev/null | head -20`)
      .then(r => r.stdout.slice(0, 600)),
  ]);

  const elapsed   = Date.now() - start;
  const openPorts = scan.ports.filter(p => p.state === 'open');

  // ── Baseline comparison ────────────────────────────────────────────────────
  const newPorts    = [];
  const closedPorts = [];

  if (baseline && Array.isArray(baseline.openPorts)) {
    const basePortNums = new Set(baseline.openPorts.map(p => String(p.port)));
    const currPortNums = new Set(openPorts.map(p => String(p.port)));

    for (const p of openPorts) {
      if (!basePortNums.has(String(p.port))) {
        newPorts.push(p);
      }
    }
    for (const p of baseline.openPorts) {
      if (!currPortNums.has(String(p.port))) {
        closedPorts.push(p);
      }
    }
  }

  // Save current state as new baseline
  saveBaseline({ openPorts, wsServer, lmStudio });

  // Build comparison summary lines
  const comparisonLines = [];
  if (!baseline) {
    comparisonLines.push('Baseline established — first patrol recorded.');
  } else {
    if (newPorts.length > 0) {
      comparisonLines.push(`NEW PORT DETECTED: ${newPorts.map(p => `${p.port}/${p.service || '?'}`).join(', ')}`);
    }
    if (closedPorts.length > 0) {
      comparisonLines.push(`PORT CLOSED (expected): ${closedPorts.map(p => `${p.port}/${p.service || '?'}`).join(', ')}`);
    }
    if (newPorts.length === 0 && closedPorts.length === 0) {
      comparisonLines.push('Port baseline unchanged.');
    }
  }

  return {
    ok: scan.ok,
    elapsed,
    openPorts,
    wsServer,
    lmStudio,
    authLog,
    connections,
    newPorts,
    closedPorts,
    baselineComparison: comparisonLines.join('\n'),
    summary: [
      `Baseline scan: ${openPorts.length} open port(s) — ${openPorts.map(p => `${p.port}/${p.service}`).join(', ') || 'none'}`,
      `WebSocket server (${ws.port}): ${wsServer.open ? 'UP' : 'DOWN'}`,
      `LM Studio (${lm.host}:${lm.port}): ${lmStudio.open ? 'UP' : 'DOWN'}`,
      ...comparisonLines,
      `Elapsed: ${elapsed}ms`,
    ].join('\n'),
  };
}

module.exports = {
  runCommand,
  investigate,
  extractIp,
  isBouncerPatrolEnabled,
  getPatrolProbeTargets,
  // Structured reporting
  buildReport,
  // Baseline
  loadBaseline,
  saveBaseline,
  // Proactive tools
  baselineScan,
  probePort,
  whoisLookup,
  trafficSnapshot,
  dnsInvestigate,
  checkTshark,
  perimeterPatrol,
  perimeterPatrolContainer,
};
