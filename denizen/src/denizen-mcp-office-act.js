'use strict';

/**
 * Turn an MCP tool call into a floor beat so the connected AI
 * walks and speaks in the office the human is watching.
 */

const roster = require('./npc-roster');
const engineTools = require('./denizen-mcp-engine-tools');

const THROTTLE_MS = 6000;
const _last = new Map();
let _broadcast = null;

function configure(deps = {}) {
  if (typeof deps.broadcast === 'function') _broadcast = deps.broadcast;
}

function resetForTests() {
  _last.clear();
  _broadcast = null;
}

function placeForTool(toolName) {
  const t = String(toolName || '').toLowerCase().replace(/-/g, '_');
  if (!t || t === 'announce_in_office' || t === 'announce') return null;
  // These tools move the office themselves. A guessed room would fight the verb.
  if (engineTools.isEngineTool(t)) return null;
  if (t.includes('browser')) return { room: 'desk', line: 'Looking at the screen.' };
  if (t.includes('business_studio')) return { room: 'manager_office', line: 'In the studio.' };
  if (t.includes('studio_board')) return { room: 'conference', line: 'On the board.' };
  if (t.includes('crm') || t.includes('pipeline') || t.includes('deal')) {
    return { room: 'reception', line: 'Checking the pipeline.' };
  }
  if (t.includes('agency')) return { room: 'open_office', line: 'Linking the deal.' };
  if (t.includes('run_skill') || t.includes('runnpcskill')) return { room: 'desk', line: 'On it.' };
  return { room: 'open_office', line: 'Working.' };
}

function actorForScope(scope = {}) {
  const key = roster.canonicalizeNpcKey(scope.npc_key);
  const hint = `${scope.client_type || ''} ${scope.label || ''} ${scope.metadata?.client_type || ''}`.toLowerCase();
  if (key && key !== '_team' && roster.isKnownNpcFolder(key)) {
    const hit = roster.entries.find((e) => e.folder === key);
    return {
      guest: false,
      npcKey: hit?.textureKey || `xp_${key}`,
      displayName: hit?.display || key,
      donorTexture: null,
    };
  }
  if (hint.includes('cursor')) {
    return {
      guest: true,
      npcKey: 'xp_plugin_cursor',
      displayName: 'Cursor',
      donorTexture: 'xp_claude',
    };
  }
  if (hint.includes('claude')) {
    return {
      guest: false,
      npcKey: 'xp_claude',
      displayName: 'Claude',
      donorTexture: null,
    };
  }
  return {
    guest: true,
    npcKey: 'xp_plugin_chatgpt',
    displayName: 'ChatGPT',
    donorTexture: 'xp_josh',
  };
}

function buildBeat(scope, toolName) {
  const place = placeForTool(toolName);
  if (!place) return null;
  const actor = actorForScope(scope);
  return {
    type: 'mcp_office_act',
    npcKey: actor.npcKey,
    displayName: actor.displayName,
    guest: actor.guest,
    donorTexture: actor.donorTexture,
    room: place.room,
    line: place.line,
    tool: String(toolName || ''),
  };
}

function noteToolCall(scope, toolName, now = Date.now()) {
  const beat = buildBeat(scope, toolName);
  if (!beat) return null;
  const prev = _last.get(beat.npcKey);
  if (prev && (now - prev.at) < THROTTLE_MS && prev.room === beat.room) return null;
  _last.set(beat.npcKey, { at: now, room: beat.room });
  beat.ts = now;
  if (typeof _broadcast === 'function') {
    try { _broadcast(beat); } catch (_) { /* office bus is best-effort */ }
  }
  return beat;
}

module.exports = {
  configure,
  resetForTests,
  placeForTool,
  actorForScope,
  buildBeat,
  noteToolCall,
  THROTTLE_MS,
};
