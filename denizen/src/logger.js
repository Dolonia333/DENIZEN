'use strict';
/**
 * Denizen console logger — clean, colored, timestamped output.
 *
 * Instead of scattered console.log calls producing noise like:
 *   [NpcBrains] Provider cooling down (28s left)
 *   [NpcBrains] Alex think error: LM Studio timeout
 *
 * You get readable lines like:
 *   05:15:33 ✓  Alex      work     "Reviewing auth module..." · 2725→154 tok  1.2s
 *   05:15:34 ⚡  COOLDOWN  lmstudio  10 failures — 30s pause  · queue: 4
 *   05:15:35 ✓  Bouncer   patrol   ws:UP lm:UP · 2 open ports  1.1s
 */

// ── ANSI color codes (supported in Windows Terminal / PowerShell 7) ─────────
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  // Foreground colors
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  gray:    '\x1b[90m',
  // Bright variants
  brightRed:    '\x1b[91m',
  brightGreen:  '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue:   '\x1b[94m',
  brightCyan:   '\x1b[96m',
  brightWhite:  '\x1b[97m',
};

// Disable colors if not a TTY (piped to file etc.)
const USE_COLOR = process.stdout.isTTY !== false;
const c = USE_COLOR ? C : Object.fromEntries(Object.keys(C).map(k => [k, '']));

// ── Helpers ──────────────────────────────────────────────────────────────────

