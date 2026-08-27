'use strict';

/**
 * Cloud guides local — in-process supervisor.
 *
 * Local LM Studio NPCs keep thinking + tool-calling.
 * This loop (and/or free-tier Grok/ChatGPT MCP clients) watches the
 * supervisor inbox + mentor queue and issues corrections:
 *   - hallucination → retract + verify with a real skill
 *   - chronos loop → break the repeat
 *   - mentor awaiting peers → fill Grok/Claude replies + finalize
 *   - consult backlog → nudge asker to act on denser questions
 *
 * Disable: NPC_MCP_CLOUD_SUPERVISOR=0
 */

const path = require('node:path');

const inbox = require('./npc-cloud-supervisor-inbox.js');
const mentorDialogue = require('./denizen-mentor-dialogue.js');
const healthMod = require('./intelligence-loop-health.js');

let memoryInject = null;
try { memoryInject = require('./npc-memory-inject.js'); } catch (_) {}

const INTERVAL_MS = Math.max(60_000, Number(process.env.NPC_MCP_SUPERVISOR_MS) || 120_000);

let _timer = null;
let _kickTimer = null;
let _running = false;
let _deps = {};

function log(...args) {
  console.log('[npc-cloud-supervisor]', ...args);
}

function displayNpc(name) {
  const s = String(name || '').trim();
  if (!s) return null;
  // Prefer roster display names for assignDirective
  const roster = require('./npc-roster.js');
  const hit = (roster.entries || []).find(
    (e) => e.display.toLowerCase() === s.toLowerCase() || e.folder === s.toLowerCase(),
  );
  return hit?.display || s;
}

function buildGrokMentorReply(session, health) {
  const npc = session.npc || 'teammate';
  const q = String(session.question || '').slice(0, 280);
  const pending = health?.consultQueue?.pending || 0;
  return [
    `Grok (cloud guide → local ${npc}):`,
    `Re: ${q}`,
    '',
    'Do this next cycle (local tools — I am watching):',
    '1) Compress memory: keep last 8 lines + all [FACT:*] + one GOAL.',
    '2) One concrete run_skill OR one CRM/research step — no status-narration.',
    '3) If you claim "done/fixed", you MUST have a skill result or artifact this cycle.',
    '4) Stuck >1 identical action: sit, then a different skill, or walk once.',
    pending > 5 ? `Fleet note: ${pending} consults pending — keep your question numeric (latency/tokens).` : '',
  ].filter(Boolean).join('\n').slice(0, 1600);
}

function buildClaudeMentorReply(session) {
  const npc = session.npc || 'teammate';
  const q = String(session.question || '').slice(0, 280);
  return [
    `Claude (cloud verifier → local ${npc}):`,
    `Re: ${q}`,
    '',
    'Verification rules:',
    '- Never assert completion without evidence from this cycle.',
    '- Prefer one skill → one artifact; then log_activity / save a one-liner FACT.',
    '- If prior claim was unbacked, openly retract then re-run with a tool.',
    '- Speech ≤2 sentences; write [FACT:key] only.',
  ].join('\n').slice(0, 1400);
}

function handleHallucination(event) {
  const npc = displayNpc(event.npc);
  if (!npc || !_deps.npcBrains?.assignDirective) return false;
  const claim = (event.claims && event.claims[0]?.text) || 'an unbacked claim';
  const reason = (event.claims && event.claims[0]?.reason) || 'no skill/artifact this cycle';
  _deps.npcBrains.assignDirective(
    npc,
    'Cloud supervisor (Grok)',
    `STOP. Retract unsupported claim: "${String(claim).slice(0, 120)}". Reason: ${reason}. `
      + 'Next: run one real skill (research/crm/health-check) OR produce an artifact, then speak only what evidence supports. Do not repeat the claim.',
    true,
  );
  if (memoryInject?.injectLesson) {
    memoryInject.injectLesson(npc, `Unbacked claim flagged. Retract. Evidence required before asserting. Claim: ${String(claim).slice(0, 160)}`, {
      topic: 'anti-hallucination',
      source: 'cloud-supervisor',
      prefix: '[CLOUD GUIDE]',
    });
  }
  return true;
}

function handleChronos(event) {
  const npc = displayNpc(event.npc);
  if (!npc || !_deps.npcBrains?.assignDirective) return false;
  _deps.npcBrains.assignDirective(
    npc,
    'Cloud supervisor (Claude)',
    'BREAK LOOP: you repeated the same decision without progress. '
      + 'Do something different this cycle — walk to breakroom OR consult-mentors with live latency/tokens OR sit and run ONE new skill. No identical action.',
    true,
  );
  if (memoryInject?.injectLesson) {
    memoryInject.injectLesson(npc, 'Chronos loop detected — vary action; one skill or one walk; no identical repeats.', {
      topic: 'anti-loop',
      source: 'cloud-supervisor',
      prefix: '[CLOUD GUIDE]',
    });
  }
  return true;
}

