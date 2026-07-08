/**
 * Proximity Audio — distance + facing + active-conversation volume gate.
 *
 * Why this exists: the office has up to 16 NPCs talking on autonomous
 * 30-45s think cycles. With every TTS call at full volume the audio
 * stack sounds like a crowd standing on top of you. This module
 * scales each utterance's volume by:
 *
 *   1. **Distance** from the player. Close → full; far → whisper.
 *   2. **Facing**.   Player looking at the NPC → full multiplier;
 *                    looking away → halved.
 *   3. **Active conversation mute**. If the player is mid-chat with
 *      NPC X (player-chat tags it via setActiveConvoNpc), every other
 *      NPC is hard-muted for the duration of that chat. The convo tag
 *      decays ~30s after the last player message.
 *
 * Exposed surface (window.DenizenProximityAudio):
 *
 *   computeVolumeForNpc(npcName) -> { volume: 0..1, muted: bool, reason }
 *     Called by elevenlabs-provider.js right before audio.play(), and
 *     by voice-gate.js for the speechSynthesis fallback.
 *
 *   setActiveConvoNpc(npcName, ttlMs=30000)
 *     Called by player-chat.js whenever the player sends a message.
 *     Mutes every other NPC for the TTL. Pass null to clear early.
 *
 *   getActiveConvoNpc() -> name | null
 *
 * Configuration via window.DenizenProximityConfig (all optional):
 *   { fullVolumeRadius, whisperRadius, minVolume, facingDotCutoff,
 *     facingPenalty, convoTtlMs }
 *
 * Reads the scene + npc state from window.__DenizenScene (set by
 * office-scene.js) and window.DenizenWorldState (set by the new
 * world_state_batch handler in agent-office-manager.js).
 */
