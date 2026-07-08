/**
 * Denizen Voice Playback — sentence TTS queue, streaming fetch, barge-in.
 *
 * Exposes window.DenizenVoicePlayback for voice-session and player-chat.
 */
(function () {
  'use strict';

  const TTS_URL = '/api/tts';
  let queue = [];
  let playing = false;
  let currentAudio = null;
  let generation = 0;
  let voiceCallActive = false;
  let currentFetchController = null;
  let activeTurnId = null;

  function dispatchPlaybackEvent(type, detail = {}) {
    try {
      document.dispatchEvent(new CustomEvent(type, { detail }));
    } catch (_) {}
  }

  function setActiveTurn(turnId) {
    activeTurnId = turnId || null;
  }

  function getActiveTurn() {
    return activeTurnId;
  }

  function stopAll() {
    generation += 1;
    queue = [];
    playing = false;
    if (currentFetchController) {
      try { currentFetchController.abort(); } catch (_) {}
      currentFetchController = null;
    }
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.src = '';
      } catch (_) {}
      currentAudio = null;
    }
    try { window.speechSynthesis?.cancel?.(); } catch (_) {}
    dispatchPlaybackEvent('denizen:voice-audio-stop', { reason: 'interrupt' });
  }

  function isPlaying() {
    return playing || queue.length > 0;
  }

  function setVoiceCallActive(active) {
    voiceCallActive = !!active;
    if (voiceCallActive) {
      try { window.DenizenProximityAudio?.setAudioMode?.('focus'); } catch (_) {}
      try { window.DenizenSetPresence?.(true); } catch (_) {}
    }
  }

  function isVoiceCallActive() {
    return voiceCallActive;
  }

  async function fetchTtsBlob(npcName, text, signal) {
    const t0 = performance.now?.() || Date.now();
    const res = await fetch(TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ npcName, text: String(text).slice(0, 4000) }),
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`TTS ${res.status}: ${detail.slice(0, 120)}`);
    }
    const t1 = performance.now?.() || Date.now();
    dispatchPlaybackEvent('denizen:voice-latency', {
      metric: 'tts_roundtrip_ms',
      value: Math.max(0, Math.round(t1 - t0)),
    });
    return res.blob();
  }

  function speechFallback(npcName, text, gen) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window) || gen !== generation) {
        resolve();
        return;
      }
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.05;
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
      currentAudio = null;
    });
  }

  async function playBlob(blob, gen, item) {
    if (gen !== generation) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    audio.preload = 'auto';
    const prox = window.DenizenProximityAudio?.computeVolumeForNpc;
    if (prox) {
      const npc = queue[0]?.npcName || 'NPC';
      try {
        const p = prox(npc);
        if (p.muted) {
          URL.revokeObjectURL(url);
          return;
        }
        audio.volume = p.volume ?? 1;
      } catch (_) {}
    }
    await new Promise((resolve) => {
      const done = () => {
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
        dispatchPlaybackEvent('denizen:voice-audio-end', {
          npcName: item?.npcName || 'NPC',
          turnId: item?.turnId || null,
        });
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      dispatchPlaybackEvent('denizen:voice-audio-start', {
        npcName: item?.npcName || 'NPC',
        turnId: item?.turnId || null,
      });
      audio.play().catch(done);
    });
  }

  async function drainQueue() {
    if (playing) return;
    playing = true;
    const gen = generation;
    while (queue.length && gen === generation) {
      const item = queue.shift();
      if (!item?.text) continue;
      if (item.turnId && activeTurnId && item.turnId !== activeTurnId) continue;
      try {
        if (window.DenizenVoiceProvider && item.useProvider) {
          await Promise.resolve(window.DenizenVoiceProvider(item.npcName, item.text));
        } else {
          currentFetchController = new AbortController();
          const blob = await fetchTtsBlob(item.npcName, item.text, currentFetchController.signal);
          currentFetchController = null;
          await playBlob(blob, gen, item);
        }
      } catch (err) {
        currentFetchController = null;
        if (err?.name === 'AbortError') continue;
        console.warn('[VoicePlayback]', err?.message || err);
        await speechFallback(item.npcName, item.text, gen);
      }
    }
    playing = false;
    dispatchPlaybackEvent('denizen:voice-audio-empty', { turnId: activeTurnId || null });
  }

  /**
   * Queue a sentence for TTS. Starts playback immediately if idle.
   */
  function enqueue(npcName, text, opts = {}) {
    const t = String(text || '').trim();
    if (!t) return;
    if (!window.DenizenPresence?.zionPresent && !voiceCallActive) {
      try { window.DenizenSetPresence?.(true); } catch (_) {}
    }
    queue.push({
      npcName: npcName || 'NPC',
      text: t,
      useProvider: !!opts.useProvider,
      turnId: opts.turnId || null,
    });
    void drainQueue();
  }

  function enqueueFiller(npcName, text) {
    enqueue(npcName, text, { useProvider: false });
  }

  window.DenizenVoicePlayback = {
    enqueue,
    enqueueFiller,
    stopAll,
    isPlaying,
    setVoiceCallActive,
    isVoiceCallActive,
    setActiveTurn,
    getActiveTurn,
  };
})();
