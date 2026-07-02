'use strict';

/**
 * Live office-wide status for player chat — "what is everyone doing?"
 */

const OFFICE_STATUS_PATTERNS = [
  /\b(?:what|give me a|can you give(?: me)?(?: a)?)\s+(?:summary of\s+)?(?:what\s+)?(?:everyone|everybody|the team|people|staff|teammates?|coworkers?)\s+(?:is|are)\s+doing\b/i,
  /\bwhat(?:'s| is)\s+(?:everyone|everybody|the team|the office)\s+(?:up to|working on|doing)\b/i,
  /\b(?:who(?:'s| is)|what(?:'s| is))\s+working on what\b/i,
  /\boffice(?:-wide)?\s+status\b/i,
  /\b(?:team|office)\s+(?:activity|status|update|overview|brief|snapshot)\b/i,
  /\bwhat(?:'s| is)\s+going on (?:in|around) the office\b/i,
  /\b(?:status|update)\s+(?:on|for|of)\s+(?:the\s+)?(?:team|everyone|office)\b/i,
];

const NPC_FIND_PATTERNS = [
  /\bwhere(?:'s| is)\s+/i,
  /\b(?:go |please )?(?:check on|find|look for|go see|go to|visit)\s+/i,
  /\bcan you (?:find|locate|check on)\s+/i,
];

/** Common voice/STT aliases → roster display name */
const NPC_ALIASES = {
  abby: 'Abby',
  cto: 'Abby',
  alex: 'Alex',
  bob: 'Bob',
  jenny: 'Jenny',
  dan: 'Dan',
  lucy: 'Lucy',
  bouncer: 'Bouncer',
  marcus: 'Marcus',
  sarah: 'Sarah',
  edward: 'Edward',
  josh: 'Josh',
  molly: 'Molly',
  oscar: 'Oscar',
  pier: 'Pier',
  rob: 'Rob',
  roki: 'Roki',
  grok: 'Grok',
  claude: 'Claude',
};

function resolveNpcMention(message, knownNames = []) {
  const msg = String(message || '').toLowerCase();
  for (const [alias, name] of Object.entries(NPC_ALIASES)) {
    if (new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(msg)) {
      return name;
    }
  }
  const names = knownNames.length ? knownNames : Object.values(NPC_ALIASES);
  const uniq = [...new Set(names)];
  for (const name of uniq) {
    if (msg.includes(String(name).toLowerCase())) return name;
  }
  return null;
}

function isNpcFindQuery(message) {
  const msg = String(message || '').trim();
  if (!msg || msg.length < 4) return false;
  if (!NPC_FIND_PATTERNS.some((re) => re.test(msg))) return false;
  return !!resolveNpcMention(msg);
}

function describeNpcLocation(ws, npcName) {
  const s = ws?.npcs?.[npcName];
  if (!s) return `I don't have a live read on ${npcName} right now.`;
  const room = s.room ? String(s.room).replace(/_/g, ' ') : 'somewhere in the office';
  const task = String(s.currentTask || s.state || 'at desk').trim();
  const pos = s.position
    ? ` around (${Math.round(s.position.x)}, ${Math.round(s.position.y)})`
    : '';
  return `${npcName} is in the ${room}${pos} — ${task}.`;
}

function buildNpcFindReply(ws, message) {
  const target = resolveNpcMention(message);
  if (!target) return null;
  const loc = describeNpcLocation(ws, target);
  return {
    target,
    text: `On it — I'll find ${target}. ${loc}`,
    actions: [{ action: 'visitCoworker', params: [target, 'CEO asked me to check on you'] }],
  };
}

function isOfficeStatusQuery(message) {
  const msg = String(message || '').trim();
  if (!msg || msg.length < 10) return false;
  return OFFICE_STATUS_PATTERNS.some((re) => re.test(msg));
}

function buildBrief(ws) {
  if (!ws) return 'Office status is unavailable right now — try the work feed (Tab).';

  const npcs = ws.npcs || {};
  const names = Object.keys(npcs).sort();
  const lines = [];
  let activeCount = 0;

  for (const name of names) {
    const s = npcs[name];
    if (!s) continue;
    const task = String(s.currentTask || s.lastAction || '').trim();
    const state = String(s.state || 'idle').trim();
    const room = s.room ? ` (${s.room})` : '';
    if (task || (state && state !== 'idle')) {
      activeCount += 1;
      lines.push(`• ${name}: ${task || state}${room}`);
    }
  }

  if (!lines.length) {
    for (const name of names.slice(0, 14)) {
      const s = npcs[name];
      lines.push(`• ${name}: ${s?.state || 'at desk'}${s?.room ? ` (${s.room})` : ''}`);
    }
  }

  const env = ws.environment || {};
  if (env.meetingInProgress) {
    const att = Array.isArray(env.meetingAttendees)
      ? env.meetingAttendees.join(', ')
      : 'team';
    lines.unshift(`Meeting in progress with ${att}.`);
  }

  const bg = Array.isArray(ws.backgroundTasks) ? ws.backgroundTasks : [];
  const running = bg.filter((t) => String(t?.status || '').toLowerCase() === 'running');
  if (running.length) {
    lines.push(`Background: ${running.map((t) => t.title || t.id).filter(Boolean).slice(0, 3).join('; ')}`);
  }

  const events = Array.isArray(ws.recentEvents) ? ws.recentEvents : [];
  if (events.length) {
    const recent = events.slice(0, 3).map((e) => e.text).filter(Boolean);
    if (recent.length) lines.push(`Recent: ${recent.join(' · ')}`);
  }

  const header = activeCount
    ? `Here's what the team is up to (${activeCount} active):`
    : 'Office snapshot:';

  const body = lines.slice(0, 14).join('\n');
  return `${header}\n${body || 'Everyone is at their desks.'}`.slice(0, 1900);
}

module.exports = {
  isOfficeStatusQuery,
  buildBrief,
  OFFICE_STATUS_PATTERNS,
  isNpcFindQuery,
  resolveNpcMention,
  describeNpcLocation,
  buildNpcFindReply,
  NPC_ALIASES,
};
