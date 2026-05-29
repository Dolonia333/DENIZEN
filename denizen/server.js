const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const SecurityMonitorServer = require('./security-monitor-server');
const CofounderAgent = require('./src/cofounder-agent');
const NpcBrainManager = require('./src/npc-brains');
const worldState = require('./src/world-state');
const agentBus = require('./src/agent-bus');
const ExternalSink = require('./src/external-sink');
const elevenLabs = require('./src/elevenlabs-tts');
const animationForge = require('./src/animation-forge');
const soulReflection = require('./src/soul-reflection');
const npcRoster = require('./src/npc-roster');
const capabilityProposal = require('./src/capability-proposal');
const emailHandler = require('./src/email-handler');
const gmailClient = require('./src/gmail-client');
const llmTelemetry = require('./src/llm-telemetry');
const pcActivity = require('./src/pc-activity-tracker');
const jobApplication = require('./src/job-application');
const desktopAgent = require('./src/desktop-agent');
const linuxAgent = require('./src/linux-agent');
const npcTools         = require('./src/npc-tools');
const log              = require('./src/logger');
const codingTaskRunner = require('./src/coding-task-runner');
const taskChain        = require('./src/task-chain');
const robinhoodMcp     = require('./src/robinhood-mcp');
const conflictDetector = require('./src/conflict-detector');

// Voice map (per-NPC ElevenLabs voice IDs). Loaded once at startup;
// edit data/voice-map.json + restart to change. Missing file → empty map
// → every NPC uses the default voice.
let _voiceMap = { default: {}, npcs: {} };
try {
  _voiceMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'voice-map.json'), 'utf8'));
} catch (_) { /* optional */ }

const PORT = process.env.PORT || 8080;
const STT_MAX_AUDIO_BYTES = 12 * 1024 * 1024; // 12MB hard cap

function _resolveSttConfig() {
  const apiKey = process.env.OPENAI_WHISPER_API_KEY || process.env.OPENAI_API_KEY || '';
  const model = process.env.OPENAI_WHISPER_MODEL || 'whisper-1';
  const baseUrl = (process.env.OPENAI_WHISPER_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const source = process.env.OPENAI_WHISPER_API_KEY
    ? 'OPENAI_WHISPER_API_KEY'
    : (process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY' : null);
  return {
    configured: !!apiKey,
    apiKey,
    model,
    baseUrl,
    source,
  };
}

function _readJsonBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error(`payload too large (>${limitBytes} bytes)`));
        try { req.destroy(); } catch (_) {}
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error(`invalid JSON: ${err.message}`));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

function _buildMultipartForm(parts) {
  const boundary = `----denizen-${crypto.randomBytes(12).toString('hex')}`;
  const bodyParts = [];

  for (const part of parts) {
    const header = [];
    header.push(`--${boundary}`);
    if (part.filename) {
      header.push(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"`);
      header.push(`Content-Type: ${part.contentType || 'application/octet-stream'}`);
      bodyParts.push(Buffer.from(`${header.join('\r\n')}\r\n\r\n`, 'utf8'));
      bodyParts.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(String(part.value || ''), 'utf8'));
      bodyParts.push(Buffer.from('\r\n', 'utf8'));
    } else {
      header.push(`Content-Disposition: form-data; name="${part.name}"`);
      bodyParts.push(Buffer.from(`${header.join('\r\n')}\r\n\r\n${String(part.value || '')}\r\n`, 'utf8'));
    }
  }

  bodyParts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    boundary,
    body: Buffer.concat(bodyParts),
  };
}

// Prevent unhandled errors from crashing the server
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception (kept alive):', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[Server] Unhandled rejection (kept alive):', err?.message || err);
});
// Serve from the project directory — all assets are now in assets/
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

const OPENCLAW_HOST = '127.0.0.1';
const OPENCLAW_PORT = 18792;

// --- Security Monitor ---
const securityMonitor = new SecurityMonitorServer({
  watchDirs: [
    path.resolve(__dirname),  // watch the game directory
  ],
  failedLoginThreshold: 3,
  portScanThreshold: 10,
  apiRateLimit: 100,
});
// Mirror threat events into the live WorldState so NPC brains and the UI
// share a single source of truth for "what's currently bad in the office".
if (typeof securityMonitor.setWorldState === 'function') {
  securityMonitor.setWorldState(worldState);
}
securityMonitor.start();

// --- Cofounder Agent (CTO AI brain) ---
const npcBrains = new NpcBrainManager();
const cofounderAgent = new CofounderAgent();
cofounderAgent.npcBrains = npcBrains; // Give the director access to individual NPC brains

// Wire broadcast into npc-brains so task-chain advancement can send WS events
npcBrains.setBroadcast((msg) =>
  (agentWss ? agentWss.clients : new Set()).forEach(c => {
    if (c.readyState === 1) c.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  })
);

// Same broadcaster, wired into the PC activity tracker. Every started /
// done / failed PC task fans out to the browser as `pc_activity` events
// so the telemetry panel's "PC activity" section refreshes instantly
// without polling.
pcActivity.setBroadcast((msg) =>
  (agentWss ? agentWss.clients : new Set()).forEach(c => {
    if (c.readyState === 1) c.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  })
);

// --- OpenClaw Skill Bridge ---
const OPENCLAW_ROOT = 'C:/Users/zionv/OneDrive/Desktop/multbot/openclaw';
const SKILL_SCRIPTS = {
  'job-scraper':      `${OPENCLAW_ROOT}/skills/job-scraper/job-scraper.mjs`,
  'job-applier':      `${OPENCLAW_ROOT}/skills/job-applier/job-applier.mjs`,
  'resume-generator': `${OPENCLAW_ROOT}/skills/resume-generator/resume-generator.mjs`,
  'pdf-generator':    `${OPENCLAW_ROOT}/skills/pdf-generator/pdf-generator.mjs`,
  'browserclaw':      `${OPENCLAW_ROOT}/skills/browserclaw/browserclaw.mjs`,
  'canvas-render':    `${OPENCLAW_ROOT}/skills/canvas-render/canvas-render.mjs`,
  'lm-studio':        `${OPENCLAW_ROOT}/skills/lm-studio/lm-studio.mjs`,
  'supabase-bridge':  `${OPENCLAW_ROOT}/skills/supabase-bridge/supabase-bridge.mjs`,
};
const GITHUB_REPO = 'Dolonia333/DENIZEN';

/**
 * Run an OpenClaw skill on behalf of an NPC. Fires async; result is injected
 * back into the NPC's next think() cycle via npcBrains.injectSkillResult().
 */
async function runNpcSkill(npcName, skill, skillParams = {}) {
  const { exec } = require('child_process');
  const TIMEOUT_MS = 30000;

  const broadcast = (m) => {
    const raw = JSON.stringify(m);
    (agentWss ? agentWss.clients : new Set()).forEach(c => { if (c.readyState === 1) c.send(raw); });
  };

  log.info('SkillBridge', `${npcName} → ${skill} ${JSON.stringify(skillParams)}`);
  broadcast({ type: 'npc_skill_start', npcName, skill, skillParams, ts: Date.now() });

  // Special case: Lucy running job-scraper or job-applier triggers the full pipeline.
  // This integrates the multi-step pipeline instead of raw CLI passthrough.
  if (npcName === 'Lucy' && (skill === 'job-scraper' || skill === 'job-applier')) {
    log.info('SkillBridge', `Lucy → job pipeline via ${skill}`);
    broadcast({ type: 'npc_skill_start', npcName, skill: 'job-pipeline', skillParams, ts: Date.now() });
    // PC activity tracker: this is a real PC task (browser + LLMs). Mode
    // is 'visible' because runJobPipeline → applyByWebForm opens a real
    // Chromium window the user can watch.
    const activity = pcActivity.record({
      npc: npcName, kind: 'job-pipeline',
      task: `${skillParams.query || skillParams.q || 'job search'} on ${skillParams.site || 'linkedin'}`,
      mode: 'visible', status: 'started',
    });
    const pipelineStart = Date.now();
    jobApplication.runJobPipeline({
      query:     skillParams.query     || skillParams.q    || 'software engineer',
      site:      skillParams.site      || 'linkedin',
      pages:     Number(skillParams.pages || 2),
      remoteOnly: Boolean(skillParams.remoteOnly || skillParams['remote-only']),
      minSalary: Number(skillParams.minSalary || 0),
    }).then(summary => {
      pcActivity.record({
        id: activity.id, npc: npcName, kind: 'job-pipeline',
        task: activity.task, mode: 'visible', status: 'done',
        durationMs: Date.now() - pipelineStart, detail: String(summary).slice(0, 240),
      });
      npcBrains.injectSkillResult(npcName, 'job-pipeline', summary);
      broadcast({ type: 'npc_skill_result', npcName, skill: 'job-pipeline', ok: true, output: summary.slice(0, 200), ts: Date.now() });
      broadcast({ type: 'lucy_job_pipeline_done', summary });
      log.info('SkillBridge', `Lucy ← job-pipeline: ${summary.slice(0, 80)}`);
    }).catch(err => {
      pcActivity.record({
        id: activity.id, npc: npcName, kind: 'job-pipeline',
        task: activity.task, mode: 'visible', status: 'failed',
        durationMs: Date.now() - pipelineStart, detail: String(err?.message || err).slice(0, 240),
      });
      const output = `Job pipeline failed: ${err?.message || err}`;
      npcBrains.injectSkillResult(npcName, 'job-pipeline', output);
      broadcast({ type: 'npc_skill_result', npcName, skill: 'job-pipeline', ok: false, output, ts: Date.now() });
    });
    return Promise.resolve({ ok: true, output: 'Lucy job pipeline started', skill: 'job-pipeline', npcName });
  }

  // --- market-watch: Roki runs a market observation cycle via Robinhood MCP ---
  if (skill === 'market-watch' || skill === 'get-quote') {
    const marketStart = Date.now();
    const activity = pcActivity.record({
      npc: npcName, kind: 'market-watch',
      task: skill === 'get-quote'
        ? `quote: ${(skillParams?.symbols || []).join(',')||'watchlist'}`
        : 'market observation cycle',
      mode: 'background', status: 'started',
    });

    const doMarket = skill === 'get-quote'
      ? () => robinhoodMcp.getQuote(skillParams?.symbols || robinhoodMcp.loadWatchlist())
      : () => robinhoodMcp.runMarketObservation();

    doMarket().then(result => {
      const output = JSON.stringify(result).slice(0, 1200);
      pcActivity.record({
        id: activity.id, npc: npcName, kind: 'market-watch',
        task: activity.task, mode: 'background', status: 'done',
        durationMs: Date.now() - marketStart, detail: output.slice(0, 240),
      });
      npcBrains.injectSkillResult(npcName, skill, output);
      broadcast({ type: 'npc_skill_result', npcName, skill, ok: true, output: output.slice(0, 400), ts: Date.now() });
      broadcast({ type: 'market_data_update', npcName, data: result, ts: Date.now() });
      log.info('Market', `${npcName} ← ${skill}: ${output.slice(0, 80)}`);
    }).catch(err => {
      const output = `Market data unavailable: ${err.message}`;
      pcActivity.record({
        id: activity.id, npc: npcName, kind: 'market-watch',
        task: activity.task, mode: 'background', status: 'failed',
        durationMs: Date.now() - marketStart, detail: output,
      });
      npcBrains.injectSkillResult(npcName, skill, output);
      broadcast({ type: 'npc_skill_result', npcName, skill, ok: false, output, ts: Date.now() });
      log.warn('Market', `${npcName} market-watch failed: ${err.message}`);
    });
    return Promise.resolve({ ok: true, output: 'Market observation started', skill, npcName });
  }

  // --- trade-suggest: Roki records a trade suggestion (NEVER executes) ---
  if (skill === 'trade-suggest') {
    // Safety: reject if skillParams somehow contain an 'execute' flag
    if (skillParams?.execute === true || skillParams?.placeOrder === true) {
      const msg = 'BLOCKED: Denizen does not execute trades automatically. This is a safety constraint.';
      log.warn('Market', msg);
      npcBrains.injectSkillResult(npcName, skill, msg);
      broadcast({ type: 'npc_skill_result', npcName, skill, ok: false, output: msg, ts: Date.now() });
      return Promise.resolve({ ok: false, output: msg, skill, npcName });
    }

    const suggestion = robinhoodMcp.createSuggestion({
      npc: npcName,
      symbol: skillParams?.symbol,
      action: skillParams?.tradeAction || skillParams?.action || 'watch',
      quantity: skillParams?.quantity || null,
      rationale: skillParams?.rationale || '',
      currentPrice: skillParams?.currentPrice || null,
      targetPrice: skillParams?.targetPrice || null,
    });
    const output = `Trade suggestion recorded: ${suggestion.action?.toUpperCase()} ${suggestion.symbol} — ${suggestion.rationale.slice(0, 80)}`;
    npcBrains.injectSkillResult(npcName, skill, output);
    broadcast({ type: 'npc_skill_result', npcName, skill, ok: true, output, ts: Date.now() });
    broadcast({ type: 'trade_suggestion', suggestion, ts: Date.now() });
    log.info('Market', `${npcName} trade suggestion: ${output}`);
    return Promise.resolve({ ok: true, output, skill, npcName, suggestion });
  }

  // --- coding-agent: run Claude Code in an isolated worktree ---
  if (skill === 'coding-agent') {
    const { targetFiles, task: skillTask } = skillParams || {};
    const taskDesc = skillTask || `NPC ${npcName} coding task`;
    // PC activity tracker: Claude Code runs in a worktree on disk;
    // it touches files and runs `git` / `npm` — definitely a PC task.
    // Background by default since the user doesn't see it directly.
    const activity = pcActivity.record({
      npc: npcName, kind: 'coding-agent',
      task: taskDesc, mode: 'background', status: 'started',
      detail: Array.isArray(targetFiles) && targetFiles.length ? `files: ${targetFiles.join(', ').slice(0, 200)}` : null,
    });
    const codingStart = Date.now();
    return codingTaskRunner.runCodingTask({
      npc: npcName,
      task: taskDesc,
      targetFiles: Array.isArray(targetFiles) ? targetFiles : [],
      skillParams,
      broadcast: (msg) => {
        const raw = JSON.stringify(msg);
        (agentWss ? agentWss.clients : new Set()).forEach(c => { if (c.readyState === 1) c.send(raw); });
      },
    }).then(result => {
      const output = result.ok ? JSON.stringify(result) : `Error: ${result.error}`;
      pcActivity.record({
        id: activity.id, npc: npcName, kind: 'coding-agent',
        task: taskDesc, mode: 'background',
        status: result.ok ? 'done' : 'failed',
        durationMs: Date.now() - codingStart,
        detail: String(output).slice(0, 240),
      });
      npcBrains.injectSkillResult(npcName, skill, output);
      broadcast({ type: 'npc_skill_result', npcName, skill, ok: result.ok, output: output.slice(0, 200), ts: Date.now() });
      return result.ok ? JSON.stringify(result) : `Error: ${result.error}`;
    });
  }

  // PC activity tracker: this is a generic skill exec — a real child
  // process. Mode is background; skills don't render their own UI.
  const skillTaskDesc = skillParams?.task || skillParams?.query || skill;
  const activity = pcActivity.record({
    npc: npcName, kind: 'skill', skill,
    task: String(skillTaskDesc).slice(0, 240),
    mode: skillParams?.mode === 'visible' ? 'visible' : 'background',
    status: 'started',
  });
  const skillStart = Date.now();

  return new Promise((resolve) => {
    let cmd;

    if (skill === 'github') {
      // Build gh CLI command from skillParams
      const action = skillParams.action || 'pr-list';
      const repo = skillParams.repo || GITHUB_REPO;
      if (action === 'pr-list') {
        cmd = `gh pr list --repo ${repo}`;
      } else if (action === 'run-list') {
        const limit = skillParams.limit || 5;
        cmd = `gh run list --repo ${repo} --limit ${limit}`;
      } else if (action === 'issue-list') {
        cmd = `gh issue list --repo ${repo}`;
      } else {
        // Generic: treat action as the gh sub-command
        cmd = `gh ${action} --repo ${repo}`;
      }
    } else if (SKILL_SCRIPTS[skill]) {
      // Convert skillParams object to CLI args: {site: 'linkedin'} → '--site linkedin'
      const args = Object.entries(skillParams)
        .map(([k, v]) => `--${k} ${String(v).replace(/"/g, '\\"')}`)
        .join(' ');
      cmd = `node "${SKILL_SCRIPTS[skill]}"${args ? ' ' + args : ''}`;
    } else {
      const result = { ok: false, output: `Unknown skill: ${skill}`, skill, npcName };
      pcActivity.record({
        id: activity.id, npc: npcName, kind: 'skill', skill,
        task: activity.task, mode: activity.mode, status: 'failed',
        durationMs: Date.now() - skillStart, detail: `Unknown skill: ${skill}`,
      });
      broadcast({ type: 'npc_skill_result', ...result, ts: Date.now() });
      resolve(result);
      return;
    }

    const child = exec(cmd, { windowsHide: true, timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
      const output = (stdout || stderr || (err ? err.message : 'no output')).slice(0, 800);
      const ok = !err;
      const result = { ok, output, skill, npcName };
      pcActivity.record({
        id: activity.id, npc: npcName, kind: 'skill', skill,
        task: activity.task, mode: activity.mode,
        status: ok ? 'done' : 'failed',
        durationMs: Date.now() - skillStart,
        detail: output.slice(0, 240),
      });
      npcBrains.injectSkillResult(npcName, skill, output);
      broadcast({ type: 'npc_skill_result', npcName, skill, ok, output: output.slice(0, 200), ts: Date.now() });
      log.info('SkillBridge', `${npcName} ← ${skill} (${ok ? 'ok' : 'err'}): ${output.slice(0, 80)}`);
      resolve(result);
    });
    // Safety: kill child if it somehow outlives the timeout
    setTimeout(() => { try { child.kill(); } catch (_) {} }, TIMEOUT_MS + 2000);
  });
}

