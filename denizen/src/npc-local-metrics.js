'use strict';

/**
 * Event-driven telemetry consult — threshold checks in think() before mesh job tick.
 * Replaces hope-based polling with local metric crosses → consult-grok queue.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

let telemetryRebalance = null;
try { telemetryRebalance = require('./npc-telemetry-rebalance'); } catch (_) {}

const QUEUE_FILE = path.join(__dirname, '..', 'data', 'grok-consult-queue.jsonl');
const TELEMETRY_FILE = path.join(__dirname, '..', 'data', 'grok-telemetry-latest.json');
const FRICTION_FILE = path.join(__dirname, '..', 'data', 'friction-metrics.json');
const AUTONOMY_BACKLOG_PATH = path.join(__dirname, '..', 'data', 'autonomy-backlog.jsonl');

let _friction = {}; // npc -> { domain: { count, lastAt, score } }
let _lastHostPoll = null; // cached pollHostInfrastructure() result

const DEFAULT_THRESHOLDS = Object.freeze({
  // Slightly higher floors so ambient noise doesn't re-spam the consult queue.
  latencyMs: Number(process.env.DENIZEN_CONSULT_LATENCY_MS) || 5000,
  avgTokens: Number(process.env.DENIZEN_CONSULT_TOKENS) || 2500,
  // 2h default after a consult (was 30m) — lessons need time to take effect.
  consultCooldownMs: Number(process.env.DENIZEN_CONSULT_COOLDOWN_MS) || 2 * 60 * 60 * 1000,
});

/** Friction score at which autonomy backlog items are enqueued (mentor consensus). */
const BACKLOG_FRICTION_THRESHOLD = 8;

/** Domain → default coding-agent prompt when friction crosses threshold. */
const DOMAIN_BUILD_PROMPTS = {
  path_stuck: (npc, score) =>
    `NPC ${npc} keeps getting path_stuck (friction ${score}). Fix pathfinder stuck detection, office-scene immobile watchdog, desk approach targets, or wander recovery so agents reach desks reliably.`,
  mesh_navigation: (npc, score) =>
    `NPC ${npc} has mesh_navigation friction ${score} (legacy alias for path_stuck). Apply the same pathfinding / movement fixes.`,
  chronos_stagnation: (npc, score) =>
    `NPC ${npc} repeats the same think decision without progress (friction ${score}). Break the loop in npc-brains evaluate/decision handling.`,
  cognitive_context: (npc, score) =>
    `NPC ${npc} hits context overflow (friction ${score}). Tighten prompt budget, compress recentMemory, or prune MEMORY.md.`,
  io_storage: (npc, score) =>
    `I/O friction ${score} for ${npc}. Harden JSON/file reads and telemetry snapshot copies.`,
  consult_unanswered: (npc, score) =>
    `Consult for ${npc} unanswered ${score}+ friction. Wire consult-grok / mentor escalation or shorten cooldown.`,
};

function npcKeyVariants(npcName) {
  const n = String(npcName || '').trim();
  return [n, n.toLowerCase(), n.charAt(0).toUpperCase() + n.slice(1).toLowerCase()];
}

function resolveNpcStats(tel, npcName) {
  const npcs = tel?.npcs || {};
  for (const key of npcKeyVariants(npcName)) {
    if (npcs[key]) return { key, stats: npcs[key] };
  }
  return { key: null, stats: null };
}

function relevantFacts(tel, npcName) {
  const facts = tel?.facts || [];
  return facts.filter((f) => f.toLowerCase().includes(npcName.toLowerCase())
    && /(bloat|bottleneck|latency|stuck|compress)/i.test(f));
}

function thresholdsFor(npcName) {
  const cfg = telemetryRebalance?.rebalanceFor?.(npcName) || {};
  return {
    latencyMs: cfg.latencyMsThreshold ?? DEFAULT_THRESHOLDS.latencyMs,
    avgTokens: cfg.compressTokenThreshold ?? cfg.memoryFlushTokenThreshold ?? DEFAULT_THRESHOLDS.avgTokens,
    consultCooldownMs: cfg.consultCooldownMs ?? DEFAULT_THRESHOLDS.consultCooldownMs,
  };
}

function loadTelemetry() {
  try {
    if (!fs.existsSync(TELEMETRY_FILE)) return null;
    return JSON.parse(fs.readFileSync(TELEMETRY_FILE, 'utf8'));
  } catch (err) {
    if (typeof recordFriction === 'function') {
      recordFriction('system', 'io_storage', 4);
    }
    return null;
  }
}

function loadFriction() {
  try {
    if (!fs.existsSync(FRICTION_FILE)) return {};
    return JSON.parse(fs.readFileSync(FRICTION_FILE, 'utf8'));
  } catch (_) { return {}; }
}

