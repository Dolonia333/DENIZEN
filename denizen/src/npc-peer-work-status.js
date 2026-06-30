'use strict';

/**
 * Real work-status replies for peer npc_conversation — not ambient replay.
 * Social chatter stays scripted; status/blocker questions read live task state.
 */

const STATUS_PATTERNS = [
  /\b(did you|have you|did\s+\w+)\s+(finish|done|complete|ship|fix|deploy|merge|push)\b/i,
  /\b(status|update|progress)\s+(on|for|of)\b/i,
  /\bhow(?:'s| is)\s+.+\s+(going|coming|looking)\b/i,
  /\b(is|are)\s+.+\s+(done|ready|up|finished|blocked)\b/i,
  /\bwhere\s+(are you|do we stand)\s+(on|with)\b/i,
  /\b(blocked|stuck|waiting)\s+on\b/i,
  /\bquick\s+sync\b/i,
  /\bgot\s+a\s+minute\b.*\b(status|update|progress)\b/i,
];

const NPC_NAMES = [
  'Abby', 'Alex', 'Marcus', 'Sarah', 'Edward', 'Josh', 'Molly', 'Oscar', 'Pier', 'Rob',
  'Roki', 'Bouncer', 'Dan', 'Lucy', 'Jenny', 'Bob',
];

function isWorkStatusQuery(message) {
  const msg = String(message || '').trim();
  if (!msg || msg.length < 8) return false;
  return STATUS_PATTERNS.some((re) => re.test(msg));
}

function resolveSubjectNpc(message, responder) {
  const msg = String(message || '');
  for (const name of NPC_NAMES) {
    if (name === responder) continue;
    const re = new RegExp(`\\b${name}\\b`, 'i');
    if (re.test(msg)) return name;
  }
  return responder;
}

function formatTaskLine(npcName, brains) {
  const task = brains?._taskProgress?.[npcName] || null;
  let last = null;
  if (typeof brains?._officeRuntime === 'function') {
    const rt = brains._officeRuntime('global');
    last = rt?.lastDecisions?.[npcName] || null;
  }
  if (task?.task) {
    const phase = task.phase || 'in-progress';
    return `${npcName} is on "${task.task}" (${phase}${task.startedAt ? `, since ${task.startedAt}` : ''}).`;
  }
  if (last?.action) {
    const tail = last.target ? ` with ${last.target}` : '';
    return `${npcName} last action: ${last.action}${tail}${last.thought ? ` — ${String(last.thought).slice(0, 80)}` : ''}.`;
  }
  return `${npcName} has no active task on the board right now.`;
}

function formatDirectiveLine(npcName, brains) {
  const dir = brains?.getDirective?.(npcName) || brains?._directives?.get(npcName);
  if (!dir?.task) return '';
  return ` Direct order from ${dir.from}: "${String(dir.task).slice(0, 100)}".`;
}

function formatSkillPending(npcName, brains) {
  const pending = brains?._pendingSkillResults?.get(npcName);
  if (!pending) return '';
  return ` Waiting on ${pending.skill} output from the last tool run.`;
}

/**
 * Build a factual peer status reply, or null if not a work-status query.
 */
function buildWorkStatusReply(npcBrains, responder, fromName, message) {
  if (!isWorkStatusQuery(message)) return null;

  const subject = resolveSubjectNpc(message, responder);
  const taskLine = formatTaskLine(subject, npcBrains);
  const directiveLine = formatDirectiveLine(subject, npcBrains);
  const skillLine = formatSkillPending(subject, npcBrains);

  if (subject !== responder) {
    return `${taskLine}${directiveLine}${skillLine}`.slice(0, 200);
  }

  const greeting = fromName ? `Hey ${fromName}, ` : '';
  return `${greeting}${taskLine}${skillLine}${directiveLine}`.slice(0, 200);
}

module.exports = {
  isWorkStatusQuery,
  buildWorkStatusReply,
  resolveSubjectNpc,
};