// --- Furniture-placement whitelist + per-NPC daily budget ---
// The whitelist is shared between /api/place-furniture and the prompt
// hint in src/npc-brains.js. Edit both together if you ever expand it.
// Daily budget keeps a chatty NPC from spamming the office with couches.
const ALLOWED_PREFABS = new Set([
  'desk_small', 'desk_2x2', 'office_chair', 'monitor',
  'plant_small', 'plant_large', 'whiteboard', 'bookshelf',
  'coffee_machine', 'water_cooler', 'couch', 'rug',
  'standing_desk', 'phone_booth', 'meeting_table',
]);
const PLACEMENT_BUDGET_PER_DAY = 3;
const _placementBudget = new Map(); // key: "<by>|<YYYY-MM-DD>" → count
function _budgetKey(by) {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${by}|${ymd}`;
}
function _checkPlacementBudget(by) {
  if (by === 'system' || by === 'operator') return { allowed: true, placedToday: 0, cap: Infinity };
  const k = _budgetKey(by);
  const placedToday = _placementBudget.get(k) || 0;
  return {
    allowed: placedToday < PLACEMENT_BUDGET_PER_DAY,
    placedToday,
    cap: PLACEMENT_BUDGET_PER_DAY,
  };
}
function _consumePlacementBudget(by) {
  if (by === 'system' || by === 'operator') return;
  const k = _budgetKey(by);
  _placementBudget.set(k, (_placementBudget.get(k) || 0) + 1);
}

// --- Per-NPC daily animation request budget ---
// Same shape as the placement budget, lower cap. Animation requests are
// heavier review work for the operator (each one might trigger image-
// generation cost) so we want NPCs to be picky about asking.
const ANIMATION_BUDGET_PER_DAY = 2;
const _animationBudget = new Map(); // key: "<by>|<YYYY-MM-DD>" → count
function _checkAnimationBudget(by) {
  if (by === 'system' || by === 'operator') return { allowed: true, requestedToday: 0, cap: Infinity };
  const k = _budgetKey(by);
  const requestedToday = _animationBudget.get(k) || 0;
  return {
    allowed: requestedToday < ANIMATION_BUDGET_PER_DAY,
    requestedToday,
    cap: ANIMATION_BUDGET_PER_DAY,
  };
}
function _consumeAnimationBudget(by) {
  if (by === 'system' || by === 'operator') return;
  const k = _budgetKey(by);
  _animationBudget.set(k, (_animationBudget.get(k) || 0) + 1);
}

// --- Per-NPC daily capability-request budget (Roadmap Stage 4, step 1) ---
// Tighter than the animation cap because each capability proposal — if
// approved — implies a code change in src/agent-actions.js + a server
// restart. NPCs should be picky: 1 proposal per NPC per UTC-local day.
// `system` / `operator` exempt for scripted seeds and manual fixtures.
const CAPABILITY_BUDGET_PER_DAY = 1;
const _capabilityBudget = new Map(); // key: "<by>|<YYYY-MM-DD>" → count
function _checkCapabilityBudget(by) {
  if (by === 'system' || by === 'operator') return { allowed: true, requestedToday: 0, cap: Infinity };
  const k = _budgetKey(by);
  const requestedToday = _capabilityBudget.get(k) || 0;
  return {
    allowed: requestedToday < CAPABILITY_BUDGET_PER_DAY,
    requestedToday,
    cap: CAPABILITY_BUDGET_PER_DAY,
  };
}
function _consumeCapabilityBudget(by) {
  if (by === 'system' || by === 'operator') return;
  const k = _budgetKey(by);
  _capabilityBudget.set(k, (_capabilityBudget.get(k) || 0) + 1);
}

// --- SOUL.md self-revision proposal queue (Roadmap Stage 3, steps 1-2) ---
// NPCs propose edits to their own SOUL.md once per in-game day. Proposals
// are persisted to data/soul-proposals.json and reviewed manually. We
// deliberately do NOT auto-apply edits — the identity-drift risk in
// docs/ROADMAP_SELF_ADVANCEMENT.md is real, and the approval gate is
// non-negotiable for this stage.
// Tests override SOUL_PROPOSALS_PATH so parallel test processes don't
// stomp on each other through a shared file (the read-modify-write isn't
// atomic across processes). Defaults to the on-disk dev location.
const SOUL_PROPOSALS_PATH = process.env.SOUL_PROPOSALS_PATH || path.join(__dirname, 'data', 'soul-proposals.json');
const SOUL_PROPOSALS_CAP = 50; // total stored proposals; oldest dropped when over
const SOUL_PROPOSAL_DAILY_CAP = 1; // per NPC per calendar day

function _ymdToday() {
  // Use UTC to match the ISO createdAt timestamp stamped by
  // soul-reflection.serializeProposal — otherwise NPCs near a midnight
  // boundary can submit twice in one local day if the UTC date crosses
  // between the two POSTs.
  return new Date().toISOString().slice(0, 10);
}

function _readSoulProposalsFile() {
  try {
    const raw = fs.readFileSync(SOUL_PROPOSALS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { proposals: [] };
    if (!Array.isArray(parsed.proposals)) parsed.proposals = [];
    return parsed;
  } catch (_) {
    // Lazy-create: file doesn't exist yet or is unreadable. Start clean.
    return { proposals: [] };
  }
}

function _writeSoulProposalsFile(obj) {
  try { fs.mkdirSync(path.dirname(SOUL_PROPOSALS_PATH), { recursive: true }); } catch (_) {}
  fs.writeFileSync(SOUL_PROPOSALS_PATH, JSON.stringify(obj, null, 2), 'utf8');
}

function _countProposalsToday(proposals, npcName, ymd) {
  return proposals.filter(p => p && p.npcName === npcName && typeof p.createdAt === 'string' && p.createdAt.startsWith(ymd)).length;
}

// Resolve an NPC display name (e.g. "Abby", "Marcus") to its on-disk folder
// (e.g. "abby", "conference_man"). Falls back to the lowercased name if no
// roster entry matches — keeps test-only or future NPCs working.
function _resolveNpcFolder(npcName) {
  if (!npcName) return null;
  const entry = npcRoster.entries.find(e => e.display === npcName);
  if (entry) return entry.folder;
  return String(npcName).toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

// Recent NPC-brain errors, surfaced through GET /api/health so the client
// diagnostic widget can show them without the user opening the terminal.
global._npcRecentErrors = global._npcRecentErrors || [];
/**
 * Build a short demo command to show in the visual WSL terminal window.
 * This is the command the player *sees* Bouncer type — real investigation
 * runs separately via linuxAgent.investigate().
 */
function _buildTerminalShowCmd(threat) {
  const ip = linuxAgent.extractIp(threat.source || threat.detail || '');
  const cmds = {
    network_scan:   ip ? `nmap -T4 -F --open ${ip}` : 'ss -tnp',
    packet_anomaly: 'netstat -an | grep ESTABLISHED | head -20',
    brute_force:    'grep -iE "failed|invalid" /var/log/auth.log 2>/dev/null | tail -20',
    data_breach:    'lsof -i -n 2>/dev/null | grep ESTABLISHED | head -20',
    shell_exec:     'ps aux | sort -rk3 | head -20',
    api_abuse:      'netstat -an | awk \'{print $5}\' | cut -d: -f1 | sort | uniq -c | sort -rn | head -15',
    exfiltration:   'ss -tnp | grep ESTAB',
    scan_probe:     ip ? `nmap -T4 -F --open ${ip}` : 'ss -tlnp',
    process_spawn:  'ps aux | head -30',
    unknown:        'ss -tnp | head -20',
  };
  return cmds[threat.category] || cmds.unknown;
}

/**
 * Open a real visible terminal window showing Bouncer's WSL command.
 * Uses Windows Terminal (wt.exe) if available, falls back to cmd.exe.
 * Never types into the focused window — spawns its own process.
 */
function _openBouncerTerminal(showCmd) {
  const { spawn } = require('node:child_process');
  const wslArgs = ['-d', 'kali-linux', '--', 'bash', '-c', `${showCmd}; echo; echo '--- Bouncer scan complete. Press any key to close ---'; read -n1`];

  // Try Windows Terminal first (wt.exe)
  const wtPaths = [
    process.env.LOCALAPPDATA + '\\Microsoft\\WindowsApps\\wt.exe',
    'C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_1.0.0.0_x64__8wekyb3d8bbwe\\wt.exe',
  ];
  const fs = require('node:fs');
  const wtExe = wtPaths.find(p => { try { return fs.existsSync(p); } catch(_) { return false; } });

  if (wtExe) {
    // wt.exe -d . wsl -d kali-linux -- bash -c "cmd"
    spawn(wtExe, ['-d', '.', 'wsl', ...wslArgs], { detached: true, stdio: 'ignore' }).unref();
  } else {
    // Fallback: cmd.exe window running wsl directly
    // /k keeps the window open so Bouncer can read the output
    spawn('cmd.exe', ['/c', 'start', '"Bouncer - Kali Linux"', 'wsl', ...wslArgs], {
      detached: true, stdio: 'ignore', shell: true,
    }).unref();
  }
}

/**
 * Decide whether a Bouncer investigation result is serious enough to escalate
 * to Dan (IT Support). Returns true if there are strong indicators of a real threat.
 */
function investigationIsSerious(investigation) {
  const summary = (investigation.summary || '').toLowerCase();
  return (
    (summary.includes('established') && summary.includes('failed')) ||
    summary.includes('brute') ||
    (summary.match(/open\s+port/g) || []).length > 3 ||
    (summary.includes('accepted') && summary.includes('invalid user'))
  );
}

function _recordNpcError(message) {
  const entry = { ts: Date.now(), message: String(message).slice(0, 400) };
  global._npcRecentErrors.push(entry);
  if (global._npcRecentErrors.length > 20) {
    global._npcRecentErrors = global._npcRecentErrors.slice(-20);
  }
}

// Counters so the diag panel can show "did this even arrive at the
// server?" When the user reports 'no response' but the server saw zero
// player_chat messages, that's a clear client-side issue — not a brain
// failure. Without this we'd be guessing.
global._npcStats = global._npcStats || {
  playerChatReceived: 0, playerChatSucceeded: 0, playerChatFailed: 0,
  npcConvReceived: 0,    npcConvSucceeded: 0,    npcConvFailed: 0,
  lastPlayerChatAt: null, lastNpcConvAt: null,
};

// --- External sinks (Supabase / n8n outbound webhooks) ---
// Forwards filtered worldState change events to whatever HTTP endpoints
// the operator has configured via env vars. No-op when no env vars are set.
const externalSink = new ExternalSink({ worldState });
externalSink.attach();

// --- WorldState change broadcast (throttled) ---
// Whenever any subsystem mutates the world, queue a delta for every
// connected /agent-ws client. Without throttling, a busy moment (e.g. a
// tshark burst + every NPC thinking on the same tick) can fire dozens of
// `change` events in <50ms, each cutting its own JSON.stringify and ws.send
// per client. Coalesce into 500ms windows: the latest snapshot wins per
// `kind`, and a single combined frame goes out at most twice per second.
//
// `presence` is special-cased: that flag is human-toggled and the UI must
// feel instant, so we bypass the throttle for it. `threat` is also passed
// through because a robber spawning >500ms after the bubble fires looks
// wrong; the rest (npc state churn, task ticks, event-feed entries) absorb
// the latency just fine.
const WS_BROADCAST_INTERVAL_MS = 500;
const IMMEDIATE_KINDS = new Set(['presence', 'threat', 'threat-cleared']);

let _pendingChanges = new Map(); // kind -> { kind, payload, ts }
let _broadcastTimer = null;
let _agentBusBuffer = [];        // collected agent-bus messages

function _broadcastFrame() {
  _broadcastTimer = null;
  const changes = Array.from(_pendingChanges.values());
  const busMessages = _agentBusBuffer;
  _pendingChanges = new Map();
  _agentBusBuffer = [];
  if (changes.length === 0 && busMessages.length === 0) return;

  // One JSON.stringify, one ws.send per client per tick — irrespective of
  // how many mutations happened during the window.
  const frame = JSON.stringify({
    type: 'world_state_batch',
    changes,
    busMessages,
    ts: Date.now(),
  });
  cofounderAgent.wsClients.forEach(ws => {
    if (ws.readyState === 1) {
      try { ws.send(frame); } catch (_) { /* drop */ }
    }
  });
}

function _scheduleBroadcast() {
  if (_broadcastTimer) return;
  _broadcastTimer = setTimeout(_broadcastFrame, WS_BROADCAST_INTERVAL_MS);
}

function _sendImmediate(payload) {
  const data = JSON.stringify(payload);
  cofounderAgent.wsClients.forEach(ws => {
    if (ws.readyState === 1) {
      try { ws.send(data); } catch (_) {}
    }
  });
}

worldState.on('change', ({ kind, payload }) => {
  const entry = { kind, payload, ts: Date.now() };
  if (IMMEDIATE_KINDS.has(kind)) {
    _sendImmediate({ type: 'world_state', ...entry });
    return;
  }
  // Latest write wins per kind for the next window.
  _pendingChanges.set(kind, entry);
  _scheduleBroadcast();
});

// --- Agent bus mirror (also throttled in the same window) ---
agentBus.subscribe('*', (msg) => {
  _agentBusBuffer.push(msg);
  // Cap the buffer in case something pathological happens.
  if (_agentBusBuffer.length > 60) _agentBusBuffer.splice(0, _agentBusBuffer.length - 60);
  _scheduleBroadcast();
});

function safeDecodePath(url) {
  try {
    return decodeURIComponent(url.split('?')[0]);
  } catch (err) {
    return null;
  }
}

const server = http.createServer((req, res) => {
  let urlPath = safeDecodePath(req.url);
  const fullUrl = req.url;

  if (!urlPath) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  // --- Security: check every request for suspicious patterns ---
  securityMonitor.checkHttpRequest(req);

  // Proxy /openclaw/* to the OpenClaw gateway, stripping iframe-blocking headers
  if (fullUrl.startsWith('/openclaw')) {
    const targetPath = fullUrl.replace(/^\/openclaw/, '') || '/';
    const proxyOpts = {
      hostname: OPENCLAW_HOST,
      port: OPENCLAW_PORT,
      path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: `${OPENCLAW_HOST}:${OPENCLAW_PORT}` },
    };
    const proxyReq = http.request(proxyOpts, (proxyRes) => {
      // Strip headers that block iframe embedding
      const headers = { ...proxyRes.headers };
      delete headers['x-frame-options'];
      delete headers['content-security-policy'];
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
      res.writeHead(502);
      res.end('OpenClaw proxy error: ' + err.message);
    });
    req.pipe(proxyReq);
    return;
  }

  // --- Layout save/load API ---
  const layoutDir = path.join(ROOT, 'layouts');
  const layoutFile = path.join(layoutDir, 'office-layout.json');

  if (urlPath === '/api/layout' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        JSON.parse(body); // validate JSON
        fs.mkdirSync(layoutDir, { recursive: true });
        fs.writeFileSync(layoutFile, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (urlPath === '/api/layout' && req.method === 'GET') {
    fs.readFile(layoutFile, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No saved layout' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
    return;
  }

  // --- NPC-facing "place a single piece of furniture" endpoint ---
  // The NPC brain's placeFurniture action POSTs here. We append the
  // item to office-layout.json (read-modify-write), broadcast a
  // worldState event so everyone notices, and return the new item.
  // Validation is strict: a small whitelist of prefab kinds and bounds.
  //
  // Body shape: { by: "Abby", prefabId: "desk_small", x: 320, y: 240, reason?: "..." }
  if (urlPath === '/api/place-furniture' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const by = String(p.by || 'system').slice(0, 40);
      const prefabId = String(p.prefabId || '').slice(0, 80);
      const x = parseInt(p.x, 10);
      const y = parseInt(p.y, 10);
      const reason = p.reason ? String(p.reason).slice(0, 200) : null;

      // Whitelist + bounds. Keep this short — expanding it should be a
      // deliberate change, not a wide-open "NPC can spawn anything" API.
      if (!ALLOWED_PREFABS.has(prefabId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `prefabId not in whitelist: ${prefabId}`, allowed: [...ALLOWED_PREFABS] }));
        return;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 16 || y < 16 || x > 1264 || y > 704) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'x/y out of bounds (must fit inside 1280×720 with 16px margin)' }));
        return;
      }

      // Per-NPC daily budget — keep a single NPC from bulldozing the
      // office. system/operator (the empty/'system' caller) is exempt
      // so manual fixtures still work.
      const budgetCheck = _checkPlacementBudget(by);
      if (!budgetCheck.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `${by} has hit the daily placement budget (${budgetCheck.cap}). Try again tomorrow.`,
          placedToday: budgetCheck.placedToday,
        }));
        return;
      }

      // Read-modify-write the layout file. The structure of office-layout.json
      // is { items: [...] } — we just append.
      let layout = { items: [] };
      try {
        const raw = fs.readFileSync(layoutFile, 'utf8');
        layout = JSON.parse(raw);
        if (!Array.isArray(layout.items)) layout.items = [];
      } catch (_) {
        fs.mkdirSync(layoutDir, { recursive: true });
      }
      const instanceId = `npc_${prefabId}_${Date.now()}`;
      const item = { instanceId, prefabId, x, y, placedBy: by, placedAt: Date.now(), reason };
      layout.items.push(item);
      try {
        fs.writeFileSync(layoutFile, JSON.stringify(layout, null, 2), 'utf8');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist layout: ' + err.message }));
        return;
      }

      // Consume budget AFTER successful persist (don't penalize the NPC
      // for our IO failures).
      _consumePlacementBudget(by);

      // Surface as a worldState event so NPCs notice ("Abby placed a couch")
      // and the diag panel logs it.
      try {
        worldState.pushEvent('shipped', `${by} placed ${prefabId} at (${x},${y})${reason ? ' — ' + reason : ''}`);
      } catch (_) {}

      // Broadcast LIVE so the browser can instantiate the sprite without
      // waiting for a page reload. The client subscribes to
      // 'furniture_placed' and pushes the new item into _interactables.
      _sendImmediate({ type: 'furniture_placed', item, by });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, item }));
    });
    return;
  }

  // --- Remove a single piece of NPC-placed furniture ---
  // Body: { by: "Abby", instanceId: "npc_couch_169..." }
  // Only items whose instanceId starts with "npc_" can be removed —
  // hand-placed scene furniture is read-only. NPCs can remove their
  // own placements or each other's; we surface who removed what in
  // the world-state event feed so any griefing is visible.
  if (urlPath === '/api/remove-furniture' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const by = String(p.by || 'system').slice(0, 40);
      const instanceId = String(p.instanceId || '');
      if (!instanceId.startsWith('npc_')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'instanceId must start with "npc_" (only NPC-placed furniture is removable)' }));
        return;
      }

      let layout = { items: [] };
      try {
        const raw = fs.readFileSync(layoutFile, 'utf8');
        layout = JSON.parse(raw);
        if (!Array.isArray(layout.items)) layout.items = [];
      } catch (_) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no layout file' }));
        return;
      }
      const idx = layout.items.findIndex(it => it.instanceId === instanceId);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `instanceId not found: ${instanceId}` }));
        return;
      }
      const removed = layout.items.splice(idx, 1)[0];
      try {
        fs.writeFileSync(layoutFile, JSON.stringify(layout, null, 2), 'utf8');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist layout: ' + err.message }));
        return;
      }
      try {
        worldState.pushEvent('shipped', `${by} removed ${removed.prefabId} (placed by ${removed.placedBy})`);
      } catch (_) {}
      _sendImmediate({ type: 'furniture_removed', instanceId, by });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, removed }));
    });
    return;
  }

  // --- NPC-facing "request a new animation" endpoint ---
  // Stage 2 of the self-advancement roadmap. NPCs propose a new
  // animation by name + short description; the proposal goes into a
  // pending queue and an operator decides whether to actually generate
  // / register it. This endpoint does NOT generate sprite frames —
  // that's a separate (and currently stubbed) generator pipeline. See
  // docs/ANIMATION_FORGE.md.
  //
  // Body shape: { by: "Roki", animName: "meditate", description: "sitting cross-legged" }
  const animationProposalsFile = path.join(ROOT, 'data', 'animation-proposals.json');

  if (urlPath === '/api/request-animation' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const by = String(p.by || 'system').slice(0, 40);
      const animName = String(p.animName || '').slice(0, 80);
      const description = String(p.description || '').slice(0, 400);

      // Shared validator — keeps the endpoint and animation-forge in lockstep.
      const v = animationForge.validateProposal({ animName, description });
      if (!v.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: v.error }));
        return;
      }

      // Daily budget — lower than the placement budget because each
      // proposal is heavier review work for the operator.
      const budgetCheck = _checkAnimationBudget(by);
      if (!budgetCheck.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `${by} has hit the daily animation-request budget (${budgetCheck.cap}). Try again tomorrow.`,
          requestedToday: budgetCheck.requestedToday,
        }));
        return;
      }

      // Read-modify-write the proposals file. Shape: { proposals: [...] }.
      let store = { proposals: [] };
      try {
        const raw = fs.readFileSync(animationProposalsFile, 'utf8');
        store = JSON.parse(raw);
        if (!Array.isArray(store.proposals)) store.proposals = [];
      } catch (_) {
        try { fs.mkdirSync(path.dirname(animationProposalsFile), { recursive: true }); } catch (__) {}
      }
      const id = `anim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const proposal = {
        id,
        by,
        animName,
        description,
        proposedAt: Date.now(),
        status: 'pending',
      };
      store.proposals.push(proposal);
      try {
        fs.writeFileSync(animationProposalsFile, JSON.stringify(store, null, 2), 'utf8');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist proposal: ' + err.message }));
        return;
      }

      // Consume budget AFTER successful persist (don't penalize the NPC
      // for our IO failures).
      _consumeAnimationBudget(by);

      // Surface as a worldState event so the diag panel sees the
      // proposal arrive. NPCs may also notice — at minimum the operator
      // gets a breadcrumb.
      try {
        worldState.pushEvent('proposed-animation',
          `${by} proposed animation "${animName}": ${description}`);
      } catch (_) {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, proposal }));
    });
    return;
  }

  // --- Operator-facing list of pending animation proposals ---
  // Used by a future operator review UI. Returns the raw JSON; an empty
  // file is treated as `{ proposals: [] }`.
  if (urlPath === '/api/animation-proposals' && req.method === 'GET') {
    let store = { proposals: [] };
    try {
      const raw = fs.readFileSync(animationProposalsFile, 'utf8');
      store = JSON.parse(raw);
      if (!Array.isArray(store.proposals)) store.proposals = [];
    } catch (_) { /* file may not exist yet */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(store));
    return;
  }

  // --- Capability-request proposal queue (Roadmap Stage 4, step 1) ---
  // NPCs propose new actions (verbs) that don't exist yet. The proposal
  // goes to a pending queue and an operator decides whether to actually
  // implement the verb in src/agent-actions.js. This endpoint does NOT
  // implement anything — that's step 3 of the roadmap and explicitly
  // future work. See docs/CAPABILITY_PROPOSALS.md.
  //
  // Body shape: { by: "Roki", verbName: "whiteboardDraw", description: "..." }
  const capabilityProposalsFile = path.join(ROOT, 'data', 'capability-proposals.json');

  function _readCapabilityStore() {
    let store = { proposals: [] };
    try {
      const raw = fs.readFileSync(capabilityProposalsFile, 'utf8');
      store = JSON.parse(raw);
      if (!store || typeof store !== 'object') store = { proposals: [] };
      if (!Array.isArray(store.proposals)) store.proposals = [];
    } catch (_) { /* lazy-create */ }
    return store;
  }
  function _writeCapabilityStore(store) {
    try { fs.mkdirSync(path.dirname(capabilityProposalsFile), { recursive: true }); } catch (_) {}
    fs.writeFileSync(capabilityProposalsFile, JSON.stringify(store, null, 2), 'utf8');
  }

  if (urlPath === '/api/request-capability' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const by = String(p.by || 'system').slice(0, 40);
      const verbName = String(p.verbName || '').slice(0, 80);
      // Slice slightly above the validator's MAX_DESCRIPTION_LEN so the
      // validator can still surface a meaningful "too long" error instead
      // of having the endpoint silently truncate at the same boundary.
      const description = String(p.description || '').slice(0, 500);

      // Shared validator — keeps the endpoint and capability-proposal in lockstep.
      const v = capabilityProposal.validateProposal({ verbName, description });
      if (!v.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: v.error }));
        return;
      }

      // Daily budget — tighter than animations because each capability
      // proposal implies hand-written code + a restart if approved.
      const budgetCheck = _checkCapabilityBudget(by);
      if (!budgetCheck.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `${by} has hit the daily capability-request budget (${budgetCheck.cap}). Try again tomorrow.`,
          requestedToday: budgetCheck.requestedToday,
        }));
        return;
      }

      const store = _readCapabilityStore();
      const proposal = capabilityProposal.serializeProposal({ by, verbName, description });
      store.proposals.push(proposal);
      try {
        _writeCapabilityStore(store);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist proposal: ' + err.message }));
        return;
      }

      // Consume budget AFTER successful persist (don't penalize the NPC
      // for our IO failures).
      _consumeCapabilityBudget(by);

      try {
        worldState.pushEvent('proposed-capability',
          `${by} proposed capability "${verbName}": ${description}`);
      } catch (_) {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, proposal }));
    });
    return;
  }

  // GET /api/capability-proposals[?status=pending|approved|rejected]
  if (urlPath === '/api/capability-proposals' && req.method === 'GET') {
    const store = _readCapabilityStore();
    const url = new URL(req.url, 'http://x');
    const statusFilter = url.searchParams.get('status');
    let proposals = store.proposals;
    if (statusFilter) {
      proposals = proposals.filter(p => p && p.status === statusFilter);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ proposals }));
    return;
  }

  // POST /api/capability-proposal/approve — body { id, decision, note? }
  // Same shape as /api/soul-proposal/approve. Does NOT implement the
  // verb — operator still has to ship the code by hand.
  if (urlPath === '/api/capability-proposal/approve' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const id = String(payload.id || '').trim();
      const decision = String(payload.decision || '').trim();
      const note = payload.note ? String(payload.note).slice(0, 400) : null;
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'id is required' }));
        return;
      }
      if (decision !== 'approved' && decision !== 'rejected') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "decision must be 'approved' or 'rejected'" }));
        return;
      }

      const store = _readCapabilityStore();
      const idx = store.proposals.findIndex(p => p && p.id === id);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `proposal not found: ${id}` }));
        return;
      }
      store.proposals[idx].status = decision;
      store.proposals[idx].review = {
        decision,
        note,
        reviewedAt: new Date().toISOString(),
      };
      try {
        _writeCapabilityStore(store);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist decision: ' + err.message }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, proposal: store.proposals[idx] }));
    });
    return;
  }

  // --- SOUL.md self-revision proposal queue (Stage 3 steps 1-2) ---
  // Body: { npcName, proposal: { addToSoul, dropFromSoul, summary, confidence }, reflectionInput? }
  // Validates via src/soul-reflection.validateProposal, persists to
  // data/soul-proposals.json (lazy-create), enforces a 1/NPC/day cap +
  // a 50-proposal total cap (drops oldest), and emits a worldState event.
  // Does NOT apply the edit to SOUL.md — that's deferred (operator UI).
  if (urlPath === '/api/soul-proposal' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const npcName = String(payload.npcName || '').trim().slice(0, 40);
      if (!npcName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'npcName is required' }));
        return;
      }
      const v = soulReflection.validateProposal(payload.proposal);
      if (!v.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: v.error }));
        return;
      }

      const file = _readSoulProposalsFile();
      const ymd = _ymdToday();
      const todayCount = _countProposalsToday(file.proposals, npcName, ymd);
      if (todayCount >= SOUL_PROPOSAL_DAILY_CAP) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `${npcName} already has ${todayCount} proposal(s) for ${ymd} (cap: ${SOUL_PROPOSAL_DAILY_CAP}/day). Try again tomorrow.`,
          cap: SOUL_PROPOSAL_DAILY_CAP,
        }));
        return;
      }

      const record = soulReflection.serializeProposal({
        npcName,
        proposal: payload.proposal,
        reflectionInput: payload.reflectionInput,
      });

      file.proposals.push(record);
      // Drop oldest if we exceed the total cap.
      if (file.proposals.length > SOUL_PROPOSALS_CAP) {
        file.proposals.splice(0, file.proposals.length - SOUL_PROPOSALS_CAP);
      }
      try {
        _writeSoulProposalsFile(file);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist proposal: ' + err.message }));
        return;
      }
      try {
        worldState.pushEvent('proposed-soul-edit', `${npcName} proposed a SOUL.md edit: ${record.proposal.summary}`);
      } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: record.id }));
    });
    return;
  }

  // GET /api/soul-proposals?npc=Name — returns persisted proposals.
  // Lazy-creates the file (returns { proposals: [] } if absent).
  if (urlPath === '/api/soul-proposals' && req.method === 'GET') {
    const file = _readSoulProposalsFile();
    const url = new URL(req.url, 'http://x');
    const npcFilter = url.searchParams.get('npc');
    let proposals = file.proposals;
    if (npcFilter) {
      proposals = proposals.filter(p => p && p.npcName === npcFilter);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ proposals }));
    return;
  }

  // POST /api/soul-proposal/approve — body { id, decision: 'approved'|'rejected', note? }
  // Updates the proposal status in place. Does NOT touch SOUL.md (deferred).
  if (urlPath === '/api/soul-proposal/approve' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const id = String(payload.id || '').trim();
      const decision = String(payload.decision || '').trim();
      const note = payload.note ? String(payload.note).slice(0, 400) : null;
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'id is required' }));
        return;
      }
      if (decision !== 'approved' && decision !== 'rejected') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "decision must be 'approved' or 'rejected'" }));
        return;
      }

      const file = _readSoulProposalsFile();
      const idx = file.proposals.findIndex(p => p && p.id === id);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `proposal not found: ${id}` }));
        return;
      }
      file.proposals[idx].status = decision;
      file.proposals[idx].review = {
        decision,
        note,
        reviewedAt: new Date().toISOString(),
      };
      try {
        _writeSoulProposalsFile(file);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist decision: ' + err.message }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, proposal: file.proposals[idx] }));
    });
    return;
  }

  // POST /api/soul-proposal/apply — body { id }
  // Roadmap Stage 3 steps 3 + 4. Writes the approved proposal to the
  // target NPC's SOUL.md and appends a structured entry to SOUL.history.md.
  // Idempotent: re-applying the same id returns the existing receipt.
  // Operator gate: only proposals with status === 'approved' may be applied.
  if (urlPath === '/api/soul-proposal/apply' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const id = String(payload.id || '').trim();
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'id is required' }));
        return;
      }

      const file = _readSoulProposalsFile();
      const idx = file.proposals.findIndex(p => p && p.id === id);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `proposal not found: ${id}` }));
        return;
      }
      const record = file.proposals[idx];

      // Already applied — return the existing receipt with 200 so callers
      // can treat apply as idempotent. The 400 in the spec is for "tried to
      // apply an already-applied proposal expecting a fresh write"; in
      // practice returning the receipt with a clear status code is friendlier.
      // We pick 200 + `alreadyApplied: true` so the front-end can branch
      // without parsing error strings.
      if (record.status === 'applied') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, alreadyApplied: true, proposal: record }));
        return;
      }

      if (record.status !== 'approved') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `proposal must be approved before it can be applied (current status: ${record.status})`,
        }));
        return;
      }

      const folder = _resolveNpcFolder(record.npcName);
      const soulPath = path.join(__dirname, 'npcs', folder, 'SOUL.md');
      const historyPath = path.join(__dirname, 'npcs', folder, 'SOUL.history.md');

      let soulText;
      try {
        soulText = fs.readFileSync(soulPath, 'utf8');
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `SOUL.md not found for ${record.npcName} at npcs/${folder}/SOUL.md` }));
        return;
      }

      const { next, warnings } = soulReflection.applyProposalToSoul({
        soulText,
        proposal: record,
      });
      if (warnings && warnings.length) {
        for (const w of warnings) {
          console.warn(`[soul-apply] ${record.npcName} ${id}: ${w}`);
        }
      }

      const appliedAt = new Date().toISOString();
      const historyEntry = soulReflection.serializeHistoryEntry({
        proposal: record,
        applied: { at: appliedAt },
      });

      try {
        fs.writeFileSync(soulPath, next, 'utf8');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to write SOUL.md: ' + err.message }));
        return;
      }

      try {
        // Append (create with header if missing) so multiple applications stack.
        let historyHeader = '';
        if (!fs.existsSync(historyPath)) {
          historyHeader = `# ${record.npcName} — SOUL.md Revision History\n\n`;
        }
        fs.appendFileSync(historyPath, historyHeader + historyEntry, 'utf8');
      } catch (err) {
        // Don't roll the SOUL.md back — the apply already happened. Just
        // surface the history-write failure so the operator knows.
        console.warn(`[soul-apply] failed to write SOUL.history.md for ${record.npcName}: ${err.message}`);
      }

      record.status = 'applied';
      record.applied = {
        at: appliedAt,
        soulPath: path.relative(__dirname, soulPath).replace(/\\/g, '/'),
        historyPath: path.relative(__dirname, historyPath).replace(/\\/g, '/'),
        warnings: warnings || [],
      };

      try {
        _writeSoulProposalsFile(file);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist proposal record: ' + err.message }));
        return;
      }

      try {
        worldState.pushEvent(
          'applied-soul-edit',
          `${record.npcName} SOUL.md updated from proposal ${id}`,
        );
      } catch (_) {}

      // Refresh the in-memory SOUL cache so the NPC's next think() picks
      // up the new personality without a restart.
      try { npcBrains.reloadSoul(record.npcName); } catch (_) {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, proposal: record }));
    });
    return;
  }

  // --- POST /api/animation-proposal/approve ---
  // Body: { id, decision: 'approved'|'rejected', note? }
  // Symmetric with /api/soul-proposal/approve so the operator UI can use
  // the same shape across kinds. Does NOT trigger sprite generation —
  // that's still future work (see docs/ANIMATION_FORGE.md). Flipping
  // status to 'approved' here just clears the proposal for whatever
  // generator pipeline lands later.
  if (urlPath === '/api/animation-proposal/approve' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const id = String(payload.id || '').trim();
      const decision = String(payload.decision || '').trim();
      const note = payload.note ? String(payload.note).slice(0, 400) : null;
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'id is required' }));
        return;
      }
      if (decision !== 'approved' && decision !== 'rejected') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "decision must be 'approved' or 'rejected'" }));
        return;
      }
      let store = { proposals: [] };
      try {
        const raw = fs.readFileSync(animationProposalsFile, 'utf8');
        store = JSON.parse(raw);
        if (!Array.isArray(store.proposals)) store.proposals = [];
      } catch (_) { /* lazy-create equivalent */ }
      const idx = store.proposals.findIndex(p => p && p.id === id);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `proposal not found: ${id}` }));
        return;
      }
      store.proposals[idx].status = decision;
      store.proposals[idx].review = {
        decision,
        note,
        reviewedAt: new Date().toISOString(),
      };
      try {
        fs.mkdirSync(path.dirname(animationProposalsFile), { recursive: true });
        fs.writeFileSync(animationProposalsFile, JSON.stringify(store, null, 2), 'utf8');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist decision: ' + err.message }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, proposal: store.proposals[idx] }));
    });
    return;
  }

  // --- GET /api/proposals — aggregated read for the operator review UI ---
  // Unifies the animation + SOUL + (future) capability queues into a
  // single timestamp-sorted feed so the operator UI doesn't have to
  // remember three endpoints. Each entry is kind-tagged and carries the
  // raw record for "show details" UX.
  //
  // Query string:
  //   ?status=pending|approved|rejected|applied|all   default: pending
  //   ?kind=animation|soul|capability                 may be comma-separated
  //
  // Hard cap of 100 entries; newest first.
  if (urlPath === '/api/proposals' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const statusFilter = (url.searchParams.get('status') || 'pending').toLowerCase();
    const kindParam = url.searchParams.get('kind') || '';
    const kindFilter = new Set(
      kindParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    );
    const HARD_CAP = 100;

    function maybe(kind) {
      return kindFilter.size === 0 || kindFilter.has(kind);
    }

    const merged = [];

    // Animation proposals — { id, by, animName, description, proposedAt, status, review? }
    if (maybe('animation')) {
      let store = { proposals: [] };
      try {
        const raw = fs.readFileSync(animationProposalsFile, 'utf8');
        store = JSON.parse(raw);
        if (!Array.isArray(store.proposals)) store.proposals = [];
      } catch (_) { /* missing file → empty */ }
      for (const p of store.proposals) {
        if (!p || typeof p !== 'object') continue;
        merged.push({
          kind: 'animation',
          id: p.id,
          by: p.by,
          status: p.status || 'pending',
          summary: `${p.animName || '?'} — ${p.description || ''}`.slice(0, 240),
          ts: Number(p.proposedAt) || 0,
          raw: p,
        });
      }
    }

    // SOUL proposals — { id, npcName, createdAt, status, proposal:{summary,...}, review? }
    if (maybe('soul')) {
      const file = _readSoulProposalsFile();
      for (const p of file.proposals) {
        if (!p || typeof p !== 'object') continue;
        const tsMs = p.createdAt ? Date.parse(p.createdAt) : 0;
        merged.push({
          kind: 'soul',
          id: p.id,
          by: p.npcName,
          status: p.status || 'pending',
          summary: (p.proposal && p.proposal.summary) ? String(p.proposal.summary).slice(0, 240) : '(no summary)',
          ts: Number.isFinite(tsMs) ? tsMs : 0,
          raw: p,
        });
      }
    }

    // Capability proposals — may not exist on master (Stage 4 is in
    // flight in a parallel branch). Treat missing/unparseable file as
    // empty. Shape (best-effort): { id, by, verbName, description, proposedAt, status }.
    if (maybe('capability')) {
      const capabilityProposalsFile = path.join(ROOT, 'data', 'capability-proposals.json');
      try {
        const raw = fs.readFileSync(capabilityProposalsFile, 'utf8');
        const store = JSON.parse(raw);
        const arr = Array.isArray(store?.proposals) ? store.proposals : [];
        for (const p of arr) {
          if (!p || typeof p !== 'object') continue;
          const tsMs = Number(p.proposedAt) || (p.createdAt ? Date.parse(p.createdAt) : 0) || 0;
          const label = p.verbName || p.capability || p.animName || p.name || '?';
          const desc = p.description || p.summary || '';
          merged.push({
            kind: 'capability',
            id: p.id,
            by: p.by || p.npcName,
            status: p.status || 'pending',
            summary: `${label} — ${desc}`.slice(0, 240),
            ts: Number.isFinite(tsMs) ? tsMs : 0,
            raw: p,
          });
        }
      } catch (_) { /* file may not exist yet — fine */ }
    }

    // Status filter — 'all' bypasses.
    const filtered = statusFilter === 'all'
      ? merged
      : merged.filter(e => String(e.status || '').toLowerCase() === statusFilter);

    // Newest first.
    filtered.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    const total = filtered.length;
    const proposals = filtered.slice(0, HARD_CAP);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ proposals, total, cap: HARD_CAP, truncated: total > HARD_CAP }));
    return;
  }

  // --- Email inbound (from n8n Gmail trigger) ---
  // n8n POSTs { from, subject, body, threadId?, secret? } whenever
  // a new email lands in the watched inbox. We route to the first NPC
  // with an email_style block in their SOUL (Sarah today), draft a
  // reply with the existing brain pipeline, save to Gmail drafts
  // (or local fallback if Gmail OAuth isn't wired yet), and broadcast
  // a `npc_email_arrived` WS event so the office UI can animate
  // Sarah walking to her desk.
  if (urlPath === '/api/email-inbound' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      // Shared-secret check. EMAIL_INBOUND_SECRET in env; if unset, the
      // endpoint is open (useful in dev). Pass the same value in n8n's
      // Webhook node header or body so prod is auth'd.
      const expectedSecret = process.env.EMAIL_INBOUND_SECRET || '';
      if (expectedSecret) {
        const got = String(payload.secret || req.headers['x-denizen-secret'] || '');
        if (got !== expectedSecret) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad or missing secret' }));
          return;
        }
      }

      try {
        const result = await emailHandler.processInboundEmail(
          { npcBrains, gmailClient },
          {
            from: String(payload.from || '').slice(0, 200),
            subject: String(payload.subject || '').slice(0, 400),
            body: String(payload.body || '').slice(0, 20000),
            threadId: payload.threadId || null,
          },
          { preferredName: payload.preferredName || null },
        );
        if (!result.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
        }

        // Surface as a worldState event AND a direct WS broadcast so
        // the in-office Sarah sprite can react (walk to desk).
        try {
          worldState.pushEvent('email', `${result.route?.name || 'Secretary'} drafted reply to ${payload.from}`);
        } catch (_) {}
        try {
          cofounderAgent.wsClients.forEach(ws => {
            if (ws.readyState !== 1) return;
            try {
              ws.send(JSON.stringify({
                type: 'npc_email_arrived',
                npcName: result.route?.name || 'Sarah',
                from: payload.from,
                subject: payload.subject,
                escalated: !!result.escalated,
                draftId: result.drafted?.id || null,
              }));
            } catch (_) {}
          });
        } catch (_) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err?.message || err) }));
      }
    });
    return;
  }

  // --- Email drafts (read for operator review) ---
  if (urlPath === '/api/email-drafts' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const sentParam = url.searchParams.get('sent');
    const sentFilter = sentParam === 'true' ? true : sentParam === 'false' ? false : null;
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 25)));
    const drafts = gmailClient.listDrafts({ limit, sentFilter });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ drafts, mode: gmailClient.mode() }));
    return;
  }

  // --- Email draft send (operator action) ---
  if (urlPath === '/api/email-draft/send' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      // The route trusts the request only when EMAIL_AUTOSEND env is on.
      // We also check the per-NPC SOUL's email_canAutoSend at gmail-client
      // level via the autoSendAllowed flag.
      const result = await gmailClient.sendDraft({
        id: String(payload.id || ''),
        autoSendAllowed: !!payload.autoSendAllowed,
      });
      res.writeHead(result.status === 'sent' ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // --- Cost dashboard + balance check ---
  if (urlPath === '/api/costs' && req.method === 'GET') {
    (async () => {
      const { buildCostSummary, fetchMoonshotBalance, PRICING } = llmTelemetry;
      const summary = buildCostSummary(llmTelemetry.ring);

      // Check Moonshot/Kimi balance (only provider with a public balance API)
      const moonshotKey = npcBrains.providers?.kimi?.apiKey || npcBrains.providers?.moonshot?.apiKey;
      const moonshot = moonshotKey ? await fetchMoonshotBalance(moonshotKey) : { ok: false, error: 'no key configured' };

      // Per-provider pricing reference
      const pricingRef = Object.entries(PRICING)
        .filter(([k]) => !['claude','gemini','grok','kimi'].includes(k)) // dedupe aliases
        .reduce((acc, [k, v]) => {
          acc[k] = { inputPer1MTokens: `$${v.in}`, outputPer1MTokens: `$${v.out}` };
          return acc;
        }, {});

      // Cheapest provider recommendation
      const cheapest = Object.entries(PRICING)
        .filter(([k]) => !['claude','gemini','grok','kimi','lmstudio'].includes(k) && PRICING[k].in > 0)
        .sort(([,a],[,b]) => (a.in + a.out) - (b.in + b.out))[0];

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        period: '24h',
        ...summary,
        balances: { moonshot },
        tip: summary.totalCost > 0.01
          ? `You\'ve spent $${summary.totalCost.toFixed(4)} today. Switch NPCs to "gemini" provider for ~10x savings vs claude.`
          : 'Spend is low. Keep going.',
        pricingRef,
      }, null, 2));
    })();
    return;
  }

  // --- POST /api/assign-directive — push a mandatory task to an NPC ---
  // Body: { from: "Abby", to: "Josh", task: "Fix the auth bug today", urgent?: true }
  if (urlPath === '/api/assign-directive' && req.method === 'POST') {
    _readJsonBody(req).then(payload => {
      if (!payload.from || !payload.to || !payload.task) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'from, to, and task are required' }));
        return;
      }
      npcBrains.assignDirective(payload.to, payload.from, payload.task, !!payload.urgent);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, from: payload.from, to: payload.to }));
    }).catch(err => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // --- POST /api/task-chains — start a multi-step NPC task chain ---
  // Body: { name, triggeredBy, steps: [{ npc, task, artifactCategory }] }
  if (urlPath === '/api/task-chains' && req.method === 'POST') {
    _readJsonBody(req).then(payload => {
      if (!payload.steps || !Array.isArray(payload.steps) || payload.steps.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'steps array is required' }));
        return;
      }
      const broadcastFn = (msg) =>
        (agentWss ? agentWss.clients : new Set()).forEach(c => {
          if (c.readyState === 1) c.send(JSON.stringify(msg));
        });
      const chain = taskChain.startChain(
        payload,
        (to, from, task, urgent) => npcBrains.assignDirective(to, from, task, !!urgent),
        broadcastFn
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, chainId: chain.id, name: chain.name, steps: chain.steps.length }));
    }).catch(err => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // --- GET /api/task-chains — list active chains and their status ---
  if (urlPath === '/api/task-chains' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ chains: taskChain.getActiveChains() }));
    return;
  }

  // --- GET /api/task-chains/:id — get a specific chain's status ---
  const chainStatusMatch = urlPath.match(/^\/api\/task-chains\/([^/]+)$/);
  if (chainStatusMatch && req.method === 'GET') {
    const chain = taskChain.getChainStatus(chainStatusMatch[1]);
    if (!chain) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'chain not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ chain }));
    return;
  }

  // --- Abort any in-flight desktop agent task ---
  if (urlPath === '/api/desktop-abort' && req.method === 'POST') {
    desktopAgent._abortAll = true;
    setTimeout(() => { desktopAgent._abortAll = false; }, 5000); // auto-reset after 5s
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, note: 'Desktop agent task aborted.' }));
    return;
  }

  // --- Desktop agent (Lucy controls the full PC) ---
  if (urlPath === '/api/desktop-task' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }
      if (!payload.instruction) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'instruction required' })); return;
      }
      const broadcast = (msg) => cofounderAgent.wsClients.forEach(ws => {
        if (ws.readyState === 1) ws.send(JSON.stringify(msg));
      });
      // Return immediately — task runs async, progress via WS
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, async: true, note: 'Lucy is on it — watch your screen.' }));
      // PC activity: desktop-agent drives mouse/keyboard on the whole
      // PC — by definition 'visible' (the user literally watches the
      // cursor move). Npc tagged 'Lucy' because that's the only NPC
      // wired to /api/desktop-task today.
      const dtActivity = pcActivity.record({
        npc: 'Lucy', kind: 'desktop-agent',
        task: String(payload.instruction).slice(0, 240),
        mode: 'visible', status: 'started',
      });
      const dtStart = Date.now();
      desktopAgent.runDesktopTask({ instruction: payload.instruction, broadcast, provider: payload.provider || null })
        .then((result) => {
          pcActivity.record({
            id: dtActivity.id, npc: 'Lucy', kind: 'desktop-agent',
            task: dtActivity.task, mode: 'visible', status: 'done',
            durationMs: Date.now() - dtStart,
            detail: result && typeof result === 'object'
              ? String(result.summary || result.note || '').slice(0, 240) || null
              : null,
          });
        })
        .catch(err => {
          pcActivity.record({
            id: dtActivity.id, npc: 'Lucy', kind: 'desktop-agent',
            task: dtActivity.task, mode: 'visible', status: 'failed',
            durationMs: Date.now() - dtStart,
            detail: String(err?.message || err).slice(0, 240),
          });
          console.error('[desktop-task] error:', err?.message);
        });
    });
    return;
  }

  // --- Bouncer security scan (manual trigger) ---
  // POST /api/bouncer-scan { tool: 'nmap'|'wireshark'|'zenmap', target?: '192.168.1.1', reason?: 'manual' }
  // 'zenmap' and 'nmap' both run nmap via Kali WSL (Zenmap is just a GUI wrapper — nmap is the real tool).
  // 'wireshark' runs tcpdump on loopback via Kali WSL (tshark if installed).
  if (urlPath === '/api/bouncer-scan' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }

      const tool      = payload.tool || 'nmap';
      const target    = payload.target || 'localhost';
      const reason    = payload.reason || 'manual security check';
      const bcast     = (msg) => cofounderAgent.wsClients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(msg)); });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, tool, async: true, note: `Bouncer is running ${tool} via Kali Linux — results incoming.` }));

      bcast({ type: 'bouncer_tool_status', tool, status: 'starting',
        threat: { category: 'manual', source: target, detail: reason },
        message: `Bouncer running ${tool === 'zenmap' ? 'nmap' : tool} in Kali WSL — ${reason}` });

      // PC activity: linux-agent runs real commands in WSL/Kali. The
      // bouncer terminal window pops up in this path, so mode='visible'
      // when the operator asked for a terminal, otherwise 'background'.
      const scanActivity = pcActivity.record({
        npc: 'Bouncer', kind: 'linux-agent',
        task: `${tool} ${target}${reason && reason !== 'manual security check' ? ' — ' + reason : ''}`.slice(0, 240),
        mode: 'visible', status: 'started',
      });
      const scanStart = Date.now();

      try {
        let result;
        if (tool === 'nmap' || tool === 'zenmap') {
          // nmap scan — zenmap is just a GUI wrapper, use nmap CLI directly
          result = await linuxAgent.investigate({ category: 'network_scan', source: target, detail: reason });
        } else if (tool === 'wireshark') {
          // tcpdump loopback snapshot as Wireshark replacement
          result = await linuxAgent.trafficSnapshot();
          result = { ok: result.ok, summary: result.raw, elapsed: 5000, steps: [{ label: 'tcpdump loopback', output: result.raw }] };
        } else {
          result = await linuxAgent.perimeterPatrol();
          result = { ok: result.ok, summary: result.summary, elapsed: result.elapsed, steps: [] };
        }

        pcActivity.record({
          id: scanActivity.id, npc: 'Bouncer', kind: 'linux-agent',
          task: scanActivity.task, mode: scanActivity.mode,
          status: result.ok ? 'done' : 'failed',
          durationMs: Date.now() - scanStart,
          detail: (result.summary || '').slice(0, 240) || null,
        });

        bcast({
          type: 'bouncer_tool_status', tool,
          status: result.ok ? 'done' : 'error',
          threat: { category: 'manual', source: target, detail: reason },
          steps: result.steps?.length,
          message: result.ok
            ? `${tool} complete (${((result.elapsed || 0) / 1000).toFixed(1)}s) — ${(result.summary || '').slice(0, 120)}`
            : `${tool} failed`,
        });

        console.log(`[BouncerScan] ${tool} on ${target}: ${result.ok ? 'ok' : 'failed'}`);
      } catch (err) {
        pcActivity.record({
          id: scanActivity.id, npc: 'Bouncer', kind: 'linux-agent',
          task: scanActivity.task, mode: scanActivity.mode,
          status: 'failed', durationMs: Date.now() - scanStart,
          detail: String(err?.message || err).slice(0, 240),
        });
        console.error(`[bouncer-scan] ${tool} error:`, err?.message);
        bcast({ type: 'bouncer_tool_status', tool, status: 'error',
          threat: { category: 'manual', source: target, detail: reason },
          message: `${tool} threw: ${err?.message}` });
      }
    });
    return;
  }

  // --- Lucy job pipeline (scrape → filter → resume → cover → apply) ---
  // POST /api/lucy-job-pipeline { query, site, pages, remoteOnly, minSalary }
  // Runs Lucy's full pipeline and returns the summary string.
  if (urlPath === '/api/lucy-job-pipeline' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }

      // PC activity: manual operator-triggered pipeline run.
      const jpActivity = pcActivity.record({
        npc: 'Lucy', kind: 'job-pipeline',
        task: `${payload.query || 'software engineer'} on ${payload.site || 'linkedin'}`,
        mode: 'visible', status: 'started',
      });
      const jpStart = Date.now();
      try {
        const summary = await jobApplication.runJobPipeline({
          query:      payload.query      || 'software engineer',
          site:       payload.site       || 'linkedin',
          pages:      Number(payload.pages || 2),
          remoteOnly: Boolean(payload.remoteOnly),
          minSalary:  Number(payload.minSalary || 0),
        });
        pcActivity.record({
          id: jpActivity.id, npc: 'Lucy', kind: 'job-pipeline',
          task: jpActivity.task, mode: 'visible', status: 'done',
          durationMs: Date.now() - jpStart,
          detail: String(summary).slice(0, 240),
        });
        try { worldState.pushEvent('job-pipeline', `Lucy: ${summary}`); } catch (_) {}
        try {
          cofounderAgent.wsClients.forEach(ws => {
            if (ws.readyState !== 1) return;
            try { ws.send(JSON.stringify({ type: 'lucy_job_pipeline_done', summary })); } catch (_) {}
          });
        } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, summary }));
      } catch (err) {
        pcActivity.record({
          id: jpActivity.id, npc: 'Lucy', kind: 'job-pipeline',
          task: jpActivity.task, mode: 'visible', status: 'failed',
          durationMs: Date.now() - jpStart,
          detail: String(err?.message || err).slice(0, 240),
        });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
      }
    });
    return;
  }

  // --- Bouncer Linux terminal (Kali WSL investigation) ---
  // POST /api/bouncer-linux { category?, source?, detail?, openTerminal?: bool }
  // Runs real security commands in Kali WSL and streams results via WS.
  if (urlPath === '/api/bouncer-linux' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }

      const broadcast = (msg) => cofounderAgent.wsClients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(msg)); });
      const threat = {
        category: payload.category || 'unknown',
        source:   payload.source   || null,
        detail:   payload.detail   || payload.category || 'manual investigation',
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, async: true, note: 'Bouncer is running Kali Linux commands — watch your chat.' }));

      broadcast({ type: 'bouncer_linux_status', status: 'starting', threat, message: `Bouncer opened a Kali Linux terminal to investigate ${threat.category}...` });

      // Open a real visible terminal window so the player can watch Bouncer work.
      // Uses _openBouncerTerminal (direct spawn) — never types into the focused window.
      const openTerminal = payload.openTerminal !== false;
      if (openTerminal) {
        _openBouncerTerminal(_buildTerminalShowCmd(threat));
      }

      // PC activity: bouncer-linux endpoint = linux-agent run.
      // mode = 'visible' when a terminal window is spawned, else 'background'.
      const blActivity = pcActivity.record({
        npc: 'Bouncer', kind: 'linux-agent',
        task: `investigate ${threat.category}${threat.source ? ' (' + threat.source + ')' : ''}`,
        mode: openTerminal ? 'visible' : 'background',
        status: 'started',
      });
      const blStart = Date.now();

      // Run the actual investigation in parallel
      linuxAgent.investigate(threat).then(result => {
        pcActivity.record({
          id: blActivity.id, npc: 'Bouncer', kind: 'linux-agent',
          task: blActivity.task, mode: blActivity.mode,
          status: result.ok ? 'done' : 'failed',
          durationMs: Date.now() - blStart,
          detail: (result.summary || result.error || '').slice(0, 240) || null,
        });
        broadcast({
          type: 'bouncer_linux_result',
          status: result.ok ? 'done' : 'error',
          threat,
          category: result.category,
          ip: result.ip,
          elapsed: result.elapsed,
          steps: result.steps,
          summary: result.summary,
          message: result.ok
            ? `Kali investigation complete (${(result.elapsed / 1000).toFixed(1)}s, ${result.steps.length} commands).`
            : `Linux investigation failed: ${result.error}`,
        });
      }).catch(err => {
        pcActivity.record({
          id: blActivity.id, npc: 'Bouncer', kind: 'linux-agent',
          task: blActivity.task, mode: blActivity.mode,
          status: 'failed', durationMs: Date.now() - blStart,
          detail: String(err?.message || err).slice(0, 240),
        });
        broadcast({ type: 'bouncer_linux_result', status: 'error', threat, message: `WSL error: ${err.message}` });
      });
    });
    return;
  }

  // --- Job applications (Lucy applies on behalf of CEO) ---
  if (urlPath === '/api/job-apply' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }

      const result = await jobApplication.applyToJob(
        {
          npcBrains,
          gmailClient,
          broadcast: (msg) => cofounderAgent.wsClients.forEach(ws => {
            if (ws.readyState === 1) ws.send(JSON.stringify(msg));
          }),
        },
        {
          applyEmail:   payload.applyEmail,
          applyUrl:     payload.applyUrl,
          jobTitle:     payload.jobTitle,
          company:      payload.company,
          description:  payload.description,
          requirements: payload.requirements,
          provider:     payload.provider || null,  // 'anthropic' | 'kimi' | null (auto)
        },
        {
          // fullAI=true: ask Ministral 14B to write the whole letter (~60-120s)
          // fullAI=false (default): template + LLaMA 8B opener (~3-8s)
          fullAI: payload.fullAI === true,
        }
      );
      try { worldState.pushEvent('job-apply', `Lucy applied to ${payload.jobTitle} at ${payload.company}`); } catch (_) {}
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // --- LLM telemetry endpoints ---
  // Real observability into LM Studio + every other LLM provider call.
  // Each call records: npc, kind, provider, model, latencyMs, tokens
  // in/out, prompt/response preview, error+hint.
  if (urlPath === '/api/telemetry/llm' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const opts = {
      limit: Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 50))),
      kind: url.searchParams.get('kind') || null,
      npc: url.searchParams.get('npc') || null,
      provider: url.searchParams.get('provider') || null,
      sinceMs: url.searchParams.get('sinceMs') ? Number(url.searchParams.get('sinceMs')) : null,
      errorsOnly: url.searchParams.get('errorsOnly') === 'true',
      sort: url.searchParams.get('sort') || 'newest',
    };
    const calls = llmTelemetry.getRecent(opts);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ calls, queryOpts: opts }));
    return;
  }
  if (urlPath === '/api/telemetry/llm/stats' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const windowMs = Number(url.searchParams.get('windowMs') || 5 * 60 * 1000);
    const stats = llmTelemetry.getStats({ windowMs });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }
  if (urlPath === '/api/telemetry/llm/errors' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const errors = llmTelemetry.getRecentErrors({ limit });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errors }));
    return;
  }

  // --- OpenClaw telemetry: browser dispatcher posts events here ---
  if (urlPath === '/api/telemetry/openclaw' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      try {
        const rec = llmTelemetry.recordOpenClaw({
          tool:          String(payload.tool || 'unknown').slice(0, 80),
          args:          payload.args || null,
          status:        ['started', 'succeeded', 'failed'].indexOf(payload.status) !== -1 ? payload.status : 'unknown',
          latencyMs:     Number.isFinite(payload.latencyMs) ? payload.latencyMs : undefined,
          response:      payload.response || null,
          error:         payload.error ? { message: String(payload.error).slice(0, 600) } : null,
          source:        String(payload.source || 'openclaw').slice(0, 40),
          correlationId: payload.correlationId || null,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: rec.id }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err?.message || err) }));
      }
    });
    return;
  }
  if (urlPath === '/api/telemetry/openclaw/stats' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const windowMs = Number(url.searchParams.get('windowMs') || 5 * 60 * 1000);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(llmTelemetry.getOpenClawStats({ windowMs })));
    return;
  }
  if (urlPath === '/api/telemetry/openclaw' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ events: llmTelemetry.getRecentOpenClaw({ limit }) }));
    return;
  }

  // --- LLM decision histogram (what NPCs are actually choosing) ---
  // Extracts the `action` (and optional `skill`) field from every
  // `think` call's responsePreview in the rolling window. Lets the panel
  // show "12 chat · 4 run_skill · 2 meeting" instead of just call counts.
  if (urlPath === '/api/telemetry/llm/decisions' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const windowMs = Number(url.searchParams.get('windowMs') || 5 * 60 * 1000);
    const stats = llmTelemetry.getDecisionStats({ windowMs });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }

  // --- PC activity tracker endpoints ---
  // The PC activity ring buffer records every real PC-side task an NPC
  // runs — skills, desktop-agent, coding-agent, linux-agent (Bouncer),
  // job-pipeline (Lucy). Read-only.
  if (urlPath === '/api/pc-activity' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    const npc    = url.searchParams.get('npc')    || undefined;
    const kind   = url.searchParams.get('kind')   || undefined;
    const status = url.searchParams.get('status') || undefined;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ events: pcActivity.getRecent({ limit, npc, kind, status }) }));
    return;
  }
  if (urlPath === '/api/pc-activity/stats' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const windowMs = Number(url.searchParams.get('windowMs') || 5 * 60 * 1000);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(pcActivity.getStats({ windowMs })));
    return;
  }
  if (urlPath === '/api/pc-activity/active' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ active: pcActivity.getActive() }));
    return;
  }

  // ─── Market / Robinhood endpoints ────────────────────────────────────────────
  // Auth status
  if (urlPath === '/api/market/auth-status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      authenticated: robinhoodMcp.isAuthenticated(),
      clientId: robinhoodMcp.getClientId() || null,
      note: robinhoodMcp.isAuthenticated()
        ? 'Robinhood connected. Roki is watching the market.'
        : 'Not connected. Visit /api/market/auth/connect to log in with Robinhood.',
    }));
    return;
  }

  // OAuth2 PKCE initiation — redirect user to Robinhood login
  if (urlPath === '/api/market/auth/connect' && req.method === 'GET') {
    robinhoodMcp.buildAuthUrl()
      .then(authUrl => {
        res.writeHead(302, { Location: authUrl });
        res.end();
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Auth setup failed: ${err.message}`);
      });
    return;
  }

  // OAuth2 callback — exchange code for tokens
  if (urlPath.startsWith('/api/market/auth/callback') && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const code  = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error || !code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`<h2>Robinhood auth failed</h2><p>${error || 'No code received'}</p><p><a href="/api/market/auth/connect">Try again</a></p>`);
      return;
    }

    robinhoodMcp.handleCallback(code, state)
      .then(() => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><head><style>
          body{font-family:monospace;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
          .box{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px;max-width:400px;text-align:center}
          h2{color:#86efac;margin:0 0 12px} p{color:#94a3b8;margin:0 0 8px} a{color:#93c5fd}
        </style></head><body><div class="box">
          <h2>✓ Robinhood Connected</h2>
          <p>Roki is now watching the market.</p>
          <p>Close this tab and head back to the office.</p>
          <p style="margin-top:16px"><a href="http://localhost:8080">← Return to Denizen</a></p>
        </div></body></html>`);
        if (agentWss) agentWss.clients.forEach(c => {
          if (c.readyState === 1) c.send(JSON.stringify({ type: 'market_auth_connected', ts: Date.now() }));
        });
        log.info('Market', 'Robinhood OAuth connected — Roki activated');
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h2>Token exchange failed</h2><p>${err.message}</p><p><a href="/api/market/auth/connect">Try again</a></p>`);
      });
    return;
  }

  // Live market data (proxied through server so auth token stays server-side)
  if (urlPath === '/api/market/quote' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const symbols = (url.searchParams.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'symbols param required, e.g. ?symbols=NVDA,TSLA' }));
      return;
    }
    robinhoodMcp.getQuote(symbols)
      .then(data => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); })
      .catch(err => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
    return;
  }
  if (urlPath === '/api/market/portfolio' && req.method === 'GET') {
    robinhoodMcp.getPortfolio()
      .then(data => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); })
      .catch(err => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
    return;
  }
  if (urlPath === '/api/market/positions' && req.method === 'GET') {
    robinhoodMcp.getPositions()
      .then(data => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); })
      .catch(err => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
    return;
  }

  // Watchlist management
  if (urlPath === '/api/market/watchlist' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ symbols: robinhoodMcp.loadWatchlist() }));
    return;
  }
  if (urlPath === '/api/market/watchlist' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { action, symbol } = JSON.parse(body);
        let symbols;
        if (action === 'add') symbols = robinhoodMcp.addToWatchlist(symbol);
        else if (action === 'remove') symbols = robinhoodMcp.removeFromWatchlist(symbol);
        else { res.writeHead(400); res.end(JSON.stringify({ error: 'action must be add|remove' })); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, symbols }));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // Trade suggestions — display only, no execution
  if (urlPath === '/api/trade-suggestions' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ suggestions: robinhoodMcp.loadSuggestions() }));
    return;
  }
  if (/^\/api\/trade-suggestions\/([^/]+)\/dismiss$/.test(urlPath) && req.method === 'POST') {
    const id = urlPath.split('/')[3];
    const entry = robinhoodMcp.dismissSuggestion(id);
    res.writeHead(entry ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(entry ? { ok: true, entry } : { error: 'not found' }));
    return;
  }

  // --- World-state snapshot (read-only) ---
  // Useful for debugging and for the n8n/Supabase integration to know what
  // the office "looks like" before posting an update.
  if (urlPath === '/api/world-state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(worldState.snapshot()));
    return;
  }

  // --- Presence flag (Zion at the keyboard) ---
  // GET returns the current value; POST { present: bool } toggles it.
  // The voice gate in the browser reads this on every speech bubble — when
  // false, bubbles still render but no audio fires.
  if (urlPath === '/api/presence' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ zionPresent: worldState.zionPresent }));
    return;
  }
  if (urlPath === '/api/presence' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        const next = worldState.setPresence(!!payload.present);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, zionPresent: next }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- Assistant profile: persistent user/project memory + autonomy policy ---
  if (urlPath === '/api/assistant-profile' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(npcBrains.getAssistantProfile()));
    return;
  }

  if (urlPath === '/api/assistant-profile' && req.method === 'POST') {
    (async () => {
      const patch = await _readJsonBody(req, 2 * 1024 * 1024);
      const updated = npcBrains.updateAssistantProfile(patch || {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, profile: updated }));
    })().catch((err) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // --- Task webhook (n8n / Supabase / external workflows post here) ---
  // Body shape: { id, source?, title, status?, assignee?, detail?, foreground? }
  // We upsert into worldState; the change event then fans out to the browser
  // and the next NPC think cycle picks it up via the Current State block.
  if (urlPath === '/api/task-update' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const task = JSON.parse(body || '{}');
        if (!task || typeof task !== 'object' || !task.id || !task.title) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'task requires { id, title }' }));
          return;
        }
        const foreground = !!task.foreground;
        const merged = worldState.upsertTask({
          id: String(task.id),
          source: task.source || 'external',
          title: String(task.title).slice(0, 200),
          status: task.status || 'queued',
          assignee: task.assignee || null,
          detail: task.detail ? String(task.detail).slice(0, 400) : null,
        }, { foreground });
        // Also surface as an office event so NPCs notice immediately.
        worldState.pushEvent('task', `${merged.status}: ${merged.title}${merged.assignee ? ' → ' + merged.assignee : ''}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, task: merged }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- Agent-bus publish (let external systems poke a specific NPC) ---
  // POST body: { to, from?, text, kind? }
  if (urlPath === '/api/agent-bus' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const msg = agentBus.publish(payload.to, {
          from: payload.from || 'external',
          text: String(payload.text || '').slice(0, 600),
          kind: payload.kind || 'speak',
        });
        if (!msg) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'requires { to, text }' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, msg }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- GET /api/code-proposals — list all NPC code proposals ---
  if (urlPath === '/api/code-proposals' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ proposals: codingTaskRunner.getProposals() }));
    return;
  }

  // --- POST /api/code-proposals/:id/approve ---
  const approveMatch = urlPath.match(/^\/api\/code-proposals\/([^/]+)\/approve$/);
  if (approveMatch && req.method === 'POST') {
    const proposalId = approveMatch[1];
    codingTaskRunner.approveProposal(proposalId).then(result => {
      if (result.ok) {
        const raw = JSON.stringify({ type: 'npc_code_proposal_approved', proposalId });
        (agentWss ? agentWss.clients : new Set()).forEach(c => { if (c.readyState === 1) c.send(raw); });
      }
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  // --- POST /api/code-proposals/:id/reject ---
  const rejectMatch = urlPath.match(/^\/api\/code-proposals\/([^/]+)\/reject$/);
  if (rejectMatch && req.method === 'POST') {
    const proposalId = rejectMatch[1];
    codingTaskRunner.rejectProposal(proposalId).then(result => {
      if (result.ok) {
        const raw = JSON.stringify({ type: 'npc_code_proposal_rejected', proposalId });
        (agentWss ? agentWss.clients : new Set()).forEach(c => { if (c.readyState === 1) c.send(raw); });
      }
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  // --- Office health (one-shot diagnostic the client polls every few seconds) ---
  // Reports: WS clients connected, LM Studio reachability, which providers
  // are configured (names only — never keys), recent provider errors, and
  // last successful think+chat timestamps. Designed to answer the question
  // "why isn't the NPC responding when I talk to it?" without the user
  // needing terminal access.
  if (urlPath === '/api/health' && req.method === 'GET') {
    (async () => {
      // LIVENESS, NOT JUST REACHABILITY.
      //
      // Earlier the health probe lied because LM Studio's single-threaded
      // HTTP server queues incoming requests behind the chat completions
      // that are already running. When 16 NPCs are autonomously thinking
      // back-to-back at full GPU saturation, even a cheap GET /v1/models
      // can wait 4-8 seconds before LM Studio gets to it. A 5s probe
      // timeout fires first → probe reports "unreachable" → user thinks
      // LM Studio is down even though it's actively processing requests.
      //
      // The truth source is whether the brain is actually completing
      // requests, which we already track in _npcStats. If a brain call
      // succeeded in the last 30 seconds, LM Studio is alive — period.
      // Run the probe ONLY as a fallback when we have no recent brain
      // activity to vouch for it.
      const lmCfg = npcBrains.providers?.lmstudio || {};
      const lmStudioUrl = lmCfg.baseUrl || process.env.LM_STUDIO_URL || 'http://localhost:1234';
      const lmHeaders = {};
      if (lmCfg.apiKey) lmHeaders.Authorization = `Bearer ${lmCfg.apiKey}`;

      // Truth source for "is LM Studio alive": ANY successful provider
      // call counts. Captured inside _callLocal so it covers autonomous
      // think() loops too (which never go through the WS handlers and
      // therefore weren't reflected by the WS-only counters).
      const stats = global._npcStats || {};
      const lastBrainOk = Math.max(
        stats.lastProviderOkAt || 0,
        stats.lastNpcConvAt || 0,
        stats.lastPlayerChatAt && stats.playerChatSucceeded > 0 ? stats.lastPlayerChatAt : 0,
      );
      const now = Date.now();
      const recentBrainOk = lastBrainOk && (now - lastBrainOk) < 30000;

      let lmStudioStatus = {
        reachable: false,
        url: lmStudioUrl,
        error: null,
        model: lmCfg.model || null,
        livenessSource: null,
      };

      if (recentBrainOk) {
        // Don't even bother probing — we have proof LM Studio is alive.
        const ago = Math.round((now - lastBrainOk) / 1000);
        lmStudioStatus.reachable = true;
        lmStudioStatus.livenessSource = `brain call succeeded ${ago}s ago`;
      } else {
        // No recent activity — fall back to direct probe with a longer
        // timeout that tolerates a saturated GPU. Try 3 paths; accept a
        // 401/403 as "server is up, just auth-blocked."
        const probes = ['/v1/models', '/api/v0/models', '/'];
        const errors = [];
        for (const path of probes) {
          try {
            const probe = await fetch(`${lmStudioUrl}${path}`, {
              method: 'GET',
              headers: lmHeaders,
              signal: AbortSignal.timeout(15000),
            });
            if (probe.ok || probe.status === 401 || probe.status === 403) {
              lmStudioStatus.reachable = true;
              lmStudioStatus.probedPath = path;
              lmStudioStatus.livenessSource = `probe ${path} ok`;
              if (!probe.ok) lmStudioStatus.warning = `${path} HTTP ${probe.status} (auth issue, but server is up)`;
              break;
            }
            errors.push(`${path}: HTTP ${probe.status}`);
          } catch (err) {
            errors.push(`${path}: ${err?.message || String(err)}`);
          }
        }
        if (!lmStudioStatus.reachable) {
          lmStudioStatus.error = errors.join('; ');
        }
      }

      const providers = Object.entries(npcBrains.providers || {})
        .filter(([k]) => k !== 'demo')
        .map(([name, cfg]) => ({ name, type: cfg.type, model: cfg.model || null }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        ts: Date.now(),
        lmStudio: lmStudioStatus,
        providers,
        demoMode: !!npcBrains._demoMode,
        wsClients: {
          agent: cofounderAgent.wsClients.size,
          security: securityMonitor.clients?.size || 0,
        },
        stats: global._npcStats,
        recentErrors: (global._npcRecentErrors || []).slice(-5),
      }));
    })().catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // --- TTS health (cheap probe — does this server have ElevenLabs configured?) ---
  // The client uses this to decide whether to wire the ElevenLabs voice
  // provider. Returns the key SOURCE but never the value.
  if (urlPath === '/api/tts/health' && req.method === 'GET') {
    const status = elevenLabs.status();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...status,
      voiceMapEntries: Object.keys(_voiceMap.npcs || {}).length,
    }));
    return;
  }

  // --- STT health (server-side fallback transcription capability) ---
  // Client uses this when browser SpeechRecognition is missing (Brave/Simple Browser).
  if (urlPath === '/api/stt/health' && req.method === 'GET') {
    const stt = _resolveSttConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      configured: stt.configured,
      provider: 'openai-whisper',
      model: stt.model,
      source: stt.source,
      maxAudioBytes: STT_MAX_AUDIO_BYTES,
    }));
    return;
  }

  // --- STT: transcribe uploaded audio ---
  // POST body: { audioBase64, mimeType?, lang? }
  // Returns: { text }
  if (urlPath === '/api/stt' && req.method === 'POST') {
    (async () => {
      const stt = _resolveSttConfig();
      if (!stt.configured) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'STT not configured. Set OPENAI_WHISPER_API_KEY or OPENAI_API_KEY on the server.',
        }));
        return;
      }

      const payload = await _readJsonBody(req, 32 * 1024 * 1024);
      const audioBase64 = String(payload.audioBase64 || '').trim();
      const mimeType = String(payload.mimeType || 'audio/webm').trim();
      const language = String(payload.lang || '').trim();

      if (!audioBase64) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'audioBase64 is required' }));
        return;
      }

      let audio;
      try {
        audio = Buffer.from(audioBase64, 'base64');
      } catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'audioBase64 is not valid base64' }));
        return;
      }

      if (!audio.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'audio payload is empty' }));
        return;
      }
      if (audio.length > STT_MAX_AUDIO_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `audio too large (${audio.length} bytes)` }));
        return;
      }

      const ext = mimeType.includes('wav') ? 'wav'
        : mimeType.includes('mp4') ? 'm4a'
          : mimeType.includes('mpeg') ? 'mp3'
            : 'webm';

      const fields = [
        { name: 'model', value: stt.model },
        { name: 'response_format', value: 'json' },
        {
          name: 'file',
          filename: `denizen-stt.${ext}`,
          contentType: mimeType || 'audio/webm',
          value: audio,
        },
      ];
      if (language) {
        fields.push({ name: 'language', value: language });
      }

      const mp = _buildMultipartForm(fields);
      const upstream = await fetch(`${stt.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stt.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${mp.boundary}`,
        },
        body: mp.body,
        signal: AbortSignal.timeout(45000),
      });

      const raw = await upstream.text();
      if (!upstream.ok) {
        let detail = raw;
        try {
          const j = JSON.parse(raw);
          detail = j?.error?.message || j?.message || raw;
        } catch (_) {}
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `STT upstream error: ${detail}` }));
        return;
      }

      let text = '';
      try {
        const j = JSON.parse(raw);
        text = String(j?.text || '').trim();
      } catch (_) {
        text = String(raw || '').trim();
      }

      if (!text) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: '', warning: 'empty transcript' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    });
    return;
  }

  // --- TTS: synthesize speech for an NPC and stream MP3 back ---
  // POST body: { npcName?, text, voiceId?, modelId? }
  // The voice gate (browser) calls this; we proxy to ElevenLabs server-side
  // so the API key never touches the browser. NPC name maps via voice-map.json.
  if (urlPath === '/api/tts' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const text = String(payload.text || '').slice(0, 4000);
      if (!text.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'text is required' }));
        return;
      }
      const npcEntry = (payload.npcName && _voiceMap.npcs?.[payload.npcName]) || {};
      const voiceId = payload.voiceId || npcEntry.voiceId || _voiceMap.default?.voiceId;
      const modelId = payload.modelId || npcEntry.modelId || _voiceMap.default?.modelId;

      try {
        await elevenLabs.synthesize({ text, voiceId, modelId }, res);
        // Streaming complete; nothing else to send.
      } catch (err) {
        // Headers may or may not be sent depending on whether the failure
        // happened before or after upstream returned 200. Guard both paths.
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        } else {
          try { res.end(); } catch (_) {}
        }
      }
    });
    return;
  }

  // --- LLM-backed city plan ---
  // POST body: { prompt, seed?, gridW?, gridH?, provider? }
  // Reuses NpcBrainManager's provider clients so we don't reimplement
  // five HTTP integrations. The model is asked for a JSON-only response;
  // we parse, validate shape, and fall back to the heuristic on any
  // failure (no LLM, malformed JSON, missing zones field). The planner
  // module itself calls into this endpoint when CITY_PLAN_PROVIDER is set
  // — see src/city/planner.js.
  if (urlPath === '/api/llm-city-plan' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const prompt = String(payload.prompt || '').slice(0, 1000);
      const seed = String(payload.seed || 'city-plan').slice(0, 80);
      const gridW = Math.max(1, Math.min(20, parseInt(payload.gridW, 10) || 5));
      const gridH = Math.max(1, Math.min(20, parseInt(payload.gridH, 10) || 3));

      // Pick a provider. Order: explicit body.provider → env → first available.
      const providerKey = payload.provider
        || process.env.CITY_PLAN_PROVIDER
        || ['claude', 'grok', 'gemini', 'kimi', 'lmstudio'].find(k => npcBrains.providers[k]);
      const providerConfig = providerKey ? npcBrains.providers[providerKey] : null;

      const heuristic = () => {
        // .cjs extension forces CommonJS even though src/city/ is an ESM
        // folder (package.json type:module). Keep the lazy require here so
        // boot stays fast.
        const { planCityZones } = require('./src/city/planner-heuristic.cjs');
        const plan = planCityZones({ prompt, seed, gridW, gridH });
        return { ...plan, source: 'heuristic' };
      };

      if (!providerConfig || providerConfig.type === 'demo') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(heuristic()));
        return;
      }

      const system = [
        'You are a city planner. Given a free-form prompt and a grid size W x H, return ONE JSON object and NOTHING ELSE.',
        'Shape: { "zones": [ { "zone": "downtown"|"residential"|"industrial"|"park", "rect": { "x": int, "y": int, "w": int, "h": int } }, ... ] }.',
        'Constraints: 0 <= x < W, 0 <= y < H, x+w <= W, y+h <= H, no zones may overlap, every cell must be covered.',
        'No prose. No markdown. Just the JSON object.',
      ].join('\n');
      const userMsg = `Prompt: ${prompt || '(none — invent a coherent small city)'}\nW=${gridW} H=${gridH}\nReturn the JSON now.`;

      try {
        const raw = await npcBrains._callProvider(providerConfig, system,
          [{ role: 'user', content: userMsg }],
          { maxTokens: 800, sliceLen: 1200, temperature: 0.5 });
        const match = String(raw || '').match(/\{[\s\S]*\}/);
        const parsed = match ? JSON.parse(match[0]) : null;
        if (!parsed || !Array.isArray(parsed.zones)) {
          throw new Error('LLM did not return { zones: [] }');
        }
        // Light validation — clamp every rect into bounds; drop bad entries.
        const clean = parsed.zones
          .filter(z => z && z.rect && typeof z.zone === 'string')
          .map(z => ({
            zone: z.zone,
            rect: {
              x: Math.max(0, Math.min(gridW - 1, parseInt(z.rect.x, 10) || 0)),
              y: Math.max(0, Math.min(gridH - 1, parseInt(z.rect.y, 10) || 0)),
              w: Math.max(1, parseInt(z.rect.w, 10) || 1),
              h: Math.max(1, parseInt(z.rect.h, 10) || 1),
            },
          }));
        if (clean.length === 0) throw new Error('All LLM zones invalid');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ seed, gridW, gridH, zones: clean, source: providerKey }));
      } catch (err) {
        console.warn(`[CityPlan] LLM failed (${err.message}) — falling back to heuristic`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(heuristic()));
      }
    });
    return;
  }

  // --- Full city generation (planner → chunk → optional interior) as JSON ---
  // Query: ?seed=…&prompt=…&width=…&height=…&roadStride=…&chunkX=…&chunkY=…
  // Returns the same data the in-game phaserAdapter consumes — useful for
  // a debug overlay (?debug=city) and for headless snapshot tests.
  // Implementation uses dynamic import() because city/* are ES modules.
  if (urlPath === '/api/generate-city' && req.method === 'GET') {
    const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const seed = params.get('seed') || 'office-demo';
    const prompt = params.get('prompt') || '';
    const width = Math.max(8, Math.min(256, parseInt(params.get('width'), 10) || 48));
    const height = Math.max(8, Math.min(256, parseInt(params.get('height'), 10) || 48));
    const roadStride = Math.max(2, Math.min(32, parseInt(params.get('roadStride'), 10) || 8));
    const chunkX = parseInt(params.get('chunkX'), 10) || 0;
    const chunkY = parseInt(params.get('chunkY'), 10) || 0;

    (async () => {
      try {
        // Dynamic ESM import — these modules use `import/export`.
        const cityMod = await import('./src/city/cityGenerator.js');
        const interiorMod = await import('./src/city/interiorGenerator.js');
        const plannerMod = await import('./src/city/planner.js');

        // Plan (LLM if available, heuristic otherwise — planner module
        // honors CITY_PLAN_PROVIDER + the /api/llm-city-plan endpoint when
        // running in the browser; on the server we just call the local
        // heuristic to keep this endpoint sync-cheap for snapshots).
        const plan = plannerMod.planCityZones({ seed, prompt, gridW: 4, gridH: 3 });
        const chunk = cityMod.generateCityChunk({ seed, chunkX, chunkY, width, height, roadStride });
        const interior = chunk.buildings && chunk.buildings[0]
          ? interiorMod.generateOfficeInterior({
              seed: `${seed}:${chunk.buildings[0].id}`,
              buildingId: chunk.buildings[0].id,
              width: 24,
              height: 16,
            })
          : null;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ plan, chunk, sampleInterior: interior }));
      } catch (err) {
        console.warn('[GenerateCity] failed:', err?.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
    })();
    return;
  }

  // --- Security test endpoint: simulate threats for testing ---
  if (urlPath === '/security-test') {
    const category = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('type') || 'network_scan';
    const severity = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('severity') || 'medium';
    const detail = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('detail') || `Test ${category} threat`;

    securityMonitor._emitThreat({
      category,
      severity,
      source: 'test',
      target: 'test-target',
      detail,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: `Simulated ${category} threat` }));
    return;
  }

  // Default to the game's index.html — also accept legacy /denizen/ and
  // /pixel-office-game/ prefixes so old bookmarks keep working.
  if (urlPath === '/' || urlPath === '/denizen/' || urlPath === '/denizen'
      || urlPath === '/pixel-office-game/' || urlPath === '/pixel-office-game') {
    urlPath = '/index.html';
  }
  // Backwards-compat: this project was once served from a parent folder
  // with index.html using `<base href="/pixel-office-game/">`, and later
  // briefly under `/denizen/`. The base tag is gone, but stripping the
  // legacy prefixes keeps old bookmarks and external links working.
  if (urlPath.startsWith('/denizen/')) {
    urlPath = urlPath.replace('/denizen', '');
  } else if (urlPath.startsWith('/pixel-office-game/')) {
    urlPath = urlPath.replace('/pixel-office-game', '');
  }
  const filePath = path.resolve(ROOT, `.${urlPath}`);
  const relativePath = path.relative(ROOT, filePath);

  // Prevent directory traversal above ROOT
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    res.writeHead(403);
    res.end('Forbidden');
    // This itself is a threat!
    securityMonitor._emitThreat({
      category: 'file_access',
      severity: 'high',
      source: req.socket?.remoteAddress || 'unknown',
      target: urlPath,
      detail: `Directory traversal blocked: ${urlPath.slice(0, 60)}`,
    });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// --- WebSocket Servers (using 'ws' package) ---