function ts() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${c.gray}${h}:${m}:${s}${c.reset}`;
}

function pad(str, len) {
  return String(str || '').padEnd(len).slice(0, len);
}

function truncate(str, len) {
  const s = String(str || '').replace(/\n/g, ' ').trim();
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Log a completed NPC think cycle.
 *
 * @param {object} opts
 *   npcName   - "Alex"
 *   action    - "work" | "talk" | "idle" | "patrol" etc.
 *   target    - who they talked to (optional)
 *   summary   - short description of what they did
 *   tokIn     - prompt tokens (optional)
 *   tokOut    - completion tokens (optional)
 *   ms        - response time in ms (optional)
 *   artifact  - artifact path written (optional)
 */
function npcAction({ npcName, action, target, summary, tokIn, tokOut, ms, artifact } = {}) {
  const name   = c.brightCyan  + pad(npcName, 9)  + c.reset;
  const act    = c.brightBlue  + pad(action,  8)  + c.reset;
  const tgt    = target ? c.gray + '→ ' + c.yellow + pad(target, 8) + c.reset + ' ' : '          ';
  const msg    = c.white + truncate(summary, 45) + c.reset;

  let tokStr = '';
  if (tokIn != null && tokOut != null) {
    tokStr = c.dim + c.gray + ` ${tokIn}→${tokOut}tok` + c.reset;
  }

  let msStr = '';
  if (ms != null) {
    const secs = (ms / 1000).toFixed(1);
    msStr = c.gray + `  ${secs}s` + c.reset;
  }

  let artStr = '';
  if (artifact) {
    const short = artifact.split(/[\\/]/).slice(-2).join('/');
    artStr = c.dim + c.green + `  [${short}]` + c.reset;
  }

  process.stdout.write(`${ts()} ${c.brightGreen}✓${c.reset}  ${name} ${act} ${tgt}${msg}${tokStr}${msStr}${artStr}\n`);
}

/**
 * Log an NPC error (think failure, timeout, etc.)
 */
function npcError(npcName, reason) {
  const name = c.brightCyan + pad(npcName, 9) + c.reset;
  const msg  = c.red + truncate(reason, 60) + c.reset;
  process.stdout.write(`${ts()} ${c.red}✗${c.reset}  ${name}          ${msg}\n`);
}

/**
 * Log provider / queue health events (cooldown, queue depth, etc.)
 */
function providerHealth({ event, provider, failures, cooldownSec, queueLen, inflight } = {}) {
  const icons = {
    cooldown:  c.brightRed    + '⚡' + c.reset,
    recovery:  c.brightGreen  + '↑' + c.reset,
    queued:    c.yellow       + '⏳' + c.reset,
    throttled: c.yellow       + '⏸' + c.reset,
  };
  const icon = icons[event] || c.yellow + '•' + c.reset;
  const prov = c.magenta + pad(provider || 'lmstudio', 10) + c.reset;

  let detail = '';
  if (event === 'cooldown') {
    detail = c.red + `${failures} failures → ${cooldownSec}s pause` + c.reset;
    if (queueLen > 0) detail += c.gray + `  queue: ${queueLen}` + c.reset;
  } else if (event === 'recovery') {
    detail = c.green + 'provider healthy again' + c.reset;
  } else if (event === 'queued') {
    detail = c.yellow + `queue depth ${queueLen}  inflight ${inflight}` + c.reset;
  } else if (event === 'throttled') {
    detail = c.yellow + `request throttled (cooling down)` + c.reset;
  }

  process.stdout.write(`${ts()} ${icon}  ${c.bold}PROVIDER${c.reset}  ${prov} ${detail}\n`);
}

/**
 * Log LM Studio model sync / load events.
 */
function modelSync({ prev, current, contextLen } = {}) {
  const icon = c.brightBlue + '⟳' + c.reset;
  const name = c.cyan + truncate(current, 35) + c.reset;
  let detail = prev && prev !== current
    ? c.gray + `(was: ${truncate(prev, 25)})` + c.reset
    : '';
  if (contextLen) detail += c.gray + `  ctx: ${contextLen}` + c.reset;
  process.stdout.write(`${ts()} ${icon}  ${c.bold}MODEL${c.reset}     ${name} ${detail}\n`);
}

/**
 * Log a patrol / security event from Bouncer / linux-agent.
 */
function patrol({ openPorts, wsUp, lmUp, elapsed, note } = {}) {
  const icon = c.brightYellow + '🔍' + c.reset;
  const wsStr  = wsUp  ? c.green  + 'ws:UP'  + c.reset : c.red + 'ws:DOWN' + c.reset;
  const lmStr  = lmUp  ? c.green  + 'lm:UP'  + c.reset : c.red + 'lm:DOWN' + c.reset;
  const ports  = openPorts?.length
    ? c.yellow + `${openPorts.length} open port(s)` + c.reset
    : c.gray   + 'no extra ports' + c.reset;
  const ms     = elapsed ? c.gray + `  ${(elapsed/1000).toFixed(1)}s` + c.reset : '';
  const extra  = note ? c.gray + `  ${note}` + c.reset : '';
  process.stdout.write(`${ts()} ${icon}  ${c.bold}PATROL${c.reset}    ${wsStr} ${lmStr} · ${ports}${ms}${extra}\n`);
}

/**
 * Log a threat event.
 */
function threat({ category, severity, source, detail } = {}) {
  const sevColor = { critical: c.brightRed, high: c.red, medium: c.yellow, low: c.gray }[severity] || c.yellow;
  const icon = sevColor + '⚠' + c.reset;
  const cat  = sevColor + c.bold + pad(category, 14) + c.reset;
  const src  = source ? c.cyan + source + c.reset + '  ' : '';
  const msg  = c.white + truncate(detail, 50) + c.reset;
  process.stdout.write(`${ts()} ${icon}  ${c.bold}THREAT${c.reset}    ${cat} ${src}${msg}\n`);
}

/**
 * Generic info / warn / error for anything else.
 */
function info(tag, msg)  { process.stdout.write(`${ts()} ${c.blue}ℹ${c.reset}  ${c.bold}${pad(tag,10)}${c.reset} ${msg}\n`); }
function warn(tag, msg)  { process.stdout.write(`${ts()} ${c.yellow}⚠${c.reset}  ${c.bold}${pad(tag,10)}${c.reset} ${c.yellow}${msg}${c.reset}\n`); }
function error(tag, msg) { process.stdout.write(`${ts()} ${c.red}✗${c.reset}  ${c.bold}${pad(tag,10)}${c.reset} ${c.red}${msg}${c.reset}\n`); }

/**
 * Print a startup banner with key config values.
 */
function banner({ port, parallel, model, npcs } = {}) {
  const line = `${c.bold}${c.brightCyan}${'─'.repeat(60)}${c.reset}`;
  process.stdout.write(`\n${line}\n`);
  process.stdout.write(`  ${c.bold}${c.brightWhite}Denizen${c.reset}  AI office simulator\n`);
  if (port)     process.stdout.write(`  ${c.gray}WebSocket${c.reset}  :${port}\n`);
  if (model)    process.stdout.write(`  ${c.gray}Model    ${c.reset}  ${model}\n`);
  if (parallel) process.stdout.write(`  ${c.gray}Parallel ${c.reset}  ${parallel} concurrent requests\n`);
  if (npcs)     process.stdout.write(`  ${c.gray}NPCs     ${c.reset}  ${npcs} agents loaded\n`);
  process.stdout.write(`${line}\n\n`);
}

module.exports = { npcAction, npcError, providerHealth, modelSync, patrol, threat, info, warn, error, banner };
