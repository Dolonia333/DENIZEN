'use strict';

const fs = require('fs');
const path = require('path');

const jobCrmDefault = require('../pipelines/job-crm');
const {
  runDailyDigest,
  runScheduledResearch,
} = require('./away-notify');

let researchQueueMod = null;
try { researchQueueMod = require('./research-queue'); } catch (_) {}

const ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'data', 'research-scheduler-state.json');
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function _readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (_) {
    return {};
  }
}

function _writeState(nextState) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2), 'utf8');
  } catch (_) {}
}

function _safeBroadcast(broadcast, payload) {
  if (typeof broadcast !== 'function') return;
  try { broadcast(payload); } catch (_) {}
}

function _localEightAm(reference = new Date()) {
  return new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate(),
    8, 0, 0, 0
  );
}

function startScheduler(deps = {}, opts = {}) {
  const jobCrm = deps.jobCrm || jobCrmDefault;
  const intervalMs = Number(opts.intervalMs) || SIX_HOURS_MS;
  const immediate = opts.immediate !== false;

  const runTick = async () => {
    if (jobCrm && typeof jobCrm.runMaintenance === 'function') {
      try {
        await jobCrm.runMaintenance({
          npcBrains: deps.npcBrains,
          broadcast: deps.broadcast,
        });
      } catch (err) {
        _safeBroadcast(deps.broadcast, {
          type: 'research_scheduler_error',
          scope: 'job-crm-maintenance',
          error: err?.message || String(err),
          ts: Date.now(),
        });
      }
    }

    try {
      const result = await runScheduledResearch(deps);
      if (result && result.started) {
        _safeBroadcast(deps.broadcast, {
          type: 'research_scheduler_started',
          item: result.item,
          assignedTo: result.assignedTo,
          ts: Date.now(),
        });
      }
    } catch (err) {
      _safeBroadcast(deps.broadcast, {
        type: 'research_scheduler_error',
        scope: 'scheduled-research',
        error: err?.message || String(err),
        ts: Date.now(),
      });
    }

    // Targeted lead gen seeding (low freq): auto queue business prospects tied to 1921/OMES focus
    if (Math.random() < 0.12 && researchQueueMod && typeof researchQueueMod.addTopic === 'function') {
      const leadTopics = [
        'OMES EV00000919 teaming partners RM Cyber 2026',
        'Oklahoma federal GovCon contractors needing modernization tools',
        'RM Cyber partnership opportunities 1921',
        'WOSB SDB capture prospects AI office software federal',
      ];
      try {
        const t = leadTopics[Math.floor(Math.random() * leadTopics.length)];
        researchQueueMod.addTopic({ topic: t, priority: 7, assignedTo: 'Bob', notes: 'auto lead-gen from scheduler' });
        _safeBroadcast(deps.broadcast, { type: 'research_scheduler_started', item: { topic: t }, assignedTo: 'Bob', ts: Date.now() });
      } catch (_) {}
    }
  };

  if (immediate) {
    runTick().catch(() => {});
    // Seed a couple lead-gen topics early if queue is empty or short (helps demo autonomy)
    setTimeout(() => {
      try {
        if (researchQueueMod && typeof researchQueueMod.listTopics === 'function') {
          const current = researchQueueMod.listTopics({ limit: 5 }) || [];
          if (current.length < 3) {
            researchQueueMod.addTopic({ topic: 'OMES teaming partners and similar GovCon modernization needs 2026', priority: 8, assignedTo: 'Bob', notes: 'lead-gen seed' });
            researchQueueMod.addTopic({ topic: 'WOSB/SDB contractors in Oklahoma or federal IT looking for capture tools', priority: 7, assignedTo: 'Bob', notes: 'lead-gen seed' });
          }
        }
      } catch (_) {}
    }, 8000);
  }
  const timer = setInterval(() => { runTick().catch(() => {}); }, intervalMs);

  return {
    timer,
    intervalMs,
    stop() { clearInterval(timer); },
  };
}

function startDailyDigestCron(deps = {}) {
  const checkEveryMs = Number(deps.digestCheckMs) || (15 * 60 * 1000);
  const state = _readState();

  const runDigest = async (now) => {
    const text = await runDailyDigest(deps);
    const current = _readState();
    const firstDigestAt = current.firstDigestAt || now.toISOString();
    _writeState({
      ...current,
      firstDigestAt,
      lastDigestAt: now.toISOString(),
      lastDigestPreview: String(text || '').slice(0, 500),
    });
    _safeBroadcast(deps.broadcast, {
      type: 'daily_digest_sent',
      at: now.toISOString(),
      ts: Date.now(),
    });
  };

  const shouldRunNow = (now) => {
    const current = _readState();
    const firstDigestAt = current.firstDigestAt ? new Date(current.firstDigestAt).getTime() : 0;
    const lastDigestAt = current.lastDigestAt ? new Date(current.lastDigestAt).getTime() : 0;

    if (!firstDigestAt) {
      const eightAm = _localEightAm(now).getTime();
      return now.getTime() >= eightAm;
    }

    return now.getTime() - lastDigestAt >= DAY_MS;
  };

  const tick = async () => {
    const now = new Date();
    if (!shouldRunNow(now)) return;
    try {
      await runDigest(now);
    } catch (err) {
      _safeBroadcast(deps.broadcast, {
        type: 'research_scheduler_error',
        scope: 'daily-digest',
        error: err?.message || String(err),
        ts: Date.now(),
      });
    }
  };

  tick().catch(() => {});
  const timer = setInterval(() => { tick().catch(() => {}); }, checkEveryMs);

  return {
    timer,
    checkEveryMs,
    stop() { clearInterval(timer); },
  };
}

function startAll(deps = {}) {
  const scheduler = startScheduler(deps, deps.schedulerOptions || {});
  const digestCron = startDailyDigestCron(deps);
  return {
    scheduler,
    digestCron,
    stop() {
      try { scheduler.stop(); } catch (_) {}
      try { digestCron.stop(); } catch (_) {}
    },
  };
}

module.exports = {
  startScheduler,
  startDailyDigestCron,
  startAll,
  _STATE_FILE: STATE_FILE,
};
