/**
 * Voice-first walk-up — talk to your claimed assistant without opening chat UI.
 * Hold V near your assistant NPC; uses DenizenVoiceInput + player chat WS.
 */
(function () {
  'use strict';

  const HOLD_KEY = 'v';
  const PROXIMITY = 96;
  let holding = false;
  let bound = false;

  function isCeo() {
    return globalThis.__DenizenCeoMode === true;
  }

  function sessionId() {
    return globalThis.DenizenVisitorSession?.getSessionId?.() || null;
  }

  function claimedNpcKey() {
    return globalThis.DenizenVisitorSession?.getAssistant?.()?.npc_key || null;
  }

  function getScene() {
    return globalThis.DenizenGame?.scene?.scenes?.[0] || null;
  }

  function findClaimedNpcNearby() {
    const scene = getScene();
    const key = claimedNpcKey();
    if (!scene?.player || !key || !Array.isArray(scene.npcs)) return null;

    const player = scene.player;
    let best = null;
    let bestDist = PROXIMITY;

    scene.npcs.forEach((npc) => {
      const npcKey = npc.folder || npc.npcKey || npc.key;
      if (npcKey !== key) return;
      const dist = Math.hypot(npc.x - player.x, npc.y - player.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = npc;
      }
    });
    return best;
  }

  function sendWalkupMessage(text) {
    const npcKey = claimedNpcKey();
    const sid = sessionId();
    if (!npcKey || !text || !sid) return;

    const chat = globalThis.DenizenPlayerChat;
    if (chat?.sendToNpc) {
      chat.sendToNpc(npcKey, text, { walk: true });
      return;
    }

    const ws = globalThis.DenizenCofounderWS || globalThis.__denizenWs;
    if (ws?.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'player_chat',
        npcName: npcKey,
        text,
        session_id: sid,
      }));
    }
  }

  function onVoiceResult(text) {
    if (!holding) return;
    holding = false;
    const trimmed = String(text || '').trim();
    if (trimmed) sendWalkupMessage(trimmed);
  }

  function startHold() {
    if (holding || isCeo() || !claimedNpcKey()) return;
    if (!findClaimedNpcNearby()) return;
    holding = true;
    const vi = globalThis.DenizenVoiceInput;
    if (vi?.start) {
      vi.start({ onResult: onVoiceResult });
    } else if (vi?.toggle) {
      vi.toggle();
    }
  }

  function stopHold() {
    holding = false;
    const vi = globalThis.DenizenVoiceInput;
    if (vi?.stop) vi.stop();
  }

  function bindKeys() {
    if (bound) return;
    bound = true;
    window.addEventListener('keydown', (ev) => {
      if (ev.repeat) return;
      if (ev.key.toLowerCase() !== HOLD_KEY) return;
      if (ev.target?.matches('input, textarea, [contenteditable]')) return;
      startHold();
    });
    window.addEventListener('keyup', (ev) => {
      if (ev.key.toLowerCase() !== HOLD_KEY) return;
      stopHold();
    });
  }

  function init() {
    if (isCeo()) return;
    bindKeys();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  globalThis.DenizenVisitorVoiceWalkup = { startHold, stopHold, findClaimedNpcNearby };
})();
