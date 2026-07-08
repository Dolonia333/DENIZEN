/**
 * NPC Tools — Level 1/2/3 real work utilities
 *
 * Level 1: Code awareness   — NPCs can read relevant source file snippets
 * Level 2: File outputs     — NPCs write real markdown artifacts to disk
 * Level 3: Real execution   — DevOps/IT/Security run pre-approved commands
 *
 * Nothing here touches user data or runs destructive commands.
 * All paths are validated against PROJECT_ROOT before any I/O.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ── Artifact dedup — prevents NPC report-filing loops ─────────────────────
// Tracks the last artifact written per NPC: { normSummary, writtenAt }
const _recentArtifacts = new Map();
const DEDUP_WINDOW_MS = 4 * 60 * 1000; // 4 minutes

function _isDuplicateArtifact(npcName, taskSummary) {
  const norm = String(taskSummary).toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
  const last = _recentArtifacts.get(npcName);
  if (!last) return false;
  if ((Date.now() - last.writtenAt) > DEDUP_WINDOW_MS) return false;
  // Fuzzy match: first 60 chars must match (catches slightly varied phrasings).
  return last.norm.slice(0, 60) === norm.slice(0, 60);
}

// ── Read whitelist ─────────────────────────────────────────────────────────
// Dirs (relative to PROJECT_ROOT) NPCs may read from.
// Root-level .js files (server.js etc.) are also allowed.
const READABLE_DIRS = ['src', 'data', 'npcs', 'reports', 'research', 'design'];

// ── Write whitelist ────────────────────────────────────────────────────────
// All NPC artifacts land under reports/<category>/ so they can be browsed.
const ARTIFACT_BASE = path.join(PROJECT_ROOT, 'reports');

// ── Which source files each role naturally works with ─────────────────────
const ROLE_CODE_FILES = {
  'CTO':                 ['src/npc-brains.js', 'src/agent-office-manager.js', 'server.js'],
  'Developer':           ['src/agent-office-manager.js', 'src/player-chat.js'],
  'Frontend Developer':  ['src/agent-office-manager.js', 'src/player-chat.js'],
  'Backend Developer':   ['server.js', 'src/npc-brains.js'],
  'QA Engineer':         ['src/agent-office-manager.js', 'src/npc-brains.js'],
  'DevOps Engineer':     ['server.js', 'src/linux-agent.js'],
  'Researcher':          ['src/npc-brains.js', 'data/company-brief.json'],
  'UI/UX Designer':      ['src/agent-office-manager.js', 'data/company-brief.json'],
  'Data Engineer':       ['src/npc-brains.js', 'src/world-state.js'],
  'IT Support':          ['server.js', 'src/linux-agent.js'],
  'Receptionist (also handles CEO email triage as Secretary)':
                         ['src/email-handler.js', 'src/job-application.js'],
  'Security Guard':      ['src/security-monitor.js', 'src/linux-agent.js'],
  'Intern':              ['src/agent-office-manager.js', 'src/npc-brains.js'],
  'Project Manager':     ['data/company-brief.json', 'src/agent-office-manager.js'],
  'Product Manager':     ['data/company-brief.json', 'src/npc-brains.js'],
};

// ── Where each role writes artifacts ─────────────────────────────────────
const ROLE_ARTIFACTS = {
  'CTO':                 { dir: 'leadership',    ext: '.md' },
  'Developer':           { dir: 'code-reviews',  ext: '.md' },
  'Frontend Developer':  { dir: 'code-reviews',  ext: '.md' },
  'Backend Developer':   { dir: 'code-reviews',  ext: '.md' },
  'QA Engineer':         { dir: 'bugs',          ext: '.md' },
  'DevOps Engineer':     { dir: 'devops',        ext: '.md' },
  'Researcher':          { dir: 'research',      ext: '.md' },
  'UI/UX Designer':      { dir: 'design',        ext: '.md' },
  'Data Engineer':       { dir: 'data-reports',  ext: '.md' },
  'IT Support':          { dir: 'it-reports',    ext: '.md' },
  'Receptionist (also handles CEO email triage as Secretary)':
                         { dir: 'admin',         ext: '.md' },
  'Security Guard':      { dir: 'security',      ext: '.md' },
  'Intern':              { dir: 'intern-notes',  ext: '.md' },
  'Project Manager':     { dir: 'pm-reports',    ext: '.md' },
  'Product Manager':     { dir: 'pm-reports',    ext: '.md' },
};

const CONTENT_ARTIFACT_DIRS = {
  'content-trends': 'content-trends',
  'content-pitches': 'content-pitches',
  'content-drafts': 'content-drafts',
  'content-edits': 'content-edits',
  'content-design': 'content-design',
  'content-legal': 'content-legal',
  'content-published': 'content-published',
};

// ── Level 3: pre-approved read-only shell commands ────────────────────────
// Each value is a function that returns the command string.
// Only commandKeys listed here can ever be executed.
const isWin = process.platform === 'win32';

const SAFE_COMMANDS = {
  server_health:    ()     => `curl -s --max-time 3 http://localhost:8080/health`,
  npc_status:       ()     => `curl -s --max-time 3 http://localhost:8080/api/agents`,
  lm_studio_ping:   ()     => `curl -s --max-time 3 http://localhost:1234/v1/models`,
  lm_studio_models: ()     => `curl -s --max-time 3 http://localhost:1234/v1/models`,
  node_version:     ()     => `node --version`,
  check_syntax:     (file) => `node --check "${path.join(PROJECT_ROOT, file)}"`,
  recent_logs:      ()     => isWin
    ? `powershell -Command "Get-Content '${path.join(PROJECT_ROOT, 'server.log')}' -Tail 20 -ErrorAction SilentlyContinue"`
    : `tail -20 "${path.join(PROJECT_ROOT, 'server.log')}" 2>/dev/null || echo "(no log file)"`,
  disk_usage:       ()     => isWin
    ? `powershell -Command "Get-PSDrive C | Select-Object -ExpandProperty Used | ForEach-Object { [math]::Round($_ / 1GB, 1).ToString() + 'GB used' }"`
    : `df -h . 2>/dev/null | tail -1`,
  process_list:     ()     => isWin
    ? `tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH 2>nul & tasklist /FI "IMAGENAME eq lms.exe" /FO CSV /NH 2>nul`
    : `ps aux --no-headers 2>/dev/null | grep -E "node|lm.?studio" | head -5 || echo "(no ps)"`,
};

// ── Roles that get live infra context injected ────────────────────────────
const INFRA_ROLES = new Set(['DevOps Engineer', 'IT Support', 'Security Guard']);

// ── Role → commands that make sense for that role ────────────────────────
const ROLE_COMMANDS = {
  'DevOps Engineer': ['server_health', 'disk_usage', 'process_list'],
  'IT Support':      ['server_health', 'lm_studio_ping', 'node_version', 'lm_studio_models'],
  'Security Guard':  ['server_health', 'process_list'],
};

// ──────────────────────────────────────────────────────────────────────────
//  Level 1: Read project file snippet
// ──────────────────────────────────────────────────────────────────────────

/**
 * Safely read a snippet from a project file.
 * Returns null if the path is outside PROJECT_ROOT or an unreadable dir.
 *
 * @param {string} relPath  - path relative to PROJECT_ROOT, e.g. 'src/npc-brains.js'
 * @param {number} maxLines - max lines to return (default 50)
 * @returns {{ path, totalLines, startLine, snippet } | null}
 */