(function () {
  'use strict';

  // --- tunable defaults ----------------------------------------------------
  const DEFAULTS = {
    // Pixel distances. Below `fullVolumeRadius` → 1.0 (subject to facing).
    fullVolumeRadius: 90,
    // Above `whisperRadius` → minVolume.
    whisperRadius: 320,
    minVolume: 0.12,
    // Facing cone: dot product of player-facing vs. (npc - player) > this
    // → "looking at." Otherwise the facing penalty multiplies the volume.
    facingDotCutoff: 0.25,
    facingPenalty: 0.5,
    // After this long without a player chat, the active-convo lock clears
    // and other NPCs are audible again.
    convoTtlMs: 30000,
  };

  function cfg() {
    return Object.assign({}, DEFAULTS, (typeof window !== 'undefined' ? window.DenizenProximityConfig : null) || {});
  }

  // --- active conversation state ------------------------------------------
  let _activeConvoNpc = null;     // display name like "Lucy"
  let _activeConvoUntil = 0;

  function setActiveConvoNpc(npcName, ttlMs) {
    const c = cfg();
    _activeConvoNpc = (typeof npcName === 'string' && npcName) ? npcName : null;
    _activeConvoUntil = _activeConvoNpc ? (Date.now() + (ttlMs || c.convoTtlMs)) : 0;
  }

  function getActiveConvoNpc() {
    if (_activeConvoNpc && Date.now() < _activeConvoUntil) return _activeConvoNpc;
    return null;
  }

  // --- audio mode (ambient / focus / mute-all) ----------------------------
  // 'ambient'   — current "listen-in" behavior: distance falloff + whisper
  //               floor + active-convo override.
  // 'focus'     — only the conversation partner is audible. If no partner,
  //               only the SINGLE closest NPC within fullVolumeRadius plays.
  //               Everything else hard-muted. The cocktail-party noise gone.
  // 'mute-all'  — every NPC line silenced. Bubbles still render.
  const MODES = ['ambient', 'focus', 'mute-all'];
  const STORAGE_KEY = 'denizenAudioMode';
  let _audioMode = 'ambient';
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && MODES.indexOf(saved) !== -1) _audioMode = saved;
    }
  } catch (_) { /* SSR / disabled storage — keep default */ }

  function getAudioMode() { return _audioMode; }
  function setAudioMode(mode) {
    if (MODES.indexOf(mode) === -1) return _audioMode;
    _audioMode = mode;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, mode);
      }
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('denizen:audiomode', { detail: { mode } }));
      }
    } catch (_) { /* best-effort */ }
    return _audioMode;
  }
  function cycleAudioMode() {
    const i = MODES.indexOf(_audioMode);
    return setAudioMode(MODES[(i + 1) % MODES.length]);
  }

  /** Return the display name of the NPC closest to the player, OR null
   *  if no NPC is within fullVolumeRadius. Used by focus mode to pick
   *  the implicit "the person addressing me" when no explicit chat
   *  partner is set. */
  function _closestNpcToPlayer() {
    const scene = (typeof window !== 'undefined' && window.__DenizenScene) || null;
    const player = scene?.player;
    if (!scene || !player || !Array.isArray(scene.npcs)) return null;
    const c = cfg();
    const roster = window.DenizenNpcRoster?.keyToDisplay || {};
    let best = null;
    let bestD2 = c.fullVolumeRadius * c.fullVolumeRadius;
    for (const n of scene.npcs) {
      if (!n?.texture?.key) continue;
      const dx = n.x - player.x;
      const dy = n.y - player.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = roster[n.texture.key] || n.texture.key;
      }
    }
    return best;
  }

  // --- single-speaker slot ------------------------------------------------
  // Real-world fix for "I hear two voices at once." Only one NPC can have
  // audio playing at any moment. New speakers during an active slot are
  // dropped silently — their bubble still renders (visual stays). We
  // estimate slot duration from text length (~75 ms/char + 600 ms tail)
  // so a stuck Audio.play() doesn't permanently silence the office.
  // Conversation lock-holder gets right-of-way: when the player is in
  // an active chat with X, X never gets dropped even if another NPC
  // arrived first.
  let _slotHolder = null;        // display name currently speaking
  let _slotUntil = 0;            // ms epoch — auto-expire deadline

  function _estimateSpeakDurationMs(text) {
    const len = String(text || '').length;
    // 75 ms/char ≈ 800 chars/min, matches typical TTS pacing for
    // English; clamp so even one-word lines hold the slot at least
    // 800 ms (otherwise rapid-fire decisions still overlap).
    return Math.max(800, Math.min(20000, len * 75 + 600));
  }

  /**
   * Try to claim the audio channel for `npcName` to speak `text`.
   * Returns true if the slot is free (or if this NPC is the active
   * convo partner, who gets priority). Returns false to mean "stay
   * silent for this line — someone else is talking."
   */
  function acquireSpeakerSlot(npcName, text) {
    const now = Date.now();
    if (_slotHolder && now < _slotUntil) {
      // Convo partner priority — if the player is mid-chat with this
      // NPC, kick whoever's holding the slot. That makes player chats
      // feel responsive even if Lucy started a line right before
      // Edward (the partner) replies.
      const convo = getActiveConvoNpc();
      if (convo && convo === npcName && _slotHolder !== convo) {
        _slotHolder = npcName;
        _slotUntil = now + _estimateSpeakDurationMs(text);
        return true;
      }
      return false;
    }
    _slotHolder = npcName;
    _slotUntil = now + _estimateSpeakDurationMs(text);
    return true;
  }

  function releaseSpeakerSlot(npcName) {
    // Only release if we still own it — late `ended` events from a
    // previous Audio object shouldn't free a newer speaker's slot.
    if (!npcName || _slotHolder === npcName) {
      _slotHolder = null;
      _slotUntil = 0;
    }
  }

  function getSlotHolder() {
    if (_slotHolder && Date.now() < _slotUntil) return _slotHolder;
    return null;
  }

  // --- npc-name → sprite resolution ---------------------------------------
  // The roster ships under window.DenizenNpcRoster.keyToDisplay
  // (npcKey -> displayName). We need the inverse for resolving by name.
  function _nameToKey(npcName) {
    const roster = (typeof window !== 'undefined' && window.DenizenNpcRoster) || null;
    if (!roster) return null;
    const map = roster.keyToDisplay || {};
    const want = String(npcName || '').toLowerCase();
    for (const k of Object.keys(map)) {
      if (String(map[k]).toLowerCase() === want) return k;
    }
    return null;
  }

  function _findNpcSprite(npcName) {
    const scene = (typeof window !== 'undefined' && window.__DenizenScene) || null;
    if (!scene || !Array.isArray(scene.npcs)) return null;
    const key = _nameToKey(npcName) || `xp_${String(npcName).toLowerCase()}`;
    return scene.npcs.find(n => n?.texture?.key === key) || null;
  }

  // --- player facing -------------------------------------------------------
  // Track the most recent non-zero velocity direction so we still have a
  // facing vector while the player is standing still. Updated lazily on
  // every computeVolumeForNpc call — no need for a separate animation
  // frame hook.
  let _facingX = 0;
  let _facingY = 1;   // default: facing down (matches initial sprite frame)

  function _updateFacingFromPlayer(player) {
    const v = player?.body?.velocity;
    if (!v) return;
    const mag = Math.hypot(v.x || 0, v.y || 0);
    if (mag > 8) {
      _facingX = v.x / mag;
      _facingY = v.y / mag;
    }
  }

  // --- core ---------------------------------------------------------------
  /**
   * @param {string} npcName  — display name (e.g. "Lucy")
   * @returns {{volume:number, muted:boolean, reason:string}}
   */
  function computeVolumeForNpc(npcName) {
    if (!npcName) return { volume: 0, muted: true, reason: 'no-name' };

    // 0. Mode gate — hard-mute and focus modes short-circuit everything.
    const mode = _audioMode;
    if (mode === 'mute-all') {
      return { volume: 0, muted: true, reason: 'mode=mute-all' };
    }
    if (mode === 'focus') {
      // In focus mode, only ONE NPC is audible at a time:
      // 1. the explicit conversation partner (set by player-chat), OR
      // 2. when no partner exists, the closest NPC within fullVolumeRadius
      //    (so walking up to someone naturally tunes them in).
      const partner = getActiveConvoNpc();
      const allowed = partner || _closestNpcToPlayer();
      if (!allowed || allowed !== npcName) {
        return { volume: 0, muted: true, reason: `focus mode (allowed: ${allowed || 'none'})` };
      }
      return { volume: 1, muted: false, reason: `focus on ${allowed}` };
    }

    // 1. Active-convo gate (ambient mode)
    const active = getActiveConvoNpc();
    if (active && active !== npcName) {
      return { volume: 0, muted: true, reason: `mid-chat with ${active}` };
    }

    const scene = (typeof window !== 'undefined' && window.__DenizenScene) || null;
    const player = scene?.player;
    if (!scene || !player) {
      // Scene not booted yet (early autonomous lines). Default to full
      // volume so we don't accidentally silence the first speech.
      return { volume: 1, muted: false, reason: 'no-scene' };
    }
    const npcSprite = _findNpcSprite(npcName);
    if (!npcSprite) {
      // Unknown NPC (could be a robber, the CTO, or an off-screen
      // visitor). Give it a medium volume so the player still hears it
      // but it's not dominating.
      return { volume: 0.5, muted: false, reason: 'no-sprite' };
    }

    _updateFacingFromPlayer(player);

    const c = cfg();
    const dx = npcSprite.x - player.x;
    const dy = npcSprite.y - player.y;
    const dist = Math.hypot(dx, dy);

    // 2. Distance falloff
    let volume;
    if (dist <= c.fullVolumeRadius) {
      volume = 1;
    } else if (dist >= c.whisperRadius) {
      volume = c.minVolume;
    } else {
      const t = (dist - c.fullVolumeRadius) / (c.whisperRadius - c.fullVolumeRadius);
      volume = 1 - t * (1 - c.minVolume);
    }

    // 3. Facing penalty — only matters once you're past the "right next
    // to them" radius. If the player is on top of an NPC we don't care
    // which way they're looking.
    if (dist > c.fullVolumeRadius) {
      const nx = dx / (dist || 1);
      const ny = dy / (dist || 1);
      const facingDot = _facingX * nx + _facingY * ny;
      if (facingDot < c.facingDotCutoff) {
        volume *= c.facingPenalty;
      }
    }

    return { volume: Math.max(0, Math.min(1, volume)), muted: false, reason: `dist=${Math.round(dist)}` };
  }

  // --- UI chip + keyboard shortcut ---------------------------------------
  // A tiny corner chip showing the current audio mode. Click to cycle.
  // Alt+L is the keyboard shortcut. Persisted in localStorage via the
  // set/get functions above.
  function onAudioModePress() {
    window.DenizenHaptics?.tap?.();
    const mode = cycleAudioMode();
    // Listen-in / Focus need voice output on — presence defaults off on load.
    if (mode !== 'mute-all' && typeof window.DenizenSetPresence === 'function'
        && !window.DenizenPresence?.zionPresent) {
      try { window.DenizenSetPresence(true); } catch (_) {}
    }
    _paintChip();
  }

  function wireAudioChip(el) {
    if (!el || el.dataset.denizenTouchWired === '1') return;
    el.dataset.denizenTouchWired = '1';
    el.style.touchAction = 'manipulation';
    const bind = window.DenizenTouchBind?.bindPress;
    if (bind) bind(el, onAudioModePress);
    else el.addEventListener('click', onAudioModePress);
  }

  function _renderChip() {
    if (typeof document === 'undefined') return;
    const id = 'denizen-audio-mode-chip';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('button');
      el.id = id;
      el.type = 'button';
      el.title = 'Audio mode (Alt+L to cycle)';
      Object.assign(el.style, {
        position: 'fixed', bottom: '14px', left: '14px', zIndex: 9999,
        background: 'rgba(17,24,39,0.92)', color: '#fde68a',
        border: '1px solid #3f3f46', borderRadius: '999px',
        padding: '6px 12px', font: '12px/1.2 monospace',
        cursor: 'pointer', userSelect: 'none',
        minWidth: '44px', minHeight: '44px',
      });
      window.addEventListener('denizen:audiomode', _paintChip);
      window.addEventListener('denizen:presence', _paintChip);
      document.body.appendChild(el);
    }
    wireAudioChip(el);
    _paintChip();
  }
  function _paintChip() {
    const el = document.getElementById('denizen-audio-mode-chip');
    if (!el) return;
    const touch = !!window.__DenizenIsTouch
      || document.documentElement.classList.contains('denizen-touch');
    const voiceOn = !!window.DenizenPresence?.zionPresent;
    const label = _audioMode === 'focus'    ? (touch ? '🎯' : '🎯 Focus')
                : _audioMode === 'mute-all' ? (touch ? '🔕' : '🔕 NPC mute')
                :                             (touch ? '🔊' : '🔊 Listen-in');
    el.textContent = label;
    const voiceNote = voiceOn ? '' : ' — voice is OFF (tap 👤 chip)';
    el.title = _audioMode === 'focus'
      ? `Focus: only your conversation partner (or nearest NPC) speaks${voiceNote}. Tap to cycle.`
      : _audioMode === 'mute-all'
        ? `NPC audio muted (bubbles still show). Tap to cycle.`
        : `Listen-in: distance + facing volume${voiceNote}. Tap to cycle.`;
    el.dataset.mode = _audioMode;
    el.style.opacity = (_audioMode === 'mute-all' || !voiceOn) ? '0.82' : '1';
  }

  function rewireTouch() {
    wireAudioChip(document.getElementById('denizen-audio-mode-chip'));
    _paintChip();
  }

  function _bindHotkey() {
    if (typeof document === 'undefined') return;
    document.addEventListener('keydown', (e) => {
      // Skip when typing in inputs.
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        cycleAudioMode();
      }
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', () => { _renderChip(); _bindHotkey(); });
    } else {
      _renderChip();
      _bindHotkey();
    }
  }

  // --- export -------------------------------------------------------------
  const surface = {
    computeVolumeForNpc,
    setActiveConvoNpc,
    getActiveConvoNpc,
    acquireSpeakerSlot,
    releaseSpeakerSlot,
    getSlotHolder,
    getAudioMode,
    setAudioMode,
    cycleAudioMode,
    MODES,
  };
  if (typeof window !== 'undefined') {
    window.DenizenProximityAudio = { ...surface, rewireTouch };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = surface;
  }
})();
