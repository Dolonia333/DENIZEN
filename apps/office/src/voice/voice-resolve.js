'use strict';
/**
 * Resolve ElevenLabs voice IDs from NPC roster gender + voice-map.json.
 * Used at server startup and by scripts/tts-smoke.js.
 */

/** ElevenLabs premade library voices — one distinct voice per slot in rotation. */
const GENDER_VOICE_POOLS = {
  female: [
    '21m00Tcm4TlvDq8ikWAM', // Rachel
    'EXAVITQu4vr4xnSDxMaL', // Sarah
    'AZnzlk1XvdvUeBnXmlld', // Domi
    'LcfcDJNUP1GQjkzn1xUU', // Emily
    'MF3mGyEYCl7XYWbV9V6O', // Elli
  ],
  male: [
    'ErXwobaYiN019PkySvjV', // Antoni
    '29vD33N1CtxCmqQRPOHJ', // Drew
    'CYw3kZ02Hs0563khs1Fj', // Dave
    '5Q0t7uMcjvnagumLfvZi', // Paul
    'GBv7mTt0atIp3Br8iCZE', // Thomas
    'IKne3meq5aSn9XLyUdCD', // Charlie
    'D38z5RcWu1voky8WS1ja', // Fin
    'N2lVS1w4EtoT3dr4eOWO', // Callum
    'SOYHLrjzK2X1ezoPC6cr', // Harry
    '2EiwWnXFnvU5JabPnv8n', // Clyde
  ],
};

const VALID_GENDERS = new Set(['female', 'male']);

function poolForGender(gender) {
  return GENDER_VOICE_POOLS[gender] || null;
}

/** Stable starting index from NPC name, then scan pool for an unused voice. */
function pickVoiceFromPool(name, gender, usedIds) {
  const pool = poolForGender(gender);
  if (!pool?.length) return null;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const start = h % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const voiceId = pool[(start + i) % pool.length];
    if (!usedIds.has(voiceId)) {
      usedIds.add(voiceId);
      return voiceId;
    }
  }
  return pool[start];
}

/**
 * Pick a voice ID for an NPC: explicit voiceId → gender pool (stable hash) → byGender default → global default.
 * @returns {{ voiceId, modelId, gender, source }}
 */
function resolveNpcVoice(npcName, voiceMap = {}, rosterEntry = null) {
  const npcEntry = (npcName && voiceMap.npcs?.[npcName]) || {};
  const gender = rosterEntry?.gender || npcEntry.gender || null;
  const modelId = npcEntry.modelId || voiceMap.default?.modelId;

  if (npcEntry.voiceId) {
    return {
      voiceId: npcEntry.voiceId,
      modelId,
      gender,
      source: 'npc',
    };
  }

  if (gender && VALID_GENDERS.has(gender)) {
    const pool = poolForGender(gender);
    const byGender = voiceMap.byGender?.[gender];
    if (pool?.length && npcName) {
      const voiceId = pickVoiceFromPool(npcName, gender, new Set());
      return { voiceId, modelId, gender, source: 'gender-pool' };
    }
    if (byGender) {
      return { voiceId: byGender, modelId, gender, source: 'byGender' };
    }
  }

  const fallback = voiceMap.default?.voiceId;
  return { voiceId: fallback, modelId, gender, source: 'default' };
}

/**
 * Merge roster gender into voice-map and optionally assign voices from gender pools.
 * @param {object} voiceMap
 * @param {{ entries: Array<{ display: string, gender?: string }> }} roster
 * @param {{ assignMissingVoices?: boolean, reassignByGender?: boolean }} opts
 */
function applyRosterToVoiceMap(voiceMap, roster, opts = {}) {
  const map = JSON.parse(JSON.stringify(voiceMap || { default: {}, npcs: {} }));
  map.npcs = map.npcs || {};
  map.byGender = map.byGender || {
    female: GENDER_VOICE_POOLS.female[0],
    male: GENDER_VOICE_POOLS.male[0],
  };
  if (!map.default?.voiceId) {
    map.default = { ...(map.default || {}), voiceId: GENDER_VOICE_POOLS.female[0], modelId: map.default?.modelId || 'eleven_turbo_v2_5' };
  }

  const assignMissing = opts.assignMissingVoices !== false;
  const reassignAll = opts.reassignByGender === true;
  const usedByGender = { female: new Set(), male: new Set() };

  for (const entry of roster.entries || []) {
    const name = entry.display;
    if (!name) continue;
    if (!map.npcs[name]) map.npcs[name] = {};
    const npc = map.npcs[name];
    npc.gender = entry.gender || npc.gender;

    if (!VALID_GENDERS.has(npc.gender)) continue;

    const shouldAssign = reassignAll || (assignMissing && !npc.voiceId);
    if (!shouldAssign) continue;

    const used = usedByGender[npc.gender] || usedByGender.male;
    const picked = pickVoiceFromPool(name, npc.gender, used);
    if (picked) npc.voiceId = picked;
    else npc.voiceId = map.byGender[npc.gender];
  }

  return map;
}

function getGenderForNpc(npcName, roster) {
  const entry = (roster?.entries || []).find(e => e.display === npcName);
  return entry?.gender || null;
}

module.exports = {
  GENDER_VOICE_POOLS,
  VALID_GENDERS,
  resolveNpcVoice,
  applyRosterToVoiceMap,
  getGenderForNpc,
  poolForGender,
};