// Security Monitor WebSocket
const securityWss = new WebSocketServer({ noServer: true });
securityWss.on('connection', (ws) => {
  console.log('[SecurityMonitor] WS client connected');
  securityMonitor.addClient(ws);
  ws.on('close', () => {
    console.log('[SecurityMonitor] WS client disconnected');
    securityMonitor.clients?.delete(ws);
  });
  ws.on('error', () => {
    securityMonitor.clients?.delete(ws);
  });
});

// Agent Office WebSocket
const agentWss = new WebSocketServer({ noServer: true });
agentWss.on('connection', (ws) => {
  console.log(`[CofounderAgent] WS client connected (${cofounderAgent.wsClients.size + 1} total)`);
  cofounderAgent.addClient(ws);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'npc_conversation') {
        // Resolve the NPC name case-insensitively — cofounder dispatch and
        // LM Studio replies sometimes return lowercased or title-cased names.
        let resolvedName = null;
        if (typeof msg.npcName === 'string' && msg.npcName) {
          if (npcBrains.brains[msg.npcName]) {
            resolvedName = msg.npcName;
          } else {
            const lower = msg.npcName.toLowerCase();
            resolvedName = Object.keys(npcBrains.brains).find(n => n.toLowerCase() === lower) || null;
          }
        }
        if (!resolvedName) {
          // Throttle warning — cofounder dispatch floods this otherwise.
          const now = Date.now();
          if (!global._lastUnknownNpcWarn || now - global._lastUnknownNpcWarn > 30000) {
            console.warn(`[AgentWS] npc_conversation: unknown npcName "${msg.npcName}" (further warnings throttled 30s)`);
            global._lastUnknownNpcWarn = now;
          }
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'npc_response',
              npcName: typeof msg.npcName === 'string' && msg.npcName ? msg.npcName : 'Unknown',
              fromName: typeof msg.fromName === 'string' ? msg.fromName : '',
              text: '(No reply right now.)',
              turn: typeof msg.turn === 'number' ? msg.turn : 1,
            }));
          }
          return;
        }
        // Normalize the name going forward so downstream code looks up the right brain.
        msg.npcName = resolvedName;
        if (typeof msg.text !== 'string' || !msg.text.trim()) {
          console.warn('[AgentWS] npc_conversation: invalid text payload');
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'npc_response',
              npcName: msg.npcName,
              fromName: msg.fromName,
              text: '(No reply right now.)',
              turn: typeof msg.turn === 'number' ? msg.turn : 1,
            }));
          }
          return;
        }
        // Route to individual NPC brain for a personalized response
        global._npcStats.npcConvReceived++;
        global._npcStats.lastNpcConvAt = Date.now();
        npcBrains.getResponse(msg.npcName, msg.fromName, msg.text, msg.context || {})
          .then(response => {
            global._npcStats.npcConvSucceeded++;
            const reply = JSON.stringify({
              type: 'npc_response',
              npcName: msg.npcName,
              fromName: msg.fromName,
              text: response,
              turn: typeof msg.turn === 'number' ? msg.turn : 1,
            });
            if (ws.readyState === 1) ws.send(reply);
            // Save significant conversations to MEMORY.md
            npcBrains.saveMemory(msg.npcName, `${msg.fromName} said: "${msg.text}" — I replied: "${response}"`);
          })
          .catch(err => {
            global._npcStats.npcConvFailed++;
            const errMsg = String(err?.message ?? err);
            console.warn('[NpcBrains] Response error:', errMsg);
            _recordNpcError(`getResponse(${msg.npcName} ← ${msg.fromName}): ${errMsg}`);
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'npc_response',
                npcName: msg.npcName,
                fromName: msg.fromName,
                text: '(No reply right now.)',
                turn: typeof msg.turn === 'number' ? msg.turn : 1,
              }));
            }
          });
      } else if (msg.type === 'npc_think') {
        // NPC is asking "what should I do next?"
        npcBrains.think(msg.npcName, msg.context || {})
          .then(decision => {
            // Send the main decision
            const reply = JSON.stringify({
              type: 'npc_decision',
              npcName: msg.npcName,
              decision,
            });
            if (ws.readyState === 1) ws.send(reply);

            // Broadcast work output to all clients when an NPC starts or finishes a task
            if (decision.save && decision.taskPhase && decision.taskPhase !== 'none') {
              const phaseEmoji = { starting: '▶', continuing: '⟳', finished: '✓' }[decision.taskPhase] || '•';
              const workMsg = JSON.stringify({
                type: 'npc_work_output',
                npcName: msg.npcName,
                phase: decision.taskPhase,
                phaseEmoji,
                note: String(decision.save || '').slice(0, 120),
                action: decision.action || 'work',
                artifactPath: decision._artifactPath || null,
                ts: Date.now(),
              });
              wss.clients.forEach(c => { if (c.readyState === 1) c.send(workMsg); });
              // Log artifact to server console when a file lands on disk
              if (decision._artifactPath) {
                console.log(`[WorkOutput] ${msg.npcName} saved artifact → ${decision._artifactPath}`);
              }
            }

            // Send cascade decisions (leader decisions rippling down to reports)
            const cascades = decision._cascades || [];
            delete decision._cascades; // Clean up before sending
            cascades.forEach((cascade, idx) => {
              // Stagger cascades so they don't all fire at once
              setTimeout(() => {
                const cascadeReply = JSON.stringify({
                  type: 'npc_cascade',
                  npcName: cascade.npcName,
                  fromName: cascade.fromName,
                  message: cascade.message,
                });
                if (ws.readyState === 1) ws.send(cascadeReply);
              }, (idx + 1) * 3000);
            });

            // Skill bridge — fire async, NPC picks up result next think cycle
            if (decision.action === 'run_skill' && decision.skill) {
              runNpcSkill(msg.npcName, decision.skill, decision.skillParams || {})
                .catch(err => console.warn('[SkillBridge]', err.message));
            }
          })
          .catch(err => console.warn('[NpcBrains] Think error:', err.message));
      } else if (msg.type === 'npc_assign_directive') {
        // Any manager can push a mandatory task to a direct report
        if (msg.from && msg.to && msg.task) {
          npcBrains.assignDirective(msg.to, msg.from, msg.task, !!msg.urgent);
          if (ws.readyState === 1) ws.send(JSON.stringify({
            type: 'directive_assigned',
            from: msg.from,
            to: msg.to,
            task: msg.task,
          }));
        }
      } else if (msg.type === 'player_chat') {
        // CEO (player) is talking directly to an NPC
        const npcName = msg.npcName;
        if (!npcName || !npcBrains.brains[npcName]) {
          console.warn('[AgentWS] player_chat: unknown or missing npcName');
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'player_chat_response',
              npcName: typeof msg.npcName === 'string' && msg.npcName ? msg.npcName : 'Unknown',
              text: 'That person isn\'t in the office right now.',
              delegation: null,
              actions: [],
            }));
          }
          return;
        }
        if (typeof msg.text !== 'string' || !msg.text.trim()) {
          console.warn('[AgentWS] player_chat: invalid text payload');
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'player_chat_response',
              npcName: npcName,
              text: 'I did not catch that. Try again?',
              delegation: null,
              actions: [],
            }));
          }
          return;
        }
        console.log(`[PlayerChat] CEO → ${npcName}: "${msg.text}"`);
        global._npcStats.playerChatReceived++;
        global._npcStats.lastPlayerChatAt = Date.now();

        // If talking to Lucy and the message looks like a PC control request,
        // trigger the desktop agent directly instead of just chatting.
        const _broadcast = (m) => cofounderAgent.wsClients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(m)); });
        const desktopTriggers = /open|launch|click|type|search|go to|navigate|take a screenshot|screen|find|copy|paste|close|minimize|maximize|play|volume|spotify|chrome|browser|notepad|calculator|file|folder/i;
        if (npcName === 'Lucy' && desktopTriggers.test(msg.text)) {
          if (ws.readyState === 1) ws.send(JSON.stringify({
            type: 'player_chat_response',
            npcName: 'Lucy',
            text: `On it — taking control of your PC now.`,
            delegation: null, actions: [],
          }));
          // PC activity: chat-triggered desktop-agent invocation. Mode
          // is 'visible' — the user is literally about to watch Lucy
          // pilot the desktop.
          const dtChatActivity = pcActivity.record({
            npc: 'Lucy', kind: 'desktop-agent',
            task: String(msg.text).slice(0, 240),
            mode: 'visible', status: 'started',
          });
          const dtChatStart = Date.now();
          desktopAgent.runDesktopTask({ instruction: msg.text, broadcast: _broadcast })
            .then((result) => {
              pcActivity.record({
                id: dtChatActivity.id, npc: 'Lucy', kind: 'desktop-agent',
                task: dtChatActivity.task, mode: 'visible', status: 'done',
                durationMs: Date.now() - dtChatStart,
                detail: result && typeof result === 'object'
                  ? String(result.summary || result.note || '').slice(0, 240) || null
                  : null,
              });
            })
            .catch(err => {
              pcActivity.record({
                id: dtChatActivity.id, npc: 'Lucy', kind: 'desktop-agent',
                task: dtChatActivity.task, mode: 'visible', status: 'failed',
                durationMs: Date.now() - dtChatStart,
                detail: String(err?.message || err).slice(0, 240),
              });
              console.error('[desktop-task] error:', err?.message);
            });
          global._npcStats.playerChatSucceeded++;
          return;
        }

        // Incident reports from the Bouncer use a stripped-down system prompt
        // so the NPC speaks in their own voice about what just happened,
        // rather than routing through the player-response delegation framework.
        const isIncidentReport = msg.isIncidentReport === true;
        const responsePromise = isIncidentReport
          ? npcBrains.getResponse(npcName, 'CEO', msg.text, { kind: 'incident-report', description: 'You are reporting a security incident to the CEO. Speak in your own voice — stoic, professional, dry. 2-3 sentences max.' })
              .then(text => ({ text: typeof text === 'string' ? text : String(text || ''), delegation: null, actions: [] }))
          : npcBrains.getPlayerResponse(npcName, msg.text);

        responsePromise
          .then(result => {
            // If the brain returned nothing usable, treat it as an
            // error so the client sees WHY instead of an empty bubble.
            const text = (result && typeof result.text === 'string') ? result.text.trim() : '';
            if (!text) {
              const errMsg = `${npcName}'s brain returned no text (provider may be down — check /api/health)`;
              _recordNpcError(errMsg);
              global._npcStats.playerChatFailed++;
              const reply = JSON.stringify({
                type: 'player_chat_response',
                npcName,
                text: '(no reply — provider error, see diagnostics)',
                error: errMsg,
                delegation: null, actions: [],
              });
              if (ws.readyState === 1) ws.send(reply);
              return;
            }
            global._npcStats.playerChatSucceeded++;
            const reply = JSON.stringify({
              type: 'player_chat_response',
              npcName, text,
              delegation: result.delegation || null,
              actions: result.actions || [],
            });
            if (ws.readyState === 1) ws.send(reply);
            npcBrains.saveMemory(npcName, `CEO said: "${msg.text}" — I replied: "${text}"${result.delegation ? ` [delegated to ${result.delegation.delegateTo}]` : ''}`);
            // Mood shift: NPC was just spoken to by the CEO
            npcBrains.setMoodFromExternal(npcName, 'ceo_talked');
          })
          .catch(err => {
            const errMsg = String(err?.message ?? err);
            console.warn('[PlayerChat] Response error:', errMsg);
            _recordNpcError(`getPlayerResponse(${npcName}): ${errMsg}`);
            global._npcStats.playerChatFailed++;
            const fallback = JSON.stringify({
              type: 'player_chat_response',
              npcName,
              text: 'Got it, I\'ll look into that.',
              error: errMsg,
              delegation: null, actions: [],
            });
            if (ws.readyState === 1) ws.send(fallback);
          });
      } else if (msg.type === 'npc_introduce') {
        // Tour stop: Lucy is presenting NPC X to the player. Ask X's
        // brain to compose a one-line introduction in their own voice.
        // Reuses the npc_conversation reply pipeline so the bubble +
        // voice paths work without new wiring.
        let introName = msg.npcName;
        if (typeof introName === 'string' && introName && !npcBrains.brains[introName]) {
          const lower = introName.toLowerCase();
          introName = Object.keys(npcBrains.brains).find(n => n.toLowerCase() === lower) || introName;
        }
        if (introName && npcBrains.brains[introName]) {
          npcBrains.getResponse(introName, 'Lucy', String(msg.context || 'Introduce yourself briefly to the CEO.'), {})
            .then(response => {
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({
                  type: 'npc_response',
                  npcName: introName,
                  fromName: 'Lucy',
                  text: response,
                  turn: 1,
                }));
              }
            })
            .catch(err => {
              console.warn('[Tour] introduction error:', err?.message || err);
            });
        }
      } else if (msg.type === 'npc_addressed') {
        // Conversation focus: the client tells us "NPC X was just spoken
        // to by Y". Mirror into worldState so X's next think() sees the
        // 'lastAddressed' field and acknowledges them before doing
        // something else.
        if (msg.target && worldState && typeof worldState.updateNpc === 'function') {
          worldState.updateNpc(msg.target, {
            lastAddressed: { by: msg.from || 'someone', text: msg.text || '', at: msg.ts || Date.now() },
          });
        }
      } else if (msg.type === 'player_idle') {
        // Receptionist tour: the client tells us "the player has been
        // idle for N ms". Mirror into worldState so Lucy's brain (or a
        // scheduler) can decide to offer them a tour.
        if (worldState) {
          worldState.environment = worldState.environment || {};
          worldState.environment.playerIdleMs = msg.idleMs || 0;
          worldState.environment.playerPosition = msg.position || null;
          worldState._emit('environment', worldState.environment);
        }
      } else if (msg.type === 'bouncer_run_tool') {
        // Bouncer requests a security scan via Kali WSL.
        // tool: 'nmap' | 'zenmap' (both run nmap CLI) | 'wireshark' (runs tcpdump)
        // threat: { category, severity, source, target, detail }
        const _broadcast = (m) => cofounderAgent.wsClients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(m)); });
        const threat   = msg.threat || {};
        const tool     = msg.tool   || 'nmap';
        const sourceIp = threat.source && /\d{1,3}\.\d{1,3}/.test(String(threat.source)) ? String(threat.source) : null;

        console.log(`[BouncerTool] Running ${tool} (Kali WSL) for ${threat.category} threat from ${sourceIp || 'unknown'}`);

        _broadcast({
          type: 'bouncer_tool_status', tool, status: 'starting', threat,
          message: `Bouncer running ${tool === 'zenmap' ? 'nmap' : tool} in Kali Linux — investigating ${threat.category || 'the threat'}...`,
        });

        // PC activity: bouncer-driven linux-agent run. mode = 'background'
        // since this code path doesn't spawn its own terminal window.
        const btActivity = pcActivity.record({
          npc: 'Bouncer', kind: 'linux-agent',
          task: `${tool} ${threat.category || 'investigation'}${sourceIp ? ' (' + sourceIp + ')' : ''}`.slice(0, 240),
          mode: 'background', status: 'started',
        });
        const btStart = Date.now();

        // All tools now run via Kali WSL — no desktop agent / GUI dependency
        const scanPromise = (tool === 'nmap' || tool === 'zenmap')
          ? linuxAgent.investigate({ ...threat, source: sourceIp || threat.source })
          : (tool === 'wireshark')
            ? linuxAgent.trafficSnapshot().then(r => ({ ok: r.ok, summary: r.raw, elapsed: 5000, steps: [{ label: 'tcpdump', output: r.raw }] }))
            : linuxAgent.perimeterPatrol().then(r => ({ ok: r.ok, summary: r.summary, elapsed: r.elapsed, steps: [] }));

        scanPromise.then(result => {
            pcActivity.record({
              id: btActivity.id, npc: 'Bouncer', kind: 'linux-agent',
              task: btActivity.task, mode: 'background',
              status: result.ok ? 'done' : 'failed',
              durationMs: Date.now() - btStart,
              detail: (result.summary || result.error || '').slice(0, 240) || null,
            });
            _broadcast({
              type: 'bouncer_tool_status',
              tool,
              status: result.ok ? 'done' : 'error',
              threat,
              steps: result.steps?.length,
              message: result.ok
                ? `${tool === 'zenmap' ? 'nmap' : tool} complete (${((result.elapsed || 0) / 1000).toFixed(1)}s).`
                : `${tool} failed: ${result.error}`,
            });
          })
          .catch(err => {
            pcActivity.record({
              id: btActivity.id, npc: 'Bouncer', kind: 'linux-agent',
              task: btActivity.task, mode: 'background',
              status: 'failed', durationMs: Date.now() - btStart,
              detail: String(err?.message || err).slice(0, 240),
            });
            console.error(`[BouncerTool] ${tool} error:`, err?.message);
            _broadcast({
              type: 'bouncer_tool_status',
              tool,
              status: 'error',
              threat,
              message: `${tool} threw: ${err?.message || err}`,
            });
          });
      } else if (msg.type === 'bouncer_run_linux') {
        // Bouncer requests a Kali WSL investigation for a threat.
        // threat: { category, severity, source, target, detail }
        // openTerminal: bool (default false) — set true to open a visible WSL window
        const _broadcast = (m) => cofounderAgent.wsClients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(m)); });
        const threat = msg.threat || {};

        console.log(`[BouncerLinux] WSL investigation for ${threat.category} from ${threat.source || 'unknown'}`);

        _broadcast({
          type: 'bouncer_linux_status',
          status: 'starting',
          threat,
          message: `Bouncer opened a Kali Linux terminal to investigate ${threat.category || 'the threat'}...`,
        });

        // Open a real visible terminal window so the player can watch Bouncer work.
        const blrOpenTerm = msg.openTerminal !== false;
        if (blrOpenTerm) {
          _openBouncerTerminal(_buildTerminalShowCmd(threat));
        }

        // PC activity: WS-triggered linux-agent investigation. Mode follows
        // whether we actually pop a terminal window.
        const blrActivity = pcActivity.record({
          npc: 'Bouncer', kind: 'linux-agent',
          task: `investigate ${threat.category || 'threat'}${threat.source ? ' (' + threat.source + ')' : ''}`,
          mode: blrOpenTerm ? 'visible' : 'background',
          status: 'started',
        });
        const blrStart = Date.now();

        // Run the real investigation (fast, direct WSL exec — no vision needed)
        linuxAgent.investigate(threat).then(result => {
          pcActivity.record({
            id: blrActivity.id, npc: 'Bouncer', kind: 'linux-agent',
            task: blrActivity.task, mode: blrActivity.mode,
            status: result.ok ? 'done' : 'failed',
            durationMs: Date.now() - blrStart,
            detail: (result.summary || result.error || '').slice(0, 240) || null,
          });
          // ── Feature 1: Write structured markdown report ──────────────────
          let reportPath = null;
          if (result.ok) {
            try {
              const reportMd = linuxAgent.buildReport(threat, result, null);
              const slug = (threat.category || 'investigation')
                .toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
              const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
              reportPath = npcTools.writeArtifact(
                'Bouncer', 'security',
                `bouncer_${slug}_${dateStr}_${Date.now()}`,
                reportMd,
              );
              if (reportPath) console.log(`[BouncerLinux] Report written: ${reportPath}`);
            } catch (reportErr) {
              console.warn('[BouncerLinux] Report write failed:', reportErr?.message);
            }
          }

          _broadcast({
            type: 'bouncer_linux_result',
            status: result.ok ? 'done' : 'error',
            threat,
            category: result.category,
            ip: result.ip,
            elapsed: result.elapsed,
            steps: result.steps,
            summary: result.summary,
            reportPath: reportPath || null,
            message: result.ok
              ? `Kali investigation complete (${(result.elapsed / 1000).toFixed(1)}s).`
              : `WSL error: ${result.error}`,
          });

          // ── Feature 2: Escalate to Dan if investigation is serious ───────
          if (result.ok && investigationIsSerious(result)) {
            const danMsg = {
              type: 'npc_assign_directive',
              from: 'Bouncer',
              to: 'Dan',
              task: `Security escalation: ${threat.category || 'unknown'} threat detected. Review Bouncer's report in reports/security/ and check server configuration.`,
              urgent: true,
            };
            cofounderAgent.wsClients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(danMsg)); });
            console.log(`[BouncerLinux] Serious threat — escalating to Dan`);
          }

          // ── AI report to CEO ──────────────────────────────────────────────
          if (result.ok && result.summary && ws.readyState === 1) {
            const fileRef = reportPath ? ` Full report filed at ${reportPath}.` : '';
            const reportPrompt = [
              `You just ran security commands in Kali Linux to investigate a ${threat.category || 'unknown'} threat.`,
              `Here is what you found:\n${result.summary.slice(0, 800)}`,
              `Report the key findings to Abby (CEO) in one tight paragraph: what was found, how serious, what you did.${fileRef} No alarm, no dramatization. State facts and actions.`,
            ].join(' ');
            npcBrains.getResponse('Bouncer', 'CEO', reportPrompt, {
              kind: 'linux-investigation-report',
              description: 'Report security investigation findings to CEO. Stoic, professional, one paragraph. Reference report file if available.',
            }).then(text => {
              cofounderAgent.wsClients.forEach(c => {
                if (c.readyState === 1) c.send(JSON.stringify({
                  type: 'player_chat_response',
                  npcName: 'Bouncer',
                  text: typeof text === 'string' ? text : String(text || ''),
                  delegation: null,
                  actions: [],
                }));
              });
            }).catch(() => {});
          }
        }).catch(err => {
          pcActivity.record({
            id: blrActivity.id, npc: 'Bouncer', kind: 'linux-agent',
            task: blrActivity.task, mode: blrActivity.mode,
            status: 'failed', durationMs: Date.now() - blrStart,
            detail: String(err?.message || err).slice(0, 240),
          });
          console.error('[BouncerLinux] WSL error:', err?.message);
          _broadcast({ type: 'bouncer_linux_result', status: 'error', threat, message: `WSL threw: ${err?.message || err}` });
        });
      } else {
        cofounderAgent.handleClientMessage(msg);
      }
    } catch (err) {
      console.warn('[AgentWS] Failed to parse client message:', err.message);
    }
  });

  ws.on('close', () => {
    console.log(`[CofounderAgent] WS client disconnected (${cofounderAgent.wsClients.size - 1} remaining)`);
    cofounderAgent.removeClient(ws);
  });
  ws.on('error', () => {
    cofounderAgent.removeClient(ws);
  });
});

