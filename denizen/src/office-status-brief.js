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
};