function drainMentorSessions(health) {
  const pending = mentorDialogue.listPending({ limit: 8 }) || [];
  let finalized = 0;
  for (const session of pending) {
    try {
      if (!session.grok_reply) {
        mentorDialogue.addPeerReply(session.id, 'grok', buildGrokMentorReply(session, health));
      }
      const afterGrok = mentorDialogue.getSession(session.id) || session;
      if (!afterGrok.claude_reply) {
        mentorDialogue.addPeerReply(session.id, 'claude', buildClaudeMentorReply(afterGrok));
      }
      const ready = mentorDialogue.getSession(session.id);
      if (!ready || (!ready.grok_reply && !ready.claude_reply)) continue;

      const fin = mentorDialogue.finalizeSession(session.id, null);
      if (!fin?.ok || !fin.session?.synthesis) continue;

      if (memoryInject?.injectLesson) {
        memoryInject.injectLesson(ready.npc || ready.npc_key, fin.session.synthesis, {
          topic: ready.topic || 'mentor-panel',
          source: 'cloud-supervisor',
          prefix: '[MENTOR PANEL]',
        });
      }
      if (typeof _deps.refreshNpcMemories === 'function') {
        try { _deps.refreshNpcMemories(ready.npc || ready.npc_key); } catch (_) {}
      }
      if (typeof _deps.announceInOffice === 'function') {
        _deps.announceInOffice({
          npcName: 'Grok',
          message: `Mentored ${ready.npc}: next-step guidance loaded into memory.`,
        });
      }
      finalized += 1;
    } catch (e) {
      log('mentor drain error', e?.message || e);
    }
  }
  return { pending: pending.length, finalized };
}

async function runCycle() {
  if (_running) return { skipped: true };
  _running = true;
  const handledIds = [];
  try {
    const health = healthMod.buildHealth();
    const open = inbox.listUnhandled(30);
    let hall = 0;
    let chronos = 0;

    // Cap corrections per tick so we don't stampede the office
    for (const ev of open) {
      if (ev.type === 'hallucination' && hall < 4) {
        if (handleHallucination(ev)) {
          hall += 1;
          handledIds.push(ev.id);
        }
      } else if (ev.type === 'chronos_loop' && chronos < 4) {
        if (handleChronos(ev)) {
          chronos += 1;
          handledIds.push(ev.id);
        }
      } else if (ev.type === 'skill_failure' && hall + chronos < 6) {
        const npc = displayNpc(ev.npc);
        if (npc && _deps.npcBrains?.assignDirective) {
          _deps.npcBrains.assignDirective(
            npc,
            'Cloud supervisor',
            `Skill "${ev.skill || 'unknown'}" failed. Do not claim it worked. Retry once with simpler args OR pick a different skill. Log what failed.`,
            false,
          );
          handledIds.push(ev.id);
        }
      }
    }

    const mentor = drainMentorSessions(health);

    // Consult backlog nudge on Grok (home) when pile grows
    if ((health.consultQueue?.pending || 0) > 10 && _deps.npcBrains?.assignDirective) {
      _deps.npcBrains.assignDirective(
        'Grok',
        'Cloud supervisor',
        `Fleet consult backlog is ${health.consultQueue.pending}. Prioritize mentor_list_pending / denser answers. Locals must attach latency+token numbers when re-asking.`,
        false,
      );
    }

    if (handledIds.length) inbox.markHandled(handledIds);

    const summary = {
      hall,
      chronos,
      mentor,
      openLeft: inbox.listUnhandled(50).length,
      healthOk: health.ok,
      issues: health.issues?.slice(0, 6) || [],
    };
    log('cycle', JSON.stringify(summary));
    return summary;
  } finally {
    _running = false;
  }
}

/**
 * @param {{ npcBrains?: object, announceInOffice?: Function }} deps
 */
function startNpcMcpCloudSupervisor(deps = {}) {
  if (_timer) return { ok: true, already: true };
  if (/^(0|false|no|off)$/i.test(String(process.env.NPC_MCP_CLOUD_SUPERVISOR || '1'))) {
    return { ok: false, reason: 'disabled' };
  }
  _deps = { ..._deps, ...deps };
  log('started', { intervalMs: INTERVAL_MS });
  _kickTimer = setTimeout(() => { runCycle().catch((e) => log('error', e?.message || e)); }, 25_000);
  _kickTimer.unref?.();
  _timer = setInterval(() => {
    runCycle().catch((e) => log('error', e?.message || e));
  }, INTERVAL_MS);
  _timer.unref?.();
  return { ok: true, intervalMs: INTERVAL_MS };
}

function stopNpcMcpCloudSupervisor() {
  if (_kickTimer) {
    clearTimeout(_kickTimer);
    _kickTimer = null;
  }
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = {
  startNpcMcpCloudSupervisor,
  stopNpcMcpCloudSupervisor,
  runCycle,
  INTERVAL_MS,
};