function readProjectFile(relPath, maxLines = 50) {
  try {
    const resolved = path.resolve(PROJECT_ROOT, relPath);

    // Security: must stay inside project root
    if (!resolved.startsWith(PROJECT_ROOT + path.sep) &&
        resolved !== PROJECT_ROOT) return null;

    const rel = path.relative(PROJECT_ROOT, resolved);

    // Allow root-level .js files (server.js etc.) and whitelisted dirs
    const segments = rel.split(path.sep);
    const isRootFile = segments.length === 1;
    if (!isRootFile && !READABLE_DIRS.includes(segments[0])) return null;

    if (!fs.existsSync(resolved)) return null;
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return null;

    const content = fs.readFileSync(resolved, 'utf8');
    const lines   = content.split('\n');
    const total   = lines.length;

    // For big files take a slice from 20% in so we skip the boilerplate
    // require/imports at the top and get to the interesting logic faster.
    const startLine = total > maxLines ? Math.floor(total * 0.20) : 0;
    const snippet   = lines.slice(startLine, startLine + maxLines).join('\n');

    return { path: relPath, totalLines: total, startLine: startLine + 1, snippet };
  } catch (_) {
    return null;
  }
}

/**
 * Build a compact code-context block for a given role.
 * Picks one relevant file at random (so NPCs rotate through their files),
 * reads a snippet, and formats it for injection into the system prompt.
 *
 * @param {string} role - the NPC's role string (must match ROLE_CODE_FILES key)
 * @returns {string|null}
 */
