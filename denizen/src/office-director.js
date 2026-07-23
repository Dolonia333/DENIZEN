'use strict';
/**
 * office-director.js — algorithmic planner for routine NPC office behavior.
 *
 * When DENIZEN_HYBRID_DIRECTOR=true, npc-brains.think() uses this instead of
 * LM Studio for predictable cycles (work, break, desk visits, ambient talk).
 * Player chat, directives, escalations, and run_skill still use the LLM.
 */

let promptTuning = null;
let ambientDialogue = null;
try { promptTuning = require('./prompt-tuning'); } catch (_) {}
try { ambientDialogue = require('./ambient-dialogue'); } catch (_) {}

const ROOM_BY_ACTION = {
  work: 'desk',
  break: 'breakroom',
  coffee: 'breakroom',
  read: 'open_office',
  wander: 'open_office',
  meeting: 'conference',
  check: 'open_office',
};

const ROOM_AFFINITY = {
  Abby: 'manager_office',
  Marcus: 'conference',
  Sarah: 'conference',
  Lucy: 'reception',
  Pier: 'reception',
  Bouncer: 'reception',
  Dan: 'storage',
  Oscar: 'storage',
  Molly: 'open_office',
  Rob: 'open_office',
  Bob: 'open_office',
};

function isEnabled() {
  if (process.env.DENIZEN_HYBRID_DIRECTOR === 'false') return false;
  if (process.env.DENIZEN_HYBRID_DIRECTOR === 'true') return true;
  return promptTuning?.hybridDirector === true;
}

function isManager(h) {
  return Boolean(h?.manages?.length);
}

/** Deterministic 0..99 from npc + cycle — stable variety without Math.random spam. */
function seed(npcName, cycles, salt = 0) {
  const s = String(npcName || '');
  return (s.length * 17 + (cycles || 0) * 13 + salt * 7) % 100;
}

function needsLlm(npcName, ctx = {}) {
  const inbox = ctx.inbox || [];
  if (inbox.some((m) => m.kind === 'escalate')) return true;
  if (ctx.hasDirective) return true;
  if (ctx.pendingSkill) return true;
  if (ctx.forceLlm) return true;

  // Starvation escape. Without this the roll table can veto an NPC forever:
  // production measured 14 of 16 NPCs going a FULL 24h without a single
  // think() (Roki 30, Bob 2, everyone else zero). Guarantee every NPC a real
  // think at least every N vetoed cycles so it actually inhabits the character
  // instead of running as a pure script. Tune via DENIZEN_THINK_STARVE_CYCLES.
  const starveAfter = Number(process.env.DENIZEN_THINK_STARVE_CYCLES) || 3;
  if ((ctx.cyclesSinceLlm || 0) >= starveAfter) return true;

  if (ctx.realWorkMode) {
    const threshold = ctx.realWorkThreshold ?? 6;
    if ((ctx.cyclesSinceSkill || 0) >= threshold) return true;
  }

  // Urgent peer mail — let the brain reason about it.
  if (inbox.some((m) => /urgent|blocked|escalat|direct order|ceo|zion/i.test(m.text || ''))) {
    return true;
  }

  return false;
}

function pickTalkLine(mgr, npcName, target) {
  if (ambientDialogue?.generateAmbientPair) {
    try {
      const pair = ambientDialogue.generateAmbientPair(npcName, target, mgr);
      if (pair?.opener) return pair.opener.slice(0, 120);
    } catch (_) {}
  }
  const lines = [
    `Hey ${target}, quick sync?`,
    `${target}, got a minute?`,
    `Checking in with you, ${target}.`,
  ];
  return lines[seed(npcName, 0, target.length) % lines.length];
}

function pickTarget(mgr, npcName, action, cycles) {
  const h = mgr._hierarchy?.[npcName];
  if (!h) return null;

  if (action === 'report' || (action === 'talk' && seed(npcName, cycles, 2) < 35)) {
    if (h.reportsTo && h.reportsTo !== 'CEO') return h.reportsTo;
  }

  if (isManager(h) && (action === 'talk' || action === 'visit')) {
    const reports = h.manages.filter((n) => n !== npcName);
    if (reports.length) return reports[seed(npcName, cycles, 5) % reports.length];
  }

  const teams = mgr._getTeamsForNpc?.(npcName) || [];
  const peers = new Set();
  for (const t of teams) {
    for (const m of t.members || []) {
      if (m !== npcName) peers.add(m);
    }
  }
  const peerList = [...peers];
  if (peerList.length) return peerList[seed(npcName, cycles, 9) % peerList.length];

  return null;
}

