/**
 * SFX — ambient + event-driven sound effects, gated by presence.
 *
 * Loads `/data/sfx-map.json` (or `assets-catalog`-style remote map),
 * listens to the same /agent-ws frames the rest of the client uses,
 * and plays small audio clips on the right events.
 *
 * Design points worth knowing:
 *   - **Missing files are silent.** The map can ship before the audio
 *     assets exist. If `assets/audio/threat_high.ogg` isn't on disk,
 *     `audio.play()` rejects and we swallow it — no console spam.
 *   - **Gated on `window.DenizenPresence.zionPresent`** just like the
 *     voice gate. Same toggle (Alt+V) controls both.
 *   - **Throttled per-event** so a noisy moment (5 threats in 1s) plays
 *     the SFX once, not five times.
 *   - **Ambient bed** auto-starts on the first user gesture (browser
 *     autoplay policies require it). It's either a single looping file
 *     (`ambient.loop`) or a rotating multi-track playlist
 *     (`ambient.playlist`, with optional `shuffle`). Tracks play in
 *     sequence and repeat forever; a missing track is skipped, and if
 *     none exist the bed just stays silent. Volume + fade configurable.
 *
 * To add a new event sound:
 *   1. Drop the file into assets/audio/.
 *   2. Add an entry under `events` in `data/sfx-map.json`.
 *   3. Reload — no code changes.
 */
