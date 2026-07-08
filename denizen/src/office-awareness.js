'use strict';

/**
 * Office-wide narrative awareness for NPC think() prompts.
 * Complements world-state.renderContextBlock (per-NPC live bullets) with
 * team snapshot, business context, and Grok mentor lessons from the consult queue.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_QUEUE_PATH = path.join(__dirname, '..', 'data', 'grok-consult-queue.jsonl');

function readConsultQueue(queuePath = DEFAULT_QUEUE_PATH) {
  try {
    const raw = fs.readFileSync(queuePath, 'utf8');
    return raw.split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function mentorLessonsForNpc(npcName, queue, { max = 2 } = {}) {
  const key = String(npcName || '').toLowerCase();
  return queue
    .filter((row) => String(row.npc || '').toLowerCase() === key && row.answer && row.status === 'answered')
    .slice(-max)
    .map((row) => {
      const q = String(row.question || '').slice(0, 80);
      const a = String(row.answer || '').slice(0, 200);
      return `- Real Grok taught you (re: "${q}"): ${a}`;
    });
}

function pendingConsultHint(npcName, queue) {
  const key = String(npcName || '').toLowerCase();
  const pending = queue.find((row) => String(row.npc || '').toLowerCase() === key && row.status === 'pending');
  if (!pending) return '';
  return `- You asked real Grok for help and are still waiting: "${String(pending.question || '').slice(0, 120)}"`;
}

function compactTeamSnapshot(worldState, { max = 5 } = {}) {
  if (!worldState?.npcs) return '';
  const lines = [];
  for (const name of Object.keys(worldState.npcs).sort()) {
    const s = worldState.npcs[name];
    if (!s) continue;
    const task = String(s.currentTask || s.lastAction || '').trim();
    const state = String(s.state || 'idle').trim();
    if (!task && state === 'idle') continue;
    const room = s.room ? ` (${s.room})` : '';
    lines.push(`${name}: ${task || state}${room}`);
    if (lines.length >= max) break;
  }
  return lines.join('; ');
}

/**
 * Build the "## Current Office Awareness" markdown block for think() prompts.
 * @param {object} opts
 * @param {string} opts.npcName
 * @param {import('./world-state').WorldState|null} [opts.worldState]
 * @param {object} [opts.officeContext]
 * @param {object} [opts.rt] - runtime context (recentWork, etc.)
 * @param {string} [opts.queuePath]
 */
function buildLiveAwarenessBlock(opts = {}) {
  const {
    npcName,
    worldState = null,
    officeContext = null,
    rt = {},
    queuePath = DEFAULT_QUEUE_PATH,
  } = opts;

  const queue = readConsultQueue(queuePath);
  const recent = (rt.recentWork || []).slice(0, 3);
  const recentSummary = recent.length
    ? 'Recent activity: ' + recent.map((w) => `${w.npc || 'Someone'}: ${w.note || w.message || ''}`).join('; ') + '.'
    : 'The office is relatively quiet at the moment.';

  const teamSnap = compactTeamSnapshot(worldState);
  const teamLine = teamSnap ? `Team right now: ${teamSnap}.` : '';

  const meshNote = officeContext?.meshStatus ? `Mesh: ${officeContext.meshStatus}.` : '';
  const crmNote = officeContext?.crmSummary ? `CRM: ${officeContext.crmSummary}.` : '';
  const businessNote = officeContext?.businessContext ? `Business focus: ${officeContext.businessContext}.` : '';

  const mentorLines = mentorLessonsForNpc(npcName, queue);
  const pending = pendingConsultHint(npcName, queue);

  const body = [
    recentSummary,
    teamLine,
    meshNote,
    crmNote,
    businessNote,
    pending,
    mentorLines.length ? 'Mentor lessons to apply now:\n' + mentorLines.join('\n') : '',
  ].filter(Boolean).join('\n');

  if (!body.trim()) return '';

  return [
    '## Current Office Awareness (use this to be specific and aware)',
    body,
    'Speak naturally about what is actually happening — mesh/CRM/pipeline, teammates, mentor lessons, and the full office map. Move between rooms, initiate conversations, and act on blockers instead of generic status.',
  ].join('\n');
}

module.exports = {
  DEFAULT_QUEUE_PATH,
  readConsultQueue,
  mentorLessonsForNpc,
  pendingConsultHint,
  compactTeamSnapshot,
  buildLiveAwarenessBlock,
};