function pickAction(npcName, h, cycles, dailyPlan) {
  const roll = seed(npcName, cycles);
  const mgr = isManager(h);

  if (cycles >= 4) {
    if (roll < 55) return 'break';
    if (roll < 75) return 'coffee';
  }

  if (mgr) {
    if (roll < 35) return 'work';
    if (roll < 65) return roll < 50 ? 'talk' : 'visit';
    if (roll < 80) return 'check';
    if (roll < 90) return 'collaborate';
    if (roll < 96) return 'meeting';
    return 'wander';
  }

  if (roll < 45) return 'work';
  if (roll < 75) return roll < 60 ? 'talk' : 'visit';
  if (roll < 85) return 'collaborate';
  if (roll < 92) return 'break';
  if (roll < 97) return 'check';
  return 'wander';
}

function taskLine(npcName, dailyPlan, cycles) {
  const priorities = dailyPlan?.priorities || [];
  if (priorities.length) {
    return priorities[seed(npcName, cycles) % priorities.length];
  }
  return 'Continuing sprint work at my desk.';
}

function plan(mgr, npcName, ctx = {}) {
  const brain = mgr.brains?.[npcName];
  const h = mgr._hierarchy?.[npcName];
  const cycles = ctx.cycles || 0;
  const lastDecision = ctx.lastDecision;
  const taskProgress = ctx.taskProgress;
  const dailyPlan = mgr.getDailyPlan?.(npcName) || null;

  let action = pickAction(npcName, h, cycles, dailyPlan);

  // Don't stack meetings; conference is rare in director mode.
  if (action === 'meeting' && (mgr._lastNpcMeetingAt?.get(npcName) || 0) > Date.now() - 300000) {
    action = 'talk';
  }

  if (lastDecision?.action === 'break' && cycles < 2) {
    action = 'work';
  }

  const target = ['talk', 'visit', 'collaborate', 'report', 'meeting'].includes(action)
    ? pickTarget(mgr, npcName, action, cycles)
    : null;

  let location = ROOM_BY_ACTION[action] || 'desk';
  if (action === 'visit' && target) location = 'open_office';
  if (ROOM_AFFINITY[npcName] && ['wander', 'check', 'read'].includes(action)) {
    location = ROOM_AFFINITY[npcName];
  }

  const priority = taskLine(npcName, dailyPlan, cycles);
  let taskPhase = 'continuing';
  let save = priority;
  let message = '';
  let thought = '';

  if (action === 'work') {
    if (!taskProgress) taskPhase = 'starting';
    thought = taskProgress
      ? `Still on: ${taskProgress.task?.slice(0, 50) || priority.slice(0, 50)}`
      : `Starting: ${priority.slice(0, 50)}`;
    save = taskProgress ? `Continuing ${taskProgress.task?.slice(0, 60) || priority.slice(0, 60)}` : `Starting ${priority.slice(0, 60)}`;
  } else if (action === 'break' || action === 'coffee') {
    taskPhase = 'none';
    thought = 'Need a short break.';
    message = action === 'coffee' ? 'Grabbing coffee.' : 'Taking a quick break.';
    save = message;
  } else if (action === 'talk' || action === 'collaborate') {
    taskPhase = 'none';
    message = target ? pickTalkLine(mgr, npcName, target) : '';
    thought = target ? `Checking in with ${target}.` : 'Quick hallway chat.';
    save = target ? `Talked to ${target}.` : 'Brief coworker check-in.';
  } else if (action === 'visit') {
    taskPhase = 'none';
    message = '';
    thought = target ? `Walking over to ${target}'s desk.` : 'Making the rounds.';
    save = target ? `Visited ${target}'s desk.` : 'Office walk-through.';
  } else if (action === 'meeting') {
    taskPhase = 'starting';
    message = target ? `${target}, quick sync in the conference room?` : 'Heading to the conference room.';
    thought = 'Time for a focused sync.';
    save = `Meeting${target ? ` with ${target}` : ''} scheduled.`;
  } else if (action === 'check') {
    taskPhase = 'continuing';
    thought = 'Scanning sprint board and team status.';
    save = 'Sprint check — nothing blocked that I can see.';
  } else {
    taskPhase = 'none';
    thought = 'Stretching my legs around the office.';
    save = 'Short walk through the office.';
  }

  return {
    action,
    target,
    location,
    message,
    thought,
    taskPhase,
    save,
    outcome: 'ok',
    skill: null,
    skillParams: null,
    _director: true,
    reasoning: 'Office director: routine cycle from role schedule and daily plan.',
    plan: `${action}${target ? ` → ${target}` : ''} @ ${location}`,
  };
}

module.exports = {
  isEnabled,
  needsLlm,
  plan,
  ROOM_AFFINITY,
};