function saveFriction(data) {
  try {
    fs.mkdirSync(path.dirname(FRICTION_FILE), { recursive: true });
    fs.writeFileSync(FRICTION_FILE, JSON.stringify(data, null, 2));
  } catch (_) {}
}

function _getNpcFriction(npcName) {
  if (!_friction[npcName]) _friction[npcName] = loadFriction()[npcName] || {};
  return _friction[npcName];
}

function buildRemediationPrompt(npcName, domain, score) {
  const d = String(domain || 'general').toLowerCase();
  if (DOMAIN_BUILD_PROMPTS[d]) return DOMAIN_BUILD_PROMPTS[d](npcName, score);
  if (d.startsWith('skill_failure:')) {
    const skill = d.slice('skill_failure:'.length) || 'unknown';
    return `Skill ${skill} fails repeatedly for ${npcName} (friction ${score}). Add error handling, retries, or fix the skill runner integration.`;
  }
  return `Build a robust improvement or error handler for ${d} to reduce friction (score ${score}) for ${npcName}. Repeated failures in this domain — implement a minimal fix.`;
}

function maybeEnqueueAutonomyBacklog(npcName, domain) {
  const d = String(domain || 'general').toLowerCase();
  if (d.includes('host_infrastructure') || d.startsWith('nas_')) return null;
  const fr = getFrictionScore(npcName, d);
  if ((fr.score || 0) < BACKLOG_FRICTION_THRESHOLD) return null;
  return appendBacklog({
    id: `backlog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    npc: npcName,
    domain: d,
    friction_score: fr.score,
    build_prompt: buildRemediationPrompt(npcName, d, fr.score),
    status: 'pending',
    priority: Math.min(10, 5 + Math.floor(fr.score / 10)),
    build_attempts: 0,
    last_triggered_ts: null,
  });
}

function recordFriction(npcName, domain, amount = 1) {
  const n = String(npcName).toLowerCase();
  const d = String(domain || 'general').toLowerCase();
  const f = _getNpcFriction(n);
  if (!f[d]) f[d] = { count: 0, lastAt: null, recentErrors: [] };
  if (amount < 0) {
    f[d].count = Math.max(0, (f[d].count || 0) + amount);
    f[d].score = Math.max(0, (f[d].score || 0) + amount);
    if (f[d].score === 0) f[d].count = 0;
  } else {
    f[d].count += amount;
    f[d].lastAt = new Date().toISOString();
    f[d].recentErrors = (f[d].recentErrors || []).slice(-4);
    f[d].recentErrors.push({ at: f[d].lastAt, amount });
    const hoursSince = f[d].lastAt ? (Date.now() - Date.parse(f[d].lastAt)) / (1000 * 3600) : 24;
    f[d].score = Math.min(100, Math.round(f[d].count * (1 + Math.max(0, 5 - hoursSince) / 5)));
  }
  const all = loadFriction();
  all[n] = f;
  saveFriction(all);
  if (amount > 0) {
    try { maybeEnqueueAutonomyBacklog(npcName, d); } catch (_) {}
  }
  return f[d];
}

function resetFriction(npcName, domain) {
  const n = String(npcName).toLowerCase();
  const d = String(domain || 'general').toLowerCase();
  const f = _getNpcFriction(n);
  f[d] = { count: 0, lastAt: null, score: 0, recentErrors: [] };
  const all = loadFriction();
  all[n] = f;
  saveFriction(all);
  return f[d];
}

function getFrictionScore(npcName, domain = null) {
  const f = _getNpcFriction(String(npcName).toLowerCase());
  const now = Date.now();
  const DECAY_FACTOR = 0.95;
  const HOUR_MS = 60 * 60 * 1000;

  // Apply exponential decay to all domains for this NPC
  for (const d of Object.keys(f)) {
    const entry = f[d];
    if (entry.lastAt) {
      const last = Date.parse(entry.lastAt);
      const hoursPassed = Math.max(0, (now - last) / HOUR_MS);
      if (hoursPassed >= 1) {
        const decays = Math.floor(hoursPassed);
        entry.score = Math.max(0, Math.floor((entry.score || 0) * Math.pow(DECAY_FACTOR, decays)));
        entry.lastAt = new Date(now).toISOString();
      }
    }
  }

  // Merge NAS host friction (read-only view — do NOT re-record on every read)
  try {
    const nasFriction = loadNasFriction();
    for (const nf of nasFriction.slice(-20)) {
      const d = `nas_${nf.domain || 'general'}`;
      const sev = nf.severity || 5;
      if (!f[d]) f[d] = { count: 0, score: 0, lastAt: null };
      f[d].score = Math.max(f[d].score || 0, sev);
      f[d].lastAt = nf.ts || f[d].lastAt;
    }
  } catch (_) {}

  if (domain) {
    const d = String(domain).toLowerCase();
    return f[d] ? { domain: d, score: f[d].score || 0, count: f[d].count, lastAt: f[d].lastAt } : { domain: d, score: 0, count: 0 };
  }
  // overall max or avg
  const scores = Object.values(f).map(v => v.score || 0);
  const max = scores.length ? Math.max(...scores) : 0;
  const domains = Object.keys(f).filter(k => (f[k].score || 0) > 5);
  return { overall: max, hotDomains: domains, details: f };
}

function loadNasFriction() {
  const NAS_FRICTION_FILE = path.join(__dirname, '..', 'data', 'nas-friction.jsonl');
  try {
    if (!fs.existsSync(NAS_FRICTION_FILE)) return [];
    const lines = fs.readFileSync(NAS_FRICTION_FILE, 'utf8').trim().split('\n').filter(Boolean);
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch (_) { return []; }
}

function loadAutonomyBacklog(limit = 20) {
  try {
    if (!fs.existsSync(AUTONOMY_BACKLOG_PATH)) return [];
    const lines = fs.readFileSync(AUTONOMY_BACKLOG_PATH, 'utf8').trim().split('\n').filter(Boolean);
    return lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(e => e && (e.status === 'pending' || !e.status || e.status === 'in_progress'))
      .slice(0, limit);
  } catch (_) { return []; }
}

function appendBacklog(entry) {
  try {
    fs.mkdirSync(path.dirname(AUTONOMY_BACKLOG_PATH), { recursive: true });

    // Load existing to do global deduplication / upvoting (multi-agent coordination)
    let existing = [];
    if (fs.existsSync(AUTONOMY_BACKLOG_PATH)) {
      const lines = fs.readFileSync(AUTONOMY_BACKLOG_PATH, 'utf8').trim().split('\n').filter(Boolean);
      existing = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    }

    const domainKey = entry.domain || 'general';
    const matching = existing.findIndex(e => 
      (e.status === 'pending' || !e.status || e.status === 'in_progress') && 
      (e.domain || 'general') === domainKey
    );

    if (matching >= 0) {
      // Upvote / dedup: add to impacted_npcs, bump priority/friction
      const target = existing[matching];
      if (!target.impacted_npcs) target.impacted_npcs = [];
      if (!target.impacted_npcs.includes(entry.npc)) {
        target.impacted_npcs.push(entry.npc);
      }
      target.friction_score = Math.max(target.friction_score || 0, entry.friction_score || 0);
      target.priority = Math.min(10, Math.max(target.priority || 1, (target.priority || 7) + 1));
      target.last_updated = new Date().toISOString();

      // Rewrite the file with the upvoted entry
      const updatedLines = existing.map(e => JSON.stringify(e));
      fs.writeFileSync(AUTONOMY_BACKLOG_PATH, updatedLines.join('\n') + '\n');
      return target; // return the (upvoted) existing
    } else {
      // New entry with impacted_npcs
      const newEntry = {
        ...entry,
        impacted_npcs: [entry.npc],
        acquired_by: null,
        last_updated: new Date().toISOString()
      };
      fs.appendFileSync(AUTONOMY_BACKLOG_PATH, JSON.stringify(newEntry) + '\n');
      return newEntry;
    }
  } catch (_) {}
}

function markBacklogInProgress(id, acquiredBy = null) {
  // Rewrite file with updated status + lock for the matching id (mutex support)
  try {
    if (!fs.existsSync(AUTONOMY_BACKLOG_PATH)) return false;
    const lines = fs.readFileSync(AUTONOMY_BACKLOG_PATH, 'utf8').trim().split('\n').filter(Boolean);
    const updated = lines.map(line => {
      try {
        const e = JSON.parse(line);
        if (e.id === id) {
          e.status = 'in_progress';
          e.last_triggered_ts = new Date().toISOString();
          e.build_attempts = (e.build_attempts || 0) + 1;
          if (acquiredBy) e.acquired_by = acquiredBy;
        }
        return JSON.stringify(e);
      } catch { return line; }
    });
    fs.writeFileSync(AUTONOMY_BACKLOG_PATH, updated.join('\n') + '\n');
    return true;
  } catch (_) { return false; }
}

function decayAndArchiveStaleBacklog() {
  // Apply staleness + decay: if friction low or old, decay priority or archive as stale
  try {
    if (!fs.existsSync(AUTONOMY_BACKLOG_PATH)) return;
    const lines = fs.readFileSync(AUTONOMY_BACKLOG_PATH, 'utf8').trim().split('\n').filter(Boolean);
    const now = Date.now();
    const HOUR_MS = 60 * 60 * 1000;
    const updated = lines.map(line => {
      try {
        const e = JSON.parse(line);
        if ((e.status === 'pending' || !e.status) && e.domain && e.npc) {
          const fr = getFrictionScore(e.npc, e.domain);
          // Staleness based on friction
          if (fr.score < 10) {
            e.priority = Math.max(1, Math.floor((e.priority || 7) * 0.8));
            if (e.priority <= 1) {
              e.status = 'stale';
              e.stale_at = new Date().toISOString();
            }
          }
          // Time-based decay on priority if not triggered recently
          if (e.last_triggered_ts) {
            const last = Date.parse(e.last_triggered_ts);
            const hours = Math.max(0, (now - last) / HOUR_MS);
            if (hours > 24) {
              e.priority = Math.max(1, Math.floor((e.priority || 7) * Math.pow(0.9, Math.floor(hours / 24))));
            }
          } else if (e.ts) {
            // If never triggered, decay based on creation time
            const created = Date.parse(e.ts);
            const hours = Math.max(0, (now - created) / HOUR_MS);
            if (hours > 48) {
              e.priority = Math.max(1, Math.floor((e.priority || 7) * 0.5));
              if (e.priority <= 1) e.status = 'stale';
            }
          }
        }
        return JSON.stringify(e);
      } catch { return line; }
    });
    fs.writeFileSync(AUTONOMY_BACKLOG_PATH, updated.join('\n') + '\n');
  } catch (_) {}
}

function settleBacklogLock(id, success, resultInfo = {}) {
  // Explicit settlement on coding-agent completion (Lock Settlement Path)
  try {
    if (!fs.existsSync(AUTONOMY_BACKLOG_PATH)) return false;
    const lines = fs.readFileSync(AUTONOMY_BACKLOG_PATH, 'utf8').trim().split('\n').filter(Boolean);
    let settled = false;
    const updated = lines.map(line => {
      try {
        const e = JSON.parse(line);
        if (e.id === id) {
          const now = new Date().toISOString();
          if (success) {
            e.status = 'resolved';
            e.resolved_at = now;
            e.acquired_by = null;
            // Zero friction for all impacted agents
            if (e.impacted_npcs && Array.isArray(e.impacted_npcs)) {
              e.impacted_npcs.forEach((npc) => {
                resetFriction(npc, e.domain);
              });
            }
            resetFriction('system', e.domain);
          } else {
            e.build_attempts = (e.build_attempts || 0) + 1;
            const max = e.max_build_attempts || 2;
            if (e.build_attempts >= max) {
              e.status = 'failed_escalated';
              e.escalated_at = now;
              // Trigger mentor escalation if possible (will be handled in caller)
            } else {
              e.status = 'pending';
            }
            e.acquired_by = null;
            e.last_triggered_ts = now;
          }
          settled = true;
        }
        return JSON.stringify(e);
      } catch { return line; }
    });
    if (settled) {
      fs.writeFileSync(AUTONOMY_BACKLOG_PATH, updated.join('\n') + '\n');
    }
    return settled;
  } catch (_) { return false; }
}

function expireOrphanedLocks(maxAgeMs = 15 * 60 * 1000) {
  // Lease timeout safeguard
  try {
    if (!fs.existsSync(AUTONOMY_BACKLOG_PATH)) return 0;
    const now = Date.now();
    const lines = fs.readFileSync(AUTONOMY_BACKLOG_PATH, 'utf8').trim().split('\n').filter(Boolean);
    let expiredCount = 0;
    const updated = lines.map(line => {
      try {
        const e = JSON.parse(line);
        if (e.status === 'in_progress' && e.acquired_by && e.last_triggered_ts) {
          const last = Date.parse(e.last_triggered_ts);
          if (now - last > maxAgeMs) {
            e.status = 'pending';
            e.acquired_by = null;
            e.last_triggered_ts = null;
            e.notes = (e.notes || '') + ' [auto-expired orphan lock]';
            expiredCount++;
          }
        }
        return JSON.stringify(e);
      } catch { return line; }
    });
    if (expiredCount > 0) {
      fs.writeFileSync(AUTONOMY_BACKLOG_PATH, updated.join('\n') + '\n');
    }
    return expiredCount;
  } catch (_) { return 0; }
}

/**
 * Centralized interceptor for system-level friction (per Claude proposal).
 * Maps errors from navigation, skills, io to domains and records friction.
 */
function captureSystemError(npcName, systemContext, error) {
  let domain = 'system_general';
  let severity = 5;

  const ctx = String(systemContext || '').toLowerCase();
  const errMsg = String(error?.message || error || '').toLowerCase();
  const errCode = String(error?.code || '').toUpperCase();

  if (ctx.includes('navigation') || ctx.includes('path') || ctx === 'pathfinding' || errCode === 'UNROUTABLE'
    || errCode === 'STUCK' || errCode === 'IMMOBILE' || errMsg.includes('stuck') || errMsg.includes('path')) {
    domain = 'path_stuck';
    severity = 10;
  } else if (ctx.startsWith('skill_failure:') || ctx.startsWith('skill_') || ctx.includes('run_skill')) {
    const skillName = ctx.replace(/^skill_(failure:)?/, '').replace(/^run_/, '');
    // A consult that is merely QUEUED/unanswered is not a hard skill failure.
    // This branch used to swallow those (it runs before the consult_unanswered
    // check below), tagging them skill_failure:consult-* at severity 8. That
    // inflated friction until the mentors advised NPCs to stop consulting at
    // all — disabling the very loop that makes the local models smarter.
    if (skillName.includes('consult')
      && (errMsg.includes('pending') || errMsg.includes('unanswered') || errMsg.includes('queued'))) {
      domain = 'consult_unanswered';
      severity = 7;
    } else {
      domain = `skill_failure:${skillName || 'unknown'}`;
      severity = 8;
    }
  } else if (ctx.includes('consult') && (errMsg.includes('pending') || errMsg.includes('unanswered'))) {
    domain = 'consult_unanswered';
    severity = 7;
  } else if (errCode === 'EACCES' || errMsg.includes('json') || errMsg.includes('parse') || ctx.includes('io') || ctx.includes('file') || ctx.includes('storage')) {
    domain = 'io_storage';
    severity = 6;
  } else if (errMsg.includes('timeout')) {
    severity = 7;
  } else if (ctx.includes('cognitive') || ctx.includes('token') || ctx.includes('context') || errCode === 'CONTEXT_OVERFLOW') {
    domain = 'cognitive_context';
    severity = 9; // High impact: causes blindness/truncation
  } else if (ctx.includes('chronos') || ctx.includes('stagnation') || ctx.includes('loop') || ctx.includes('repeat') || ctx.includes('stuck_decision')) {
    domain = 'chronos_stagnation';
    severity = 9; // High: repeated useless cycles
  }

  if (typeof recordFriction === 'function') {
    recordFriction(npcName, domain, severity);
  }
  return { domain, severity };
}

/**
 * Summarize per-NPC friction for grok-telemetry-latest.json (fleet-wide hotspot ranking).
 */
function buildFrictionSummary(limitPerNpc = 5) {
  const all = loadFriction();
  const summary = {};
  for (const [npc, domains] of Object.entries(all)) {
    if (!domains || typeof domains !== 'object') continue;
    const hot = Object.entries(domains)
      .map(([domain, v]) => ({ domain, score: v?.score || 0, count: v?.count || 0, lastAt: v?.lastAt || null }))
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limitPerNpc);
    if (hot.length) {
      summary[npc] = {
        overall: Math.max(...hot.map((h) => h.score)),
        hot_domains: hot.map((h) => h.domain),
        domains: hot,
      };
    }
  }
  return summary;
}

/**
 * Record friction when a consult has been pending too long (called from think loop).
 */
function checkConsultUnansweredFriction(npcName, maxAgeMs = 2 * 60 * 60 * 1000) {
  const now = Date.now();
  for (const entry of readQueueTail(30).reverse()) {
    if (String(entry.npc || '').toLowerCase() !== String(npcName).toLowerCase()) continue;
    if (entry.status !== 'pending') continue;
    const ts = Date.parse(entry.ts || '');
    if (!Number.isFinite(ts) || now - ts < maxAgeMs) continue;
    return captureSystemError(npcName, 'consult_unanswered', {
      code: 'CONSULT_STALE',
      message: `pending consult ${entry.topic || 'unknown'} for ${Math.round((now - ts) / 60000)}min`,
    });
  }
  return null;
}

/**
 * Host Sensory Hook: lightweight poller for Synology NAS / container host metrics.
 * Called from telemetry pulls to give agents visibility into physical host.
 * Triggers host_infrastructure friction on high load.
 */
function pollHostInfrastructure() {
  try {
    const cpus = os.cpus().length;
    const load1 = os.loadavg()[0] || 0;
    const loadPct = (load1 / cpus) * 100;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsedPct = totalMem > 0 ? ((totalMem - freeMem) / totalMem) * 100 : 0;

    let storagePct = 0;
    try {
      const stats = fs.statfsSync(process.cwd());
      if (stats.blocks && stats.bavail) {
        const total = stats.blocks * stats.bsize;
        const avail = stats.bavail * stats.bsize;
        storagePct = total > 0 ? ((total - avail) / total) * 100 : 0;
      }
    } catch (_) { /* fs.statfs may not be available everywhere */ }

    const isHigh = loadPct > 90 || memUsedPct > 90 || storagePct > 95;

    if (isHigh) {
      const code = loadPct > 90 ? 'CPU_HIGH' : (memUsedPct > 90 ? 'RAM_LOW' : 'DISK_FULL');
      const msg = `load=${loadPct.toFixed(1)}% mem=${memUsedPct.toFixed(1)}% disk=${storagePct.toFixed(1)}%`;
      if (typeof captureSystemError === 'function') {
        captureSystemError('system', 'host_infrastructure', { code, message: msg });
      }
      // Also record directly for system
      if (typeof recordFriction === 'function') {
        recordFriction('system', 'host_infrastructure', Math.round(Math.max(loadPct, memUsedPct, storagePct) / 5));
      }
    }

    // Write peer health for mesh delegation (Tailscale visible shared dir)
    try {
      writeHostMetrics({ loadPct, memUsedPct, storagePct, high: isHigh, node: process.env.NODE_NAME || 'local' });
    } catch (_) {}

    const result = {
      loadPct: parseFloat(loadPct.toFixed(1)),
      memUsedPct: parseFloat(memUsedPct.toFixed(1)),
      storagePct: parseFloat(storagePct.toFixed(1)),
      high: isHigh,
    };
    _lastHostPoll = { ...result, at: Date.now() };
    return result;
  } catch (_) {
    return { loadPct: 0, memUsedPct: 0, storagePct: 0, high: false };
  }
}

function getLastHostPoll() {
  return _lastHostPoll;
}

function isHostConstrained() {
  if (_lastHostPoll?.high) return true;
  const sys = getFrictionScore('system');
  return (sys.hotDomains || []).some((d) => d.includes('host_infrastructure') || d.startsWith('nas_'));
}

const FLEET_TELEMETRY_DIR = path.join(__dirname, '..', 'data', 'fleet-telemetry');

function writeHostMetrics(metrics) {
  try {
    fs.mkdirSync(FLEET_TELEMETRY_DIR, { recursive: true });
    const nodeId = metrics.node || 'unknown';
    const file = path.join(FLEET_TELEMETRY_DIR, `node-${nodeId}.json`);
    fs.writeFileSync(file, JSON.stringify({
      ...metrics,
      ts: new Date().toISOString()
    }, null, 2));
  } catch (_) {}
}

function readFleetHealth() {
  try {
    if (!fs.existsSync(FLEET_TELEMETRY_DIR)) return {};
    const files = fs.readdirSync(FLEET_TELEMETRY_DIR).filter(f => f.endsWith('.json'));
    const health = {};
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(FLEET_TELEMETRY_DIR, f), 'utf8'));
        const node = data.node || f.replace('node-', '').replace('.json', '');
        health[node] = data;
      } catch (_) {}
    }
    return health;
  } catch (_) { return {}; }
}

const DELEGATION_DIR = path.join(__dirname, '..', 'data', 'delegated-tasks');

function delegateTaskToPeer(peerNode, task) {
  try {
    fs.mkdirSync(path.join(DELEGATION_DIR, peerNode), { recursive: true });
    const id = task.id || `del-${Date.now()}`;
    const file = path.join(DELEGATION_DIR, peerNode, `${id}.json`);
    fs.writeFileSync(file, JSON.stringify({
      ...task,
      delegated_from: task.node || 'local',
      delegated_at: new Date().toISOString(),
      status: 'delegated'
    }, null, 2));
    return { ok: true, id, peer: peerNode };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function getDelegatedTasks(node = null) {
  try {
    const dir = node ? path.join(DELEGATION_DIR, node) : DELEGATION_DIR;
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      try {
        const task = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (task.status === 'consumed' || task.status === 'completed') return null;
        task._file = f;
        return task;
      } catch { return null; }
    }).filter(Boolean);
  } catch (_) { return []; }
}

function markDelegatedTaskConsumed(node, taskIdOrFile) {
  try {
    const dir = path.join(DELEGATION_DIR, node);
    if (!fs.existsSync(dir)) return false;
    const candidates = [
      path.join(dir, `${taskIdOrFile}.json`),
      path.join(dir, String(taskIdOrFile)),
    ];
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      try {
        const task = JSON.parse(fs.readFileSync(file, 'utf8'));
        task.status = 'consumed';
        task.consumed_at = new Date().toISOString();
        fs.writeFileSync(file, JSON.stringify(task, null, 2));
      } catch (_) {
        fs.unlinkSync(file);
      }
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function markBacklogDelegated(id, peerNode) {
  try {
    if (!fs.existsSync(AUTONOMY_BACKLOG_PATH)) return false;
    const lines = fs.readFileSync(AUTONOMY_BACKLOG_PATH, 'utf8').trim().split('\n').filter(Boolean);
    let updated = false;
    const out = lines.map((line) => {
      try {
        const e = JSON.parse(line);
        if (e.id === id) {
          e.status = 'delegated';
          e.delegated_to = peerNode;
          e.delegated_at = new Date().toISOString();
          e.acquired_by = null;
          updated = true;
        }
        return JSON.stringify(e);
      } catch { return line; }
    });
    if (updated) fs.writeFileSync(AUTONOMY_BACKLOG_PATH, `${out.join('\n')}\n`);
    return updated;
  } catch (_) {
    return false;
  }
}

function readQueueTail(limit = 40) {
  try {
    if (!fs.existsSync(QUEUE_FILE)) return [];
    const lines = fs.readFileSync(QUEUE_FILE, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try { return JSON.parse(line); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function hasRecentConsult(npcName, cooldownMs, sourcePrefix = '') {
  const now = Date.now();
  const folder = String(npcName || '').toLowerCase();
  // After a lesson lands in MEMORY, stay quiet longer so NPCs can apply it.
  const answeredCooldown = Math.max(
    cooldownMs,
    Number(process.env.DENIZEN_CONSULT_ANSWERED_COOLDOWN_MS) || 3 * 60 * 60 * 1000,
  );
  for (const entry of readQueueTail(120).reverse()) {
    if (String(entry.npc || '').toLowerCase() !== folder) continue;
    // Pending always blocks a re-ask (any source).
    if (entry.status === 'pending') return true;
    const ts = Date.parse(entry.answered_at || entry.replied_at || entry.ts || '');
    if (!Number.isFinite(ts)) continue;
    if (entry.status === 'answered') {
      const cool = (entry.memory_injected || entry.answer) ? answeredCooldown : cooldownMs;
      if (now - ts < cool) return true;
      continue;
    }
    if (sourcePrefix && !String(entry.source || '').startsWith(sourcePrefix)) continue;
    if (now - ts < cooldownMs) return true;
  }
  return false;
}

function buildQuestion(npcName, stats, facts, reasons, friction = null) {
  const factLine = facts.length ? facts.join(' ') : 'no dense facts';
  let q = `Threshold cross (${reasons.join(', ')}): `
    + `${npcName} avg_latency=${stats.avg_latency_ms}ms, avg_tokens=${stats.avg_tokens}, `
    + `count=${stats.count}. Facts: ${factLine}. `;
  if (friction && friction.overall >= 15) {
    q += `High friction in ${friction.hotDomains.join('/') || 'core tasks'}. `;
  }
  q += `What specific prompt/skill/memory changes OR small autonomous code feature (via coding-agent) should I build this cycle to reduce friction and improve my autonomy in this domain?`;
  return q;
}

/**
 * @returns {{ triggered: boolean, reasons?: string[], baseline?: object, question?: string }}
 */
function evaluate(npcName, tel, opts = {}) {
  const thresholds = thresholdsFor(npcName);
  const { stats } = resolveNpcStats(tel, npcName);
  if (!stats) return { triggered: false, reason: 'no_stats' };

  const reasons = [];
  // Prefer tokens_in when present (true prompt bloat signal).
  const tokenSignal = Number(stats.avg_tokens_in || stats.avg_tokens || 0);
  if (Number(stats.avg_latency_ms) >= thresholds.latencyMs) {
    reasons.push(`latency>=${thresholds.latencyMs}ms`);
  }
  if (tokenSignal >= thresholds.avgTokens) {
    reasons.push(`tokens>=${thresholds.avgTokens}`);
  }

  // Friction for consults: ignore NAS/host infrastructure noise (not NPC-fixable).
  const friction = getFrictionScore(npcName);
  const details = friction.details || {};
  const actionableDomains = (friction.hotDomains || []).filter(
    (d) => !String(d).startsWith('nas_') && !String(d).includes('host_infrastructure'),
  );
  const actionableScore = actionableDomains.length
    ? Math.max(...actionableDomains.map((d) => Number(details[d]?.score) || 0))
    : 0;
  // Higher bar (40) so sticky old friction doesn't re-spam after a lesson.
  if (actionableScore >= 40) {
    reasons.push(`friction_score>=${actionableScore} (hot: ${actionableDomains.join(',') || 'general'})`);
  }
  if (!reasons.length) return { triggered: false, reason: 'within_thresholds' };

  // Autonomy backlog only for actionable domains
  if (actionableScore >= BACKLOG_FRICTION_THRESHOLD && actionableDomains[0]) {
    maybeEnqueueAutonomyBacklog(npcName, actionableDomains[0]);
  }

  // Global cooldown across all sources so mesh job + metrics don't double-fire.
  const cooldownMs = opts.cooldownMs ?? thresholds.consultCooldownMs;
  if (hasRecentConsult(npcName, cooldownMs, '')) {
    return { triggered: false, reason: 'consult_cooldown' };
  }

  const facts = relevantFacts(tel, npcName);
  const baseline = {
    avg_latency_ms: stats.avg_latency_ms,
    avg_tokens: stats.avg_tokens,
    count: stats.count,
    captured_at: new Date().toISOString(),
    telemetry_generated_at: tel.generatedAt || null,
    friction: friction,
  };

  return {
    triggered: true,
    reasons,
    baseline,
    facts,
    friction,
    question: buildQuestion(npcName, stats, facts, reasons, friction),
    topic: 'metrics-threshold-consult',
  };
}

function enqueueConsult(npcName, payload) {
  const entry = {
    ts: new Date().toISOString(),
    npc: npcName,
    topic: payload.topic || 'metrics-threshold-consult',
    question: payload.question,
    status: 'pending',
    source: payload.source || 'metrics-threshold',
    remediation_tracking: {
      baseline_latency_ms: payload.baseline?.avg_latency_ms,
      baseline_tokens: payload.baseline?.avg_tokens,
      baseline_count: payload.baseline?.count,
      captured_at: payload.baseline?.captured_at,
      reasons: payload.reasons || [],
      audited: false,
    },
  };
  if (payload.facts?.length) entry.facts = payload.facts;
  if (payload.friction) entry.friction = payload.friction;
  fs.appendFileSync(QUEUE_FILE, `${JSON.stringify(entry)}\n`);
  return entry;
}

/**
 * Main entry: call at start of think() after loading telemetry snapshot.
 * @returns {{ triggered: boolean, entry?: object }}
 */
function checkLocalMetrics(npcName, tel = null, opts = {}) {
  const snapshot = tel || loadTelemetry();
  if (!snapshot) return { triggered: false, reason: 'no_telemetry' };

  const verdict = evaluate(npcName, snapshot, opts);
  if (!verdict.triggered) return verdict;

  const entry = enqueueConsult(npcName, {
    ...verdict,
    source: opts.source || 'metrics-threshold',
  });
  return { triggered: true, entry, reasons: verdict.reasons, baseline: verdict.baseline, friction: verdict.friction };
}

module.exports = {
  QUEUE_FILE,
  TELEMETRY_FILE,
  FRICTION_FILE,
  thresholdsFor,
  loadTelemetry,
  resolveNpcStats,
  evaluate,
  enqueueConsult,
  checkLocalMetrics,
  hasRecentConsult,
  recordFriction,
  resetFriction,
  getFrictionScore,
  loadAutonomyBacklog,
  appendBacklog,
  markBacklogInProgress,
  markBacklogDelegated,
  decayAndArchiveStaleBacklog,
  settleBacklogLock,
  expireOrphanedLocks,
  captureSystemError,
  validateCodeChange,
  validateAndSettleBacklog,
  loadNasFriction,
  pollHostInfrastructure,
  getLastHostPoll,
  isHostConstrained,
  writeHostMetrics,
  readFleetHealth,
  delegateTaskToPeer,
  getDelegatedTasks,
  markDelegatedTaskConsumed,
  buildFrictionSummary,
  buildRemediationPrompt,
  maybeEnqueueAutonomyBacklog,
  checkConsultUnansweredFriction,
  BACKLOG_FRICTION_THRESHOLD,
};

/**
 * Pre-flight validation for autonomous code changes (per Claude spec).
 * Runs non-destructive syntax check before accepting a successful self-build.
 */
async function validateCodeChange(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { ok: true, skipped: true, reason: 'no file' };
  }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, '..', filePath);
  if (!fs.existsSync(fullPath)) {
    return { ok: true, skipped: true, reason: 'file not on disk yet' };
  }
  const ext = path.extname(fullPath).toLowerCase();
  try {
    if (['.js', '.mjs', '.cjs'].includes(ext)) {
      await execAsync(`node --check "${fullPath}"`);
      return { ok: true, type: 'node' };
    } else if (ext === '.py') {
      await execAsync(`python -m py_compile "${fullPath}"`);
      return { ok: true, type: 'python' };
    }
    return { ok: true, skipped: true, reason: 'unknown extension' };
  } catch (err) {
    return { ok: false, error: err.message || String(err), file: fullPath };
  }
}

/**
 * Enhanced settlement with pre-flight validation and rollback.
 * Called instead of raw settle for coding-agent successes from backlog.
 */
async function validateAndSettleBacklog(id, success, resultInfo = {}) {
  if (!success) {
    // delegate to existing failure path
    return settleBacklogLock(id, false, resultInfo);
  }

  // Try to validate files if provided in resultInfo or we can infer
  const files = resultInfo.touchedFiles || resultInfo.files || [];
  let allValid = true;
  const errors = [];
  for (const f of files) {
    const v = await validateCodeChange(f);
    if (!v.ok) {
      allValid = false;
      errors.push({ file: f, error: v.error });
    }
  }

  if (!allValid) {
    // Automated rollback: try git checkout for the files
    for (const f of files) {
      try {
        await execAsync(`git checkout -- "${f}"`);
      } catch (_) {
        // fallback: nothing, or we could delete if not in git
      }
    }
    // Treat as failure: increment attempts, release lock
    const failureResult = settleBacklogLock(id, false, {
      ...resultInfo,
      preflight_failed: true,
      validation_errors: errors
    });
    // Optionally trigger escalation if attempts high (handled inside settle)
    return failureResult;
  }

  // All good — proceed with success settlement (zero friction etc.)
  return settleBacklogLock(id, true, resultInfo);
}