// Route WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/security-ws') {
    securityWss.handleUpgrade(req, socket, head, (ws) => {
      securityWss.emit('connection', ws, req);
    });
    return;
  }

  if (req.url === '/agent-ws') {
    agentWss.handleUpgrade(req, socket, head, (ws) => {
      agentWss.emit('connection', ws, req);
    });
    return;
  }

  // OpenClaw WebSocket proxy
  const target = net.createConnection(OPENCLAW_PORT, OPENCLAW_HOST, () => {
    const reqLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    target.write(reqLine + headers + '\r\n\r\n');
    if (head.length) target.write(head);
    socket.pipe(target);
    target.pipe(socket);
  });
  target.on('error', (err) => {
    console.warn('[WS Proxy] Error:', err.message);
    socket.destroy();
  });
  socket.on('error', () => target.destroy());
});

// If port is already in use, kill whatever's holding it and retry once.
// This makes `node server.js` safe to run without manually killing the old process.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[Server] Port ${PORT} busy — killing existing process and retrying...`);
    const { execSync } = require('child_process');
    try {
      if (process.platform === 'win32') {
        // Find PID on the port and kill it
        const out = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8', timeout: 3000 });
        const pids = [...new Set(out.split('\n').map(l => l.trim().split(/\s+/).pop()).filter(p => /^\d+$/.test(p) && p !== '0'))];
        pids.forEach(pid => { try { execSync(`taskkill /PID ${pid} /F`, { timeout: 2000 }); } catch (_) {} });
      } else {
        execSync(`fuser -k ${PORT}/tcp 2>/dev/null || lsof -ti:${PORT} | xargs kill -9 2>/dev/null || true`, { timeout: 3000 });
      }
    } catch (_) {}
    setTimeout(() => server.listen(PORT), 1000);
  }
});

