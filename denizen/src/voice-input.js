/**
 * Voice Input — push-to-talk speech recognition for the player.
 *
 * Closes the "voice loop" — combined with the existing voice gate this
 * means: hold a key → talk → NPC hears you (transcript routed through
 * player-chat → NPC brain or OpenClaw dispatch) → NPC speaks back.
 *
 * Uses the browser's built-in `SpeechRecognition` (webkit prefix on
 * Chrome). No server, no API key, no privacy footprint beyond what
 * Chrome already does. Falls back gracefully on browsers without it
 * (Firefox, Safari pre-15) — the mic button just doesn't appear.
 *
 * Bindings:
 *   - Hold `\` (backslash) to talk         — primary push-to-talk
 *   - Or click the floating mic button     — accessible alternative
 *   - Release / click again to stop
 *
 * Tunable via the script tag's data-* attrs or via globals:
 *   window.DenizenVoiceInput.setHotkey('\\')          — change the hotkey
 *   window.DenizenVoiceInput.setLang('en-US')         — change recognizer locale
 *   window.DenizenVoiceInput.setAutosubmit(true)      — auto-send when you stop (default)
 *   window.DenizenVoiceInput.setProvider(fn)          — swap the STT engine
 *
 * Continuous mode: while the mic is open, short pauses do NOT end the
 * session — keep talking, click 🎤 again (or release \) when you're done.
 *
 * NOTE on the hotkey choice: Space is the natural push-to-talk button
 * but the office scene uses Space for Phaser interact. Backslash is
 * unbound and right next to Enter on QWERTY.
 */