(function () {
  'use strict';

  const SFX_MAP_URL = '/data/sfx-map.json';
  const ASSETS_BASE = '/assets/audio/';
  const THROTTLE_MS = 350;

  let map = null;
  let ambient = null;          // current ambient <audio> (single-loop or playlist track)
  let ambientOrder = [];       // resolved playlist order (playlist mode only)
  let ambientIdx = 0;          // index into ambientOrder
  let ambientFails = 0;        // consecutive load failures — guards all-missing playlists
  let started = false;
  const lastFiredAt = new Map(); // key → ts

  function gateOpen() {
    return !!(window.DenizenPresence && window.DenizenPresence.zionPresent);
  }

  // Single-use cache so we don't re-fetch the same .ogg over and over.
  const audioCache = new Map();
  function getAudio(file, volume = 0.6) {
    const key = file + '@' + volume;
    let a = audioCache.get(key);
    if (a) {
      // Re-clone so overlapping fires don't get cut off.
      const clone = a.cloneNode();
      clone.volume = volume;
      return clone;
    }
    a = new Audio(ASSETS_BASE + file);
    a.volume = volume;
    audioCache.set(key, a);
    return a;
  }

  function play(file, volume) {
    if (!file) return;
    if (!gateOpen()) return;
    try {
      getAudio(file, volume).play().catch(() => { /* missing file or autoplay block — silent */ });
    } catch (_) { /* sealed environments */ }
  }

  function throttledPlay(eventKey, file, volume) {
    const now = Date.now();
    const last = lastFiredAt.get(eventKey) || 0;
    if (now - last < THROTTLE_MS) return;
    lastFiredAt.set(eventKey, now);
    play(file, volume);
  }

  function ambientTargetVol() {
    return typeof map?.ambient?.volume === 'number' ? map.ambient.volume : 0.18;
  }

  // Ramp a freshly-started track from 0 up to its target volume.
  function rampVolume(a, targetVol, fadeMs) {
    if (!(fadeMs > 0)) { a.volume = targetVol; return; }
    const steps = 20;
    let i = 0;
    const t = setInterval(() => {
      i++;
      a.volume = Math.min(targetVol, (i / steps) * targetVol);
      if (i >= steps || ambient !== a) clearInterval(t);
    }, fadeMs / steps);
  }

  // Shuffle a copy of the declared playlist (Fisher–Yates) when shuffle is on.
  function buildAmbientOrder() {
    const list = Array.isArray(map?.ambient?.playlist) ? map.ambient.playlist.filter(Boolean) : [];
    if (map?.ambient?.shuffle && list.length > 1) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    }
    return list;
  }

  // Play ambientOrder[ambientIdx], then chain to the next track when it ends.
  // `fadeMs` fades the first track in; between-track calls pass 0.
  function playPlaylistTrack(fadeMs) {
    if (!ambientOrder.length) return;
    // Every track failed to load in a row → none exist on disk. Go quiet
    // instead of spinning (matches the "missing files are silent" contract).
    if (ambientFails >= ambientOrder.length) { stopAmbient(); return; }

    const file = ambientOrder[ambientIdx % ambientOrder.length];
    const targetVol = ambientTargetVol();
    // A one-track playlist just loops that track gaplessly (no 'ended' gap);
    // multi-track playlists rotate on 'ended'.
    const single = ambientOrder.length === 1;
    const a = new Audio(ASSETS_BASE + file);
    a.loop = single;
    a.volume = fadeMs > 0 ? 0 : targetVol;

    let settled = false; // dedupe: 'ended', 'error' and play().catch() can race
    const advance = (failed) => {
      if (settled) return;
      settled = true;
      if (ambient !== a) return; // superseded by stopAmbient() or a restart
      ambientFails = failed ? ambientFails + 1 : 0;
      ambientIdx = (ambientIdx + 1) % ambientOrder.length;
      // Re-shuffle each time we wrap so repeats don't lock to one order.
      if (ambientIdx === 0 && map?.ambient?.shuffle) ambientOrder = buildAmbientOrder();
      playPlaylistTrack(0);
    };

    if (!single) a.addEventListener('ended', () => advance(false));
    a.addEventListener('error', () => advance(true));
    ambient = a;
    a.play().then(() => { ambientFails = 0; rampVolume(a, targetVol, fadeMs); })
            .catch((err) => {
              // Autoplay blocked ≠ bad file: reset and let the next gesture retry.
              if (err && err.name === 'NotAllowedError') { if (ambient === a) ambient = null; return; }
              advance(true);
            });
  }

  function startAmbient() {
    if (ambient || !gateOpen() || !map?.ambient) return;
    const fade = typeof map.ambient.fadeInMs === 'number' ? map.ambient.fadeInMs : 0;

    // Playlist mode wins when a non-empty `playlist` is declared; otherwise
    // fall back to the single looping `loop` file.
    const playlist = Array.isArray(map.ambient.playlist) ? map.ambient.playlist.filter(Boolean) : [];
    if (playlist.length) {
      ambientOrder = buildAmbientOrder();
      ambientIdx = 0;
      ambientFails = 0;
      playPlaylistTrack(fade);
      return;
    }

    if (!map.ambient.loop) return;
    const targetVol = ambientTargetVol();
    const a = new Audio(ASSETS_BASE + map.ambient.loop);
    a.loop = true;
    a.volume = fade > 0 ? 0 : targetVol;
    ambient = a;
    a.play().then(() => { rampVolume(a, targetVol, fade); })
            .catch(() => { if (ambient === a) ambient = null; /* autoplay blocked — retry on next gesture */ });
  }

  function stopAmbient() {
    if (ambient) { try { ambient.pause(); } catch (_) {} }
    ambient = null;
    ambientOrder = [];
    ambientIdx = 0;
    ambientFails = 0;
  }

  // ----- worldState event router -----
  function handleWorldStateChange(kind, payload) {
    if (!map?.events) return;
    const ev = map.events[kind];
    if (!ev) return;

    // Presence is a special case — value=true/false picks a sub-entry.
    if (kind === 'presence') {
      const variant = ev[String(!!payload?.zionPresent)];
      if (variant?.file) play(variant.file, variant.volume);
      // Also start/stop the ambient loop.
      if (payload?.zionPresent) startAmbient(); else stopAmbient();
      return;
    }

    // Severity-keyed events (e.g. threat).
    if (payload?.severity && ev[payload.severity]?.file) {
      throttledPlay(`${kind}:${payload.severity}`, ev[payload.severity].file, ev[payload.severity].volume);
      return;
    }

    // Plain { file, volume } entry.
    if (ev.file) throttledPlay(kind, ev.file, ev.volume);
  }

  function handleAgentBus(msg) {
    // No SFX for bus messages by default — they fire often. The voice
    // gate already covers them. Hook here if you want one.
  }

  // ----- Wire to the existing /agent-ws connection -----
  function watchWs() {
    let attached = null;
    setInterval(() => {
      const ws = window.__DenizenAgentWs;
      if (ws && ws !== attached) {
        attached = ws;
        ws.addEventListener('message', (ev) => {
          let m;
          try { m = JSON.parse(ev.data); } catch (_) { return; }
          if (m.type === 'world_state' && m.kind) {
            handleWorldStateChange(m.kind, m.payload);
          } else if (m.type === 'world_state_batch' && Array.isArray(m.changes)) {
            for (const c of m.changes) handleWorldStateChange(c.kind, c.payload);
          } else if (m.type === 'agent_bus' && m.msg) {
            handleAgentBus(m.msg);
          } else if (m.type === 'player_chat_response') {
            const ev2 = map?.events?.player_chat_response;
            if (ev2?.file) play(ev2.file, ev2.volume);
          }
        });
      }
    }, 1000);
  }

  // ----- Boot -----
  async function init() {
    try {
      const res = await fetch(SFX_MAP_URL, { cache: 'no-store' });
      if (!res.ok) return;
      map = await res.json();
    } catch (_) { return; /* SFX optional */ }

    started = true;
    watchWs();

    // Try to start ambient on the first user gesture (autoplay-safe).
    const onFirstGesture = () => {
      if (gateOpen()) startAmbient();
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
    };
    window.addEventListener('pointerdown', onFirstGesture, { once: true });
    window.addEventListener('keydown', onFirstGesture, { once: true });

    // If presence flips later, we want ambient to react in real time.
    // The world_state 'presence' event already does this, but watch for
    // the user toggling it from a console call too.
    let lastPresence = window.DenizenPresence?.zionPresent;
    setInterval(() => {
      const cur = window.DenizenPresence?.zionPresent;
      if (cur === lastPresence) return;
      lastPresence = cur;
      if (cur) startAmbient(); else stopAmbient();
    }, 500);

    console.log('[SFX] ready (events:', Object.keys(map.events || {}).join(','), ')');
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