function getCodeContext(role) {
  const files = ROLE_CODE_FILES[role];
  if (!files || files.length === 0) return null;

  // Pick a random file from the role's list
  const relPath = files[Math.floor(Math.random() * files.length)];
  const result  = readProjectFile(relPath, 45);
  if (!result) return null;

  return (
    `File: ${result.path} (${result.totalLines} lines total, showing from line ${result.startLine})\n` +
    '```\n' + result.snippet + '\n```'
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Level 2: Write artifact
// ──────────────────────────────────────────────────────────────────────────

/**
 * Write a markdown artifact to reports/<category>/<filename>.
 * Creates the directory if needed. Returns the relative path written,
 * or null on failure.
 *
 * @param {string} npcName   - name of the NPC writing the artifact
 * @param {string} category  - subdirectory under reports/ (e.g. 'bugs')
 * @param {string} filename  - base filename (will be sanitized)
 * @param {string} content   - markdown body (added after a generated header)
 * @returns {string|null}
 */
function writeArtifact(npcName, category, filename, content) {
  try {
    // Validate category (must be a single path segment, no traversal)
    if (!category || category.includes('/') || category.includes('\\') ||
        category.includes('..')) return null;

    const dir = path.join(ARTIFACT_BASE, category);
    fs.mkdirSync(dir, { recursive: true });

    // Sanitize filename: letters, digits, hyphens, underscores, dots only
    const safe = (filename || 'note')
      .replace(/[^a-zA-Z0-9_\-\.]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 80);
    const finalName = safe.endsWith('.md') ? safe : safe + '.md';
    const filePath  = path.join(dir, finalName);

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const header = [
      `# ${finalName.replace('.md', '').replace(/_/g, ' ')}`,
      ``,
      `**Author:** ${npcName}  `,
      `**Timestamp:** ${timestamp}  `,
      `**Category:** ${category}`,
      ``,
      `---`,
      ``,
    ].join('\n');

    fs.writeFileSync(filePath, header + (content || ''), 'utf8');
    return path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');
  } catch (_) {
    return null;
  }
}

/**
 * Auto-write an artifact when an NPC finishes a task.
 * Uses the NPC's role to determine the output directory.
 * Returns the artifact path or null.
 *
 * @param {string} npcName - NPC's name
 * @param {string} role    - NPC's role string
 * @param {string} taskSummary - what the NPC finished (from decision.save)
 * @param {string} [detail]    - optional extra detail
 * @param {object} [opts]      - optional rich context: { reasoning, thought, outcome, action, target, codeFile }
 * @returns {string|null}
 */
function writeTaskArtifact(npcName, role, taskSummary, detail, opts) {
  const categoryOverride = opts?.artifactCategory && CONTENT_ARTIFACT_DIRS[opts.artifactCategory]
    ? CONTENT_ARTIFACT_DIRS[opts.artifactCategory]
    : (opts?.artifactCategory || null);
  const cfg = categoryOverride
    ? { dir: categoryOverride, ext: '.md' }
    : ROLE_ARTIFACTS[role];
  if (!cfg) return null;

  // Dedup guard: suppress identical reports filed within the cooldown window.
  // This breaks the "blocked → re-report same thing → still blocked" loop.
  if (_isDuplicateArtifact(npcName, taskSummary)) return null;

  const slug = (taskSummary || 'task')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 50);
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename  = `${npcName.toLowerCase()}_${slug}_${dateStamp}`;

  const body = [
    `## Summary`,
    ``,
    taskSummary || '(no summary)',
    ``,
    opts && opts.reasoning ? `## Reasoning\n\n${opts.reasoning}\n` : '',
    opts && opts.thought ? `## Internal Thought\n\n> ${opts.thought}\n` : '',
    detail ? `## Context\n\n${detail}\n` : '',
    opts && opts.outcome && opts.outcome !== 'null' ? `## Outcome\n\n**${opts.outcome.toUpperCase()}**\n` : '',
    opts && opts.codeFile ? `## Code Referenced\n\n\`${opts.codeFile}\`\n` : '',
    `## Status`,
    ``,
    `Completed by ${npcName} (${role})`,
    opts && opts.target ? `Reported to: ${opts.target}` : '',
  ].filter(Boolean).join('\n');

  const result = writeArtifact(npcName, cfg.dir, filename, body);
  if (result) {
    const norm = String(taskSummary).toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
    _recentArtifacts.set(npcName, { norm, writtenAt: Date.now() });
  }
  return result;
}

// ──────────────────────────────────────────────────────────────────────────
//  Level 3: Run safe command
// ──────────────────────────────────────────────────────────────────────────

/**
 * Run a pre-approved command and return trimmed stdout (max 400 chars).
 * commandKey must be a key in SAFE_COMMANDS; anything else returns null.
 *
 * @param {string}  commandKey
 * @param {string}  [arg]       - optional argument (e.g. filename for check_syntax)
 * @returns {Promise<string|null>}
 */
function runSafeCommand(commandKey, arg) {
  const cmdFn = SAFE_COMMANDS[commandKey];
  if (!cmdFn) return Promise.resolve(null);

  const cmd = cmdFn(arg);

  return new Promise((resolve) => {
    exec(cmd, { timeout: 5000, maxBuffer: 16384, shell: true, windowsHide: true }, (err, stdout, stderr) => {
      const out = (stdout || '').trim();
      if (out) return resolve(out.slice(0, 400));
      if (err)  return resolve('(error: ' + String(err.message).slice(0, 80) + ')');
      return resolve('(no output)');
    });
  });
}

/**
 * Get the most recent patrol result stored in world-state by the patrol loop.
 * This gives Bouncer's think prompt real nmap data from the last scheduled scan.
 */
function getLastPatrolContext() {
  try {
    const ws = require('./world-state');
    const p = ws && ws.bouncerPatrol;
    if (!p) return null;
    const age = Math.round((Date.now() - p.ts) / 1000);
    const ageStr = age < 120 ? `${age}s ago` : `${Math.round(age / 60)}m ago`;
    return [
      `Last patrol: ${ageStr}`,
      p.summary,
      p.openPorts && p.openPorts.length > 0
        ? `Open ports: ${p.openPorts.map(pt => `${pt.port}/${pt.service}`).join(', ')}`
        : 'No unexpected open ports',
    ].join('\n');
  } catch (_) { return null; }
}

/**
 * Try to pull recent security events from the server-side security monitor.
 * Returns a formatted string of recent events, or null if unavailable.
 *
 * @returns {string|null}
 */
function getSecurityContext() {
  try {
    const monitor = require('./security-monitor');
    if (typeof monitor.getRecentEvents === 'function') {
      const events = monitor.getRecentEvents(5);
      if (events && events.length > 0) {
        return events.map(e => `- [${e.type || 'event'}] ${e.message || e.summary || JSON.stringify(e).slice(0, 80)}`).join('\n');
      }
    }
    if (typeof monitor.getStatus === 'function') {
      const status = monitor.getStatus();
      return `Status: ${JSON.stringify(status).slice(0, 200)}`;
    }
  } catch (_) {}
  return null;
}

/**
 * Build a live infra context block for DevOps / IT / Security NPCs.
 * Runs 1-2 pre-approved commands and formats the output.
 *
 * @param {string} role - NPC's role
 * @returns {Promise<string|null>}
 */
async function getLiveInfraContext(role) {
  // Security Guard gets real Kali tools via linux-agent, not just curl
  if (role === 'Security Guard') {
    return await _getSecurityGuardContext();
  }

  const cmds = ROLE_COMMANDS[role];
  if (!cmds || cmds.length === 0) return null;

  // Run first command always; second one 50% of cycles to stay fast
  const toRun = cmds.slice(0, Math.random() > 0.5 ? 2 : 1);
  const results = [];

  for (const key of toRun) {
    const out = await runSafeCommand(key);
    if (out) results.push(`$ ${key}: ${out}`);
  }

  return results.length > 0 ? results.join('\n') : null;
}

/**
 * Security Guard gets real Kali Linux context — rotates between tool outputs
 * each cycle so Bouncer always has fresh intel to reason about.
 */
// Hard cap on total security context injected into Bouncer's prompt.
// Bouncer was hitting 4000+ tokens (4096 context limit) because patrol
// output was unbounded. Keeping this tight prevents KV cache OOM crashes.
const BOUNCER_CTX_MAX_CHARS = 500;

async function _getSecurityGuardContext() {
  let linuxAgent = null;
  try { linuxAgent = require('./linux-agent'); } catch (_) {}

  const parts = [];

  // Security events first (most actionable, shortest)
  const secCtx = getSecurityContext();
  if (secCtx) parts.push(`Events:\n${secCtx.slice(0, 150)}`);

  if (!linuxAgent) {
    const patrolCtx = getLastPatrolContext();
    if (patrolCtx) parts.push(patrolCtx.split('\n').slice(0, 3).join('\n'));
    const result = parts.join('\n').slice(0, BOUNCER_CTX_MAX_CHARS);
    return result || null;
  }

  // Rotate through tool types each cycle — pick ONE source, not multiple
  const roll = Math.random();

  if (roll < 0.35) {
    // 35% — use the cached patrol result (no live command, fast, cheap)
    const patrolCtx = getLastPatrolContext();
    if (patrolCtx) parts.push(patrolCtx.split('\n').slice(0, 4).join('\n'));

  } else if (roll < 0.60) {
    // 25% — quick port probes (2 nc calls, very fast)
    try {
      const [ws, lm] = await Promise.all([
        linuxAgent.probePort('localhost', 8080),
        linuxAgent.probePort('localhost', 1234),
      ]);
      parts.push(`Port check: ws:8080 ${ws.open ? 'UP' : 'DOWN'} · lm:1234 ${lm.open ? 'UP' : 'DOWN'}`);
    } catch (_) {}

  } else if (roll < 0.80) {
    // 20% — nmap open ports summary only (no version details)
    try {
      const scan = await linuxAgent.baselineScan();
      const open = scan.ports.filter(p => p.state === 'open');
      parts.push(`nmap: ${open.length > 0
        ? open.map(p => `${p.port}/${p.service}`).join(', ')
        : 'no unexpected ports'}`);
    } catch (_) {}

  } else {
    // 20% — active connection count only (not full ss output)
    try {
      const r = await linuxAgent.runCommand(`ss -tnp 2>/dev/null | grep ESTAB | wc -l`);
      const count = (r.stdout || '0').trim();
      parts.push(`Active connections: ${count}`);
    } catch (_) {}
  }

  // Hard cap — never let security context push Bouncer over token budget
  const result = parts.join('\n').slice(0, BOUNCER_CTX_MAX_CHARS);
  return result || null;
}

function initArtifactDirs() {
  const dirs = [...new Set(Object.values(ROLE_ARTIFACTS).map(a => a.dir))];
  dirs.forEach(dir => {
    try { fs.mkdirSync(path.join(ARTIFACT_BASE, dir), { recursive: true }); } catch (_) {}
  });
}
initArtifactDirs();

module.exports = {
  // Level 1
  readProjectFile,
  getCodeContext,
  ROLE_CODE_FILES,
  // Level 2
  writeArtifact,
  writeTaskArtifact,
  initArtifactDirs,
  ROLE_ARTIFACTS,
  // Level 3
  runSafeCommand,
  getLiveInfraContext,
  getSecurityContext,
  getLastPatrolContext,
  INFRA_ROLES,
  SAFE_COMMANDS,
};