(function () {
  'use strict';

  const HOTKEY_DEFAULT = '\\';
  const LANG_DEFAULT = 'en-US';

  let hotkey = HOTKEY_DEFAULT;
  let lang = LANG_DEFAULT;
  let autosubmit = true;
  let recognition = null;
  let listening = false;
  /** True from start() until explicit stop() — pauses won't end the session. */
  let sessionActive = false;
  /** Accumulated finals across Chrome's continuous recognition chunks. */
  let sessionTranscript = '';
  let restartTimer = null;
  let micButton = null;
  let speakFab = null;
  let statusBadge = null;
  const SPEAK_FAB_STYLE_ID = 'denizen-speak-fab-style';
  let providerOverride = null;
  let pttDown = false;
  let handsFree = false;
  let silenceTimer = null;
  let silenceMs = 650;
  let speechStartedInSession = false;

  // ---- Detect support ----
  const SR = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;
  const supportsSpeechRecognition = !!SR;

  function createServerSttProvider() {
    if (!navigator?.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return null;
    }

    let recorder = null;
    let stream = null;
    let chunks = [];
    let active = false;
    let health = null;

    const stopTracks = () => {
      try { stream?.getTracks?.().forEach(t => t.stop()); } catch (_) {}
      stream = null;
    };

    async function ensureHealth() {
      if (health) return health;
      try {
        const res = await fetch('/api/stt/health', { cache: 'no-store' });
        health = res.ok ? await res.json() : { configured: false };
      } catch (_) {
        health = { configured: false };
      }
      return health;
    }

    async function blobToBase64(blob) {
      return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => {
          const out = String(fr.result || '');
          const comma = out.indexOf(',');
          resolve(comma >= 0 ? out.slice(comma + 1) : out);
        };
        fr.onerror = () => reject(fr.error || new Error('failed to read blob'));
        fr.readAsDataURL(blob);
      });
    }

    return {
      async start(deliver, setStatus) {
        if (active) return;
        const h = await ensureHealth();
        if (!h?.configured) {
          setStatus(
            'error',
            '<b>🎤 server STT not configured</b><br><span style="opacity:0.85">Set OPENAI_WHISPER_API_KEY (or OPENAI_API_KEY) for /api/stt.</span>',
            { sticky: true },
          );
          throw new Error('server stt not configured');
        }

        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4');

        recorder = new MediaRecorder(stream, { mimeType });
        recorder.ondataavailable = (ev) => {
          if (ev?.data?.size > 0) chunks.push(ev.data);
        };
        recorder.onerror = (ev) => {
          setStatus('error', `<b>🎤 recorder error</b><br><span style="opacity:0.85">${ev?.error?.message || 'unknown'}</span>`, { sticky: true });
          active = false;
          stopTracks();
        };
        recorder.onstop = async () => {
          active = false;
          const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
          chunks = [];
          stopTracks();

          if (!blob.size) {
            setStatus('error', '<b>🔇 no speech</b><br><span style="opacity:0.85">No audio was captured.</span>');
            return;
          }

          try {
            setStatus('busy', 'transcribing (server STT)…');
            const audioBase64 = await blobToBase64(blob);
            const res = await fetch('/api/stt', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(globalThis.DenizenVisitorSession?.authHeaders?.() || {}),
              },
              body: JSON.stringify({
                audioBase64,
                mimeType: blob.type || recorder?.mimeType || 'audio/webm',
                lang,
              }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
              throw new Error(json?.error || `HTTP ${res.status}`);
            }
            const text = String(json?.text || '').trim();
            if (!text) {
              setStatus('error', '<b>🔇 no speech</b><br><span style="opacity:0.85">No transcript returned.</span>');
              return;
            }
            setStatus('busy', `→ ${text}`);
            deliver(text);
          } catch (err) {
            setStatus('error', `<b>🌐 STT failed</b><br><span style="opacity:0.85">${err?.message || String(err)}</span>`, { sticky: true });
          }
        };

        recorder.start(250);
        active = true;
        setStatus('listening', 'recording… pauses are OK — click Stop or 🎤 again when done');
      },

      stop() {
        if (!active) return;
        try {
          recorder?.stop();
        } catch (_) {
          active = false;
          stopTracks();
        }
      },
    };
  }

  // Brave detection — Brave ships `webkitSpeechRecognition` but the
  // underlying Google STT call is blocked (privacy), so the native path
  // always errors with `network`. Pre-emptively use the server provider
  // so the first mic press actually transcribes instead of erroring.
  // navigator.brave.isBrave() returns a promise; resolve sync if possible.
  let _braveDetected = false;
  try {
    if (typeof navigator !== 'undefined' && navigator.brave && typeof navigator.brave.isBrave === 'function') {
      // Fire-and-forget — if we get true back, install the provider for
      // subsequent presses. The first attempt may still hit native and
      // auto-swap via the error path below.
      navigator.brave.isBrave().then((isBrave) => {
        if (isBrave && !providerOverride) {
          const p = createServerSttProvider();
          if (p) {
            providerOverride = p;
            _braveDetected = true;
            console.log('[VoiceInput] Brave detected — using server STT provider (Whisper via /api/stt)');
          }
        }
      }).catch(() => { /* not brave, or detection failed; native path stays */ });
    }
  } catch (_) { /* best-effort */ }

  if (!supportsSpeechRecognition) {
    console.log('[VoiceInput] SpeechRecognition not available — trying server STT fallback');
    providerOverride = createServerSttProvider();
    if (!providerOverride) {
      const explainUnsupported = () => {
        const bits = [];
        if (!window.isSecureContext) {
          bits.push('This page is not a secure context. Use http://localhost:8080 or https.');
        }
        bits.push('SpeechRecognition unavailable and MediaRecorder fallback is not supported in this browser.');
        return bits.join(' ');
      };
      const renderUnsupportedBadge = () => {
        const badge = document.createElement('div');
        badge.id = 'denizen-mic-status';
        Object.assign(badge.style, {
          position: 'fixed', bottom: '14px', right: '14px', zIndex: 9998,
          background: 'rgba(0,0,0,0.92)', color: '#fdba74',
          font: '11px monospace', padding: '8px 10px', border: '1px solid #7c2d12',
          borderRadius: '6px', maxWidth: '360px', lineHeight: '1.4',
        });
        badge.textContent = `🎤 unavailable: ${explainUnsupported()}`;
        document.body.appendChild(badge);
      };
      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', renderUnsupportedBadge);
      } else {
        renderUnsupportedBadge();
      }
    }
  }

  // Translate cryptic SpeechRecognition error codes into something a user
  // can actually act on. Returns { short, hint } — short is the badge
  // label, hint is the longer explanation shown below it.
  function explainError(code) {
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        return {
          short: '🚫 mic blocked',
          hint: 'Click the 🔒 icon in the address bar → Site settings → set Microphone to Allow → reload.',
        };
      case 'audio-capture':
        return {
          short: '🎙 no mic',
          hint: 'No microphone detected. Check OS sound settings → input devices.',
        };
      case 'network':
        return {
          short: '🌐 network',
          hint: 'Chrome\'s SpeechRecognition uses Google\'s cloud STT and needs internet.',
        };
      case 'no-speech':
        return {
          short: '🔇 no speech',
          hint: 'I didn\'t hear anything. Click to talk and speak right away.',
        };
      case 'aborted':
        return { short: 'cancelled', hint: null };
      case 'language-not-supported':
        return {
          short: 'lang unsupported',
          hint: `Locale "${lang}" not supported. Try window.DenizenVoiceInput.setLang("en-US").`,
        };
      case 'bad-grammar':
        return { short: 'bad grammar', hint: null };
      default:
        return {
          short: `error: ${code || 'unknown'}`,
          hint: 'Open the browser console (F12) for the full stack.',
        };
    }
  }

  function isTouchUi() {
    return !!window.__DenizenIsTouch
      || document.documentElement.classList.contains('denizen-touch');
  }

  function isSupported() {
    return supportsSpeechRecognition || !!providerOverride;
  }

  function onMicPress(e) {
    if (e?.preventDefault) e.preventDefault();
    if (typeof window.DenizenSetPresence === 'function' && !window.DenizenPresence?.zionPresent) {
      try { window.DenizenSetPresence(true); } catch (_) {}
    }
    if (!isSupported()) {
      setMicState(
        'error',
        '<b>🎤 voice not available</b><br><span style="opacity:0.85">Use Chrome on desktop, or set OPENAI_API_KEY on the server for mobile Whisper STT.</span>',
        { sticky: true },
      );
      return;
    }
    if (listening || sessionActive) stop();
    else start();
  }

  function refreshPresenceChip() {
    const presenceChip = document.getElementById('denizen-presence-chip');
    if (!presenceChip) return;
    const on = !!window.DenizenPresence?.zionPresent;
    const touch = isTouchUi();
    const title = on
      ? 'Voice ON — tap to mute NPC speech'
      : 'Voice OFF — tap to hear NPCs';
    globalThis.DenizenBottomDock?.renderChip?.('denizen-presence-chip', touch ? '' : (on ? 'voice ON' : 'voice OFF'), { iconOnly: touch, title });
    if (!globalThis.DenizenBottomDock?.renderChip) {
      presenceChip.textContent = touch ? '👤' : (on ? '👤 voice ON' : '👤 voice OFF');
    }
    presenceChip.title = title;
    presenceChip.style.background = on ? '#064e3b' : '#0f172a';
    presenceChip.style.borderColor = on ? '#34d399' : '#355';
    presenceChip.style.display = 'block';
  }

  function onPresencePress() {
    window.DenizenHaptics?.tap?.();
    if (typeof window.DenizenTogglePresence === 'function') {
      window.DenizenTogglePresence();
    }
  }

  function wirePress(el, handler) {
    if (!el || el.dataset.denizenTouchWired === '1') return;
    el.dataset.denizenTouchWired = '1';
    const bind = window.DenizenTouchBind?.bindPress;
    if (bind) bind(el, handler);
    else el.addEventListener('click', handler);
  }

  function rewireTouch() {
    wirePress(document.getElementById('denizen-mic-button'), onMicPress);
    wirePress(speakFab, onMicPress);
    wirePress(document.getElementById('denizen-presence-chip'), onPresencePress);
  }

  function injectSpeakFabStyles() {
    if (document.getElementById(SPEAK_FAB_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = SPEAK_FAB_STYLE_ID;
    s.textContent = `
      #denizen-speak-fab {
        position: fixed;
        z-index: 2147483495;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        border: 2px solid #3b82f6;
        background: linear-gradient(145deg, #1e3a8a, #0f172a);
        color: #dbeafe;
        font: 700 13px/1 system-ui, sans-serif;
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        display: none;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: 1px;
        padding: 0;
      }
      #denizen-speak-fab .dzs-label {
        font-size: 9px;
        letter-spacing: 0.02em;
        font-weight: 700;
      }
      #denizen-speak-fab.listening {
        background: linear-gradient(145deg, #7f1d1d, #450a0a);
        border-color: #fca5a5;
        color: #fecaca;
      }
      html.denizen-touch #denizen-speak-fab,
      html.denizen-phone-mode #denizen-speak-fab {
        display: flex;
        bottom: max(14px, env(safe-area-inset-bottom, 0px));
        left: max(14px, env(safe-area-inset-left, 0px));
        right: auto;
      }
      html.denizen-touch:not(.denizen-phone-mode) #denizen-speak-fab {
        bottom: calc(var(--denizen-dock-height, 52px) + 14px + env(safe-area-inset-bottom, 0px));
      }
      /* Chat has its own speak control — don't stack a second mic over the input row */
      html.denizen-chat-open #denizen-speak-fab,
      html.denizen-phone-open #denizen-speak-fab {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(s);
  }

  function speakFabMarkup(on) {
    const T = globalThis.DenizenTablerIcons;
    if (T?.speakGlyph) {
      T.ensureStyles?.();
      const glyph = T.speakGlyph(on, { size: 20, className: 'dzs-ti' });
      return `${glyph}<span class="dzs-label">${on ? 'Stop' : 'Speak'}</span>`;
    }
    return `${on ? '⏹' : '🎤'}<span class="dzs-label">${on ? 'Stop' : 'Speak'}</span>`;
  }

  function refreshMicIcon() {
    if (!micButton) return;
    const on = sessionActive || listening;
    const compact = document.documentElement.classList.contains('denizen-touch')
      && micButton.closest('#denizen-bottom-dock');
    const T = globalThis.DenizenTablerIcons;
    if (T?.paintChip) {
      T.paintChip(micButton, on ? 'player-stop' : 'microphone', on ? 'Stop' : 'Speak', {
        iconOnly: compact,
        title: on ? 'Stop speaking' : 'Speak to NPCs',
      });
    } else if (!globalThis.DenizenBottomDock?.renderChip) {
      micButton.textContent = on ? '⏹' : '🎤';
    }
  }

  function refreshSpeakFab() {
    if (!speakFab) return;
    const chatOpen = document.documentElement.classList.contains('denizen-chat-open')
      || document.documentElement.classList.contains('denizen-phone-open');
    const on = sessionActive || listening;
    const supported = isSupported();
    speakFab.classList.toggle('listening', on);
    speakFab.innerHTML = speakFabMarkup(on);
    speakFab.setAttribute('aria-label', on ? 'Stop speaking' : 'Speak to NPCs');
    speakFab.disabled = !supported;
    if (chatOpen) {
      speakFab.style.display = 'none';
      speakFab.style.removeProperty('opacity');
    } else {
      speakFab.style.display = '';
      // Do not set inline opacity — corner-hud-autohide owns visibility on desktop.
      speakFab.style.removeProperty('opacity');
      if (!supported) speakFab.style.opacity = '0.55';
    }
    speakFab.title = supported
      ? 'Tap to speak — tap again when done'
      : 'Voice needs Chrome desktop or OPENAI_API_KEY on server';
  }

  // ---- Build the floating UI ----
  function buildUI() {
    if (micButton) {
      rewireTouch();
      return;
    }

    micButton = document.createElement('button');
    micButton.id = 'denizen-mic-button';
    micButton.type = 'button';
    micButton.title = `Tap to speak — tap again when done. Or hold ${hotkey} on desktop.`;
    globalThis.DenizenBottomDock?.renderChip?.('denizen-mic-button', 'Speak');
    refreshMicIcon();
    if (!micButton.innerHTML && !globalThis.DenizenBottomDock?.renderChip) micButton.textContent = '🎤';
    Object.assign(micButton.style, {
      position: 'fixed', bottom: '14px', right: '14px', zIndex: 100002,
      width: '52px', height: '52px', borderRadius: '50%',
      background: '#0f172a', color: '#cfe7ff', border: '2px solid #355',
      cursor: 'pointer', font: '22px monospace', boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
      transition: 'background 120ms, border-color 120ms, transform 80ms',
      touchAction: 'manipulation',
    });
    wirePress(micButton, onMicPress);
    document.body.appendChild(micButton);

    injectSpeakFabStyles();
    speakFab = document.createElement('button');
    speakFab.id = 'denizen-speak-fab';
    speakFab.type = 'button';
    speakFab.innerHTML = speakFabMarkup(false);
    wirePress(speakFab, onMicPress);
    document.body.appendChild(speakFab);
    refreshSpeakFab();
    setInterval(refreshSpeakFab, 400);

    const presenceChip = document.createElement('button');
    presenceChip.id = 'denizen-presence-chip';
    presenceChip.type = 'button';
    Object.assign(presenceChip.style, {
      position: 'fixed', bottom: '76px', right: '74px', zIndex: 100002,
      background: '#0f172a', color: '#cfe7ff', border: '1px solid #355',
      borderRadius: '14px', padding: '3px 9px', font: '11px monospace',
      cursor: 'pointer', display: 'none', touchAction: 'manipulation',
    });
    presenceChip.title = 'NPC voice output on/off';
    wirePress(presenceChip, onPresencePress);
    document.body.appendChild(presenceChip);

    window.addEventListener('denizen:presence', refreshPresenceChip);
    setInterval(refreshPresenceChip, 2000);
    refreshPresenceChip();

    statusBadge = document.createElement('div');
    statusBadge.id = 'denizen-mic-status';
    Object.assign(statusBadge.style, {
      position: 'fixed', bottom: '76px', right: '14px', zIndex: 100200,
      background: 'rgba(0,0,0,0.92)', color: '#cfe7ff',
      font: '11px monospace', padding: '6px 10px', border: '1px solid #355',
      borderRadius: '6px', display: 'none', maxWidth: '340px',
      textAlign: 'left', lineHeight: '1.4', whiteSpace: 'normal',
    });
    document.body.appendChild(statusBadge);
  }

  // Tracks the current "error sticky" state so onend doesn't immediately
  // wipe a useful error message a quarter-second later.
  let _errorSticky = false;
  let _starting = false;

  async function ensureMicPermission() {
    if (!navigator?.mediaDevices?.getUserMedia) return true;
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return true;
    } catch (err) {
      const name = err?.name || '';
      const blocked = name === 'NotAllowedError' || name === 'PermissionDeniedError';
      const noMic = name === 'NotFoundError' || name === 'DevicesNotFoundError';
      if (blocked) {
        const { short, hint } = explainError('not-allowed');
        setMicState('error', `<b>${short}</b><br><span style="opacity:0.85">${hint}</span>`, { sticky: true });
      } else if (noMic) {
        const { short, hint } = explainError('audio-capture');
        setMicState('error', `<b>${short}</b><br><span style="opacity:0.85">${hint}</span>`, { sticky: true });
      } else {
        setMicState('error', `<b>🎤 mic preflight failed</b><br><span style="opacity:0.85">${err?.message || String(err)}</span>`, { sticky: true });
      }
      throw err;
    } finally {
      try { stream?.getTracks?.().forEach(t => t.stop()); } catch (_) {}
    }
  }

  function setMicState(state, text, opts = {}) {
    if (micButton) {
      if (state === 'listening') {
        micButton.style.background = '#7f1d1d';
        micButton.style.borderColor = '#fca5a5';
      } else if (state === 'busy') {
        micButton.style.background = '#1e3a8a';
        micButton.style.borderColor = '#93c5fd';
      } else if (state === 'error') {
        micButton.style.background = '#7c2d12';
        micButton.style.borderColor = '#fdba74';
      } else {
        micButton.style.background = '#0f172a';
        micButton.style.borderColor = '#355';
      }
    }
    refreshMicIcon();
    refreshSpeakFab();
    _errorSticky = (state === 'error') && opts.sticky;
    if (statusBadge) {
      if (text) {
        statusBadge.innerHTML = text; // allow simple formatting from explainError
        statusBadge.style.display = 'block';
      } else if (!_errorSticky) {
        statusBadge.style.display = 'none';
      }
    }
  }

  function displayTranscript(interim) {
    const base = sessionTranscript.trim();
    const tail = String(interim || '').trim();
    if (base && tail) return `… ${base} ${tail}`;
    if (base) return `… ${base}`;
    if (tail) return `… ${tail}`;
    return 'listening… pauses are OK — click 🎤 again when done';
  }

  function appendFinalChunk(chunk) {
    const part = String(chunk || '').trim();
    if (!part) return;
    sessionTranscript = sessionTranscript
      ? `${sessionTranscript} ${part}`
      : part;
  }

  function scheduleRecognitionRestart() {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!sessionActive || !recognition) return;
      try {
        recognition.start();
      } catch (err) {
        if (/InvalidStateError|already started/i.test(err?.message || '')) return;
        scheduleRecognitionRestart();
      }
    }, 180);
  }

  function finishSession() {
    sessionActive = false;
    listening = false;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    const toSend = sessionTranscript.trim();
    sessionTranscript = '';
    speechStartedInSession = false;
    if (toSend && autosubmit) {
      setMicState('busy', `→ ${toSend}`);
      deliver(toSend);
    } else if (!toSend) {
      setMicState('error', '<b>🔇 no speech</b><br><span style="opacity:0.85">I didn\'t catch anything — click 🎤 and try again.</span>');
      setTimeout(() => { if (!_errorSticky) setMicState('idle', ''); }, 3500);
    }
    setTimeout(() => { if (!_errorSticky) setMicState('idle', ''); }, 1500);
  }

  function resetSilenceTimer() {
    if (!handsFree || !sessionActive) return;
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (sessionActive) stop();
    }, silenceMs);
  }

  function clearSilenceTimer() {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  function setHandsFree(next) {
    handsFree = !!next;
    if (!handsFree) clearSilenceTimer();
  }

  function ensureRecognition() {
    if (!supportsSpeechRecognition) return null;
    if (recognition) return recognition;
    recognition = new SR();
    recognition.continuous = true;        // keep session open across natural pauses
    recognition.interimResults = true;    // get partial transcripts as you talk
    recognition.lang = lang;

    recognition.onresult = (ev) => {
      let interim = '';
      let final = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (final) appendFinalChunk(final);
      const hasSpeech = Boolean(String(interim || '').trim() || String(final || '').trim());
      if (sessionActive && hasSpeech && !speechStartedInSession) {
        speechStartedInSession = true;
        try {
          window.DenizenVoiceSession?.onUserSpeechStart?.();
        } catch (_) {}
        try {
          document.dispatchEvent(new CustomEvent('denizen:voice-user-speech-start', {
            detail: { source: 'stt_onresult' },
          }));
        } catch (_) {}
      }
      if (sessionActive) {
        const rendered = displayTranscript(interim);
        mirrorTranscriptToChatInput(rendered);
        setMicState('listening', rendered);
        try {
          document.dispatchEvent(new CustomEvent('denizen:voice-user-interim', {
            detail: { text: String(interim || '').trim() },
          }));
        } catch (_) {}
        resetSilenceTimer();
        try { window.DenizenVoiceCallUi?.setMode?.('listening'); } catch (_) {}
      }
    };

    recognition.onerror = (ev) => {
      const code = ev?.error || 'unknown';
      console.warn('[VoiceInput] recognition error:', code);

      // Mid-session silence/aborts are normal in continuous mode — keep listening.
      if (sessionActive && (code === 'no-speech' || code === 'aborted')) {
        scheduleRecognitionRestart();
        return;
      }

      // Auto-fallback: `network` (Brave blocks Google STT) and
      // `service-not-allowed` (some Chromium forks / locked-down enterprise
      // policy) both mean "native SR is structurally broken in this
      // browser". Try to swap in the server provider transparently so the
      // user's next mic press uses Whisper instead of erroring again.
      const isNativeBroken = (code === 'network' || code === 'service-not-allowed');
      if (isNativeBroken && !providerOverride) {
        const p = createServerSttProvider();
        if (p) {
          providerOverride = p;
          console.log('[VoiceInput] native SR error "' + code + '" — switching to server STT (Whisper via /api/stt)');
          setMicState(
            'idle',
            '<b>🔄 switched to server STT</b><br><span style="opacity:0.85">Browser native voice failed (' + code + '). Hold ' + hotkey + ' again to try Whisper.</span>',
            { sticky: false },
          );
          setTimeout(() => { if (!_errorSticky) setMicState('idle', ''); }, 6000);
          sessionActive = false;
          listening = false;
          return;
        }
      }

      const { short, hint } = explainError(code);
      const msg = hint
        ? `<b>${short}</b><br><span style="opacity:0.85">${hint}</span>`
        : `<b>${short}</b>`;
      // Sticky for blocking errors so the user has time to read; transient
      // for 'no-speech' / 'aborted' which are just "try again".
      const sticky = code === 'not-allowed' || code === 'service-not-allowed'
        || code === 'audio-capture' || code === 'network'
        || code === 'language-not-supported';
      setMicState('error', msg, { sticky });
      if (!sticky) {
        setTimeout(() => { if (!_errorSticky) setMicState('idle', ''); }, 3500);
      }
      sessionActive = false;
      listening = false;
    };

    recognition.onend = () => {
      // Chrome often ends the recognizer after a silence chunk even in
      // continuous mode — restart until the user explicitly stops.
      if (sessionActive) {
        setMicState('listening', displayTranscript());
        scheduleRecognitionRestart();
        return;
      }
      // finishSession() already delivered; onend is just cleanup here.
      listening = false;
    };

    return recognition;
  }

  async function start() {
    if (sessionActive || _starting) return;
    _starting = true;
    try { window.DenizenVoiceSession?.onMicStart?.(); } catch (_) {}
    sessionTranscript = '';
    speechStartedInSession = false;
    sessionActive = true;
    if (providerOverride) {
      // External provider takes over (e.g. Whisper-via-server).
      try { await providerOverride.start(deliver, setMicState); listening = true; }
      catch (err) {
        sessionActive = false;
        console.warn('[VoiceInput] provider.start failed:', err?.message || err);
      }
      _starting = false;
      return;
    }
    try {
      await ensureMicPermission();
      const r = ensureRecognition();
      if (!r) {
        throw new Error('SpeechRecognition unavailable in this browser');
      }
      r.start();
      listening = true;
      setMicState('listening', handsFree
        ? 'listening… pause to send'
        : 'listening… pauses are OK — click 🎤 again when done');
      if (handsFree) resetSilenceTimer();
    } catch (err) {
      sessionActive = false;
      // Most common: InvalidStateError when the previous session hasn't
      // fully ended yet (rapid click). Just swallow it — the next click
      // will work fine.
      console.warn('[VoiceInput] start failed:', err?.message || err);
      if (/InvalidStateError|already started/i.test(err?.message || '')) {
        setMicState('busy', 'cleaning up previous session… click again in a moment');
        setTimeout(() => { if (!_errorSticky) setMicState('idle', ''); }, 1500);
      } else {
        const msg = `<b>start failed</b><br><span style="opacity:0.85">${err?.message || 'unknown'}</span>`;
        setMicState('error', msg, { sticky: true });
      }
    } finally {
      _starting = false;
    }
  }

  function stop() {
    if (!sessionActive && !listening) return;
    clearSilenceTimer();
    const wasActive = sessionActive;
    sessionActive = false;
    speechStartedInSession = false;
    if (providerOverride && typeof providerOverride.stop === 'function') {
      try { providerOverride.stop(); } catch (_) {}
      listening = false;
      return;
    }
    if (recognition) {
      try { recognition.stop(); } catch (_) {}
    }
    if (wasActive) {
      setMicState('busy', 'finishing…');
      finishSession();
    } else {
      listening = false;
    }
  }

  function mirrorTranscriptToChatInput(text) {
    const raw = String(text || '').replace(/^…\s*/, '').trim();
    if (!raw || raw === 'listening… pauses are OK — click 🎤 again when done') return;
    const input = document.getElementById('player-chat-input');
    if (!input) return;
    const panel = document.getElementById('player-chat-panel');
    if (!panel || panel.style.display === 'none') return;
    input.value = raw;
    try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    const pc = window.__DenizenPlayerChat;
    if (pc?._showDomPlayerBubble && (window.__DenizenIsTouch || document.documentElement.classList.contains('denizen-touch'))) {
      try { pc._showDomPlayerBubble(raw); } catch (_) {}
    }
  }

  // ---- Deliver transcript ----
  // Path 1: route through player-chat if the chat panel is open / available.
  // Path 2: fall back to dispatching directly via the OpenClaw dispatcher
  //         if it's loaded (so voice still works when the chat UI isn't open).
  function deliver(transcript) {
    if (!transcript || !transcript.trim()) return;
    const text = window.DenizenOpenClawDispatch?.fixVoiceMishearings?.(transcript.trim())
      || transcript.trim();

    if (window.DenizenVoiceSession?.isActive?.()) {
      try {
        window.DenizenVoiceSession.sendUtterance(text);
        return;
      } catch (err) {
        console.warn('[VoiceInput] voice session deliver failed:', err?.message || err);
      }
    }

    // PlayerChat exposes itself to globals once instantiated. Auto-open
    // the panel so the user can SEE "[NPC] is coming over…" /
    // "(no response)" / "No NPC found to talk to." system messages —
    // otherwise the only feedback is the speech bubble above an NPC
    // that might be off-screen, which the user reasonably interprets
    // as "nothing happened."
    if (window.__DenizenPlayerChat && typeof window.__DenizenPlayerChat.sendMessage === 'function') {
      try {
        const pc = window.__DenizenPlayerChat;
        const phoneChat = document.documentElement.classList.contains('denizen-phone-open')
          && document.documentElement.getAttribute('data-denizen-phone-app') === 'chat';
        if (!pc._visible && typeof pc.open === 'function') {
          try { pc.open(); } catch (_) {}
        }
        if (phoneChat && !pc.getActiveThreadId?.() && typeof globalThis.DenizenPhoneUi?.openApp === 'function') {
          try { globalThis.DenizenPhoneUi.openApp('chat'); } catch (_) {}
        }
        const input = document.getElementById('player-chat-input');
        if (input) {
          input.value = '';
          try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
        }
        pc.sendMessage(text);
      } catch (err) {
        console.warn('[VoiceInput] sendMessage failed:', err?.message || err);
      }
      return;
    }

    // Fallback: dispatcher direct.
    if (window.DenizenOpenClawDispatch && typeof window.DenizenOpenClawDispatch.dispatch === 'function') {
      window.DenizenOpenClawDispatch.dispatch(text);
      return;
    }

    console.warn('[VoiceInput] no destination — neither PlayerChat nor OpenClawDispatch available');
  }

  // ---- Hotkey ----
  window.addEventListener('keydown', (e) => {
    // Don't grab the hotkey while the user is typing in an input.
    const activeIsTextInput = (() => {
      const el = document.activeElement;
      if (!el) return false;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
      if (el.isContentEditable) return true;
      return false;
    })();
    if (activeIsTextInput) return;
    if (e.key !== hotkey || e.repeat) return;
    pttDown = true;
    e.preventDefault();
    start();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key !== hotkey) return;
    if (!pttDown) return;
    pttDown = false;
    e.preventDefault();
    stop();
  });

  async function probeServerStt() {
    if (!providerOverride) return;
    try {
      const res = await fetch('/api/stt/health', { cache: 'no-store' });
      const h = res.ok ? await res.json() : {};
      if (!h?.configured && micButton) {
        micButton.title = 'Server STT not configured — set OPENAI_API_KEY on the Denizen PC';
        console.warn('[VoiceInput] /api/stt/health: not configured (OPENAI_API_KEY missing)');
      } else if (h?.configured) {
        console.log('[VoiceInput] server Whisper STT ready for mobile');
      }
    } catch (_) {}
  }

  // ---- Boot ----
  async function init() {
    buildUI();
    rewireTouch();
    if (isTouchUi() && !supportsSpeechRecognition && !providerOverride) {
      const p = createServerSttProvider();
      if (p) {
        try {
          const res = await fetch('/api/stt/health', { cache: 'no-store' });
          const h = res.ok ? await res.json() : {};
          if (h?.configured) providerOverride = p;
        } catch (_) {}
      }
    }
    refreshSpeakFab();
    await probeServerStt();
    const mode = providerOverride ? 'server STT' : (supportsSpeechRecognition ? 'browser SR' : 'unsupported');
    console.log(`[VoiceInput] ready (${mode}) — tap 🎤 or hold ${hotkey}`);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ---- Public API ----
  window.DenizenVoiceInput = {
    get supported() { return isSupported(); },
    isSupported,
    isListening: () => sessionActive || listening,
    start, stop,
    toggle: onMicPress,
    rewireTouch,
    refreshSpeakFab,
    setHotkey(k) { if (typeof k === 'string' && k.length === 1) hotkey = k; },
    setLang(l) { lang = l; if (recognition) recognition.lang = l; },
    setAutosubmit(b) { autosubmit = !!b; },
    setHandsFree,
    setHandsFreeSilenceMs(ms) {
      const n = Number(ms);
      if (Number.isFinite(n) && n >= 300 && n <= 3000) silenceMs = Math.round(n);
    },
    setProvider(provider) {
      // provider: { start(deliver, setStatus), stop?() }
      providerOverride = provider || null;
    },
    _deliver: deliver, // exposed for tests / external triggers
  };
})();