server.listen(PORT, () => {
  const parallel = process.env.LM_STUDIO_PARALLEL || 1;
  const npcCount = Object.keys(npcRoster || {}).length || 16;
  log.banner({ port: PORT, parallel, npcs: npcCount });
  log.info('Server', `http://localhost:${PORT}`);
  log.info('WS', `ws://localhost:${PORT}/agent-ws`);
  log.info('Security', `ws://localhost:${PORT}/security-ws`);
  const ttsStatus = elevenLabs.status();
  if (ttsStatus.configured) {
    log.info('TTS', `ElevenLabs ✓ (key from ${ttsStatus.source})`);
  } else {
    log.warn('TTS', 'ElevenLabs not configured — set ELEVENLABS_API_KEY to enable');
  }

  // Sync LM Studio's active loaded model BEFORE starting the agent loop
  // so every component picks up the right model from the first request.
  npcBrains.syncLmStudioModel().catch(() => {}).finally(() => {
    // Keep cofounderAgent.model in sync too
    if (npcBrains.providers?.lmstudio?.model) {
      cofounderAgent.model = npcBrains.providers.lmstudio.model;
    }
    // Start the cofounder agent's autonomous thinking loop
    cofounderAgent.start();
  });

  // ── Bouncer proactive patrol loop ─────────────────────────────────────────
  // Every 5 minutes Bouncer runs a real nmap baseline scan via Kali WSL and
  // broadcasts the results. NPCs (especially Bouncer's think loop) can read
  // the latest patrol result from worldState.bouncerPatrol.
  // First patrol fires after 60s so startup settles first.
  const PATROL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  let _patrolTimer = null;

  async function runBouncerPatrol() {
    // PC activity: every 5-min patrol runs real WSL commands. Background
    // by default — no terminal window is opened for the timer-driven
    // patrol.
    const patActivity = pcActivity.record({
      npc: 'Bouncer', kind: 'linux-agent',
      task: 'scheduled perimeter patrol',
      mode: 'background', status: 'started',
    });
    const patStart = Date.now();
    try {
      log.info('Patrol', 'running perimeter check...');
      const patrol = await linuxAgent.perimeterPatrol();
      pcActivity.record({
        id: patActivity.id, npc: 'Bouncer', kind: 'linux-agent',
        task: patActivity.task, mode: 'background',
        status: patrol.ok ? 'done' : 'failed',
        durationMs: Date.now() - patStart,
        detail: (patrol.summary || '').slice(0, 240) || null,
      });

      // Store in world-state so it injects into Bouncer's think prompts
      if (worldState) {
        worldState.bouncerPatrol = {
          ts:        Date.now(),
          summary:   patrol.summary,
          openPorts: patrol.openPorts || [],
          wsServer:  patrol.wsServer,
          lmStudio:  patrol.lmStudio,
          elapsed:   patrol.elapsed,
        };
      }

      // Broadcast to all clients so the HUD can show patrol status
      const patrolMsg = JSON.stringify({
        type:      'bouncer_patrol_result',
        summary:   patrol.summary,
        openPorts: patrol.openPorts || [],
        wsUp:      patrol.wsServer?.open || false,
        lmUp:      patrol.lmStudio?.open || false,
        elapsed:   patrol.elapsed,
        ts:        Date.now(),
      });
      wss.clients.forEach(c => { if (c.readyState === 1) c.send(patrolMsg); });

      log.patrol({ openPorts: patrol.openPorts, wsUp: patrol.wsServer?.open, lmUp: patrol.lmStudio?.open, elapsed: patrol.elapsed });

      // If open ports changed, broadcast a security event
      if (patrol.openPorts && patrol.openPorts.length > 0) {
        const portList = patrol.openPorts.map(p => `${p.port}/${p.service}`).join(', ');
        broadcast({ type: 'threat', category: 'scan_probe', severity: 'low',
          source: 'localhost', detail: `Baseline scan found open ports: ${portList}` });
      }
    } catch (err) {
      pcActivity.record({
        id: patActivity.id, npc: 'Bouncer', kind: 'linux-agent',
        task: patActivity.task, mode: 'background',
        status: 'failed', durationMs: Date.now() - patStart,
        detail: String(err?.message || err).slice(0, 240),
      });
      log.warn('Patrol', err?.message || String(err));
    }
    _patrolTimer = setTimeout(runBouncerPatrol, PATROL_INTERVAL_MS);
  }

  // Kick off first patrol after 60s
  _patrolTimer = setTimeout(runBouncerPatrol, 60 * 1000);
  log.info('Patrol', 'scheduled — first check in 60s, then every 5 min');
});

// Graceful shutdown — stop the security monitor's intervals and child
// processes (tshark, journalctl polling) so the process exits cleanly
// instead of hanging on the event loop. Idempotent across signals.
let _shuttingDown = false;
function gracefulShutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`[Server] ${signal} received — shutting down`);
  try { securityMonitor.stop?.(); } catch (e) { console.warn('[Server] securityMonitor.stop:', e?.message); }
  try { cofounderAgent.stop?.(); } catch (_) {}
  try { externalSink.detach(); } catch (_) {}
  try { if (_patrolTimer) { clearTimeout(_patrolTimer); _patrolTimer = null; } } catch (_) {}
  try {
    if (_broadcastTimer) clearTimeout(_broadcastTimer);
  } catch (_) {}
  // Give in-flight requests up to 3s, then exit.
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
