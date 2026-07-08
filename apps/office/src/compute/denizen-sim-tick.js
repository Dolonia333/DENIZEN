'use strict';

/**
 * Lightweight mesh sim tick — no LLM. Advances ambient office simulation hints.
 */
function runSimTick(payload = {}) {
  const tickMs = Math.max(16, Number(payload.tick_ms) || 33);
  const npcIds = Array.isArray(payload.npc_ids) ? payload.npc_ids : [];
  const moodDecay = Number(payload.mood_decay) || 0.02;
  const meetingActive = !!payload.meeting_active;

  return {
    ok: true,
    jobType: 'sim_tick',
    tick_ms: tickMs,
    world_delta: {
      npc_updates: npcIds.length,
      mood_decay_applied: moodDecay,
      meeting_active: meetingActive,
      events: meetingActive ? ['meeting_tick'] : ['ambient_tick'],
      hinted_npcs: npcIds.slice(0, 16),
    },
    completed_at: new Date().toISOString(),
  };
}

module.exports = {
  runSimTick,
};
