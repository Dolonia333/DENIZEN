/**
 * Voice Call UI — full-screen orb overlay for immersive voice conversations.
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-voice-call-ui-style';
  let root = null;
  let orb = null;
  let label = null;
  let sub = null;
  let transcript = null;
  let userInterim = '';
  let assistantText = '';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #denizen-voice-call {
        position: fixed; inset: 0; z-index: 10050;
        display: none; flex-direction: column; align-items: center; justify-content: center;
        background: radial-gradient(circle at 50% 35%, rgba(30,58,138,0.35), rgba(2,6,23,0.96));
        backdrop-filter: blur(8px);
        padding: max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));
        font-family: system-ui, -apple-system, sans-serif;
        color: #e2e8f0;
      }
      #denizen-voice-call.open { display: flex; }
      #denizen-voice-call .vc-orb {
        width: min(220px, 42vw); height: min(220px, 42vw); border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, #60a5fa, #2563eb 45%, #1e3a8a);
        box-shadow: 0 0 60px rgba(59,130,246,0.45), inset 0 0 40px rgba(255,255,255,0.08);
        animation: denizen-vc-pulse 2.4s ease-in-out infinite;
        transition: transform 0.2s;
      }
      #denizen-voice-call.listening .vc-orb {
        animation: denizen-vc-listen 0.8s ease-in-out infinite;
        box-shadow: 0 0 80px rgba(96,165,250,0.65);
      }
      #denizen-voice-call.speaking .vc-orb {
        animation: denizen-vc-speak 0.5s ease-in-out infinite;
        background: radial-gradient(circle at 35% 30%, #86efac, #22c55e 45%, #15803d);
        box-shadow: 0 0 70px rgba(34,197,94,0.5);
      }
      @keyframes denizen-vc-pulse { 0%,100%{ transform: scale(1); } 50%{ transform: scale(1.04); } }
      @keyframes denizen-vc-listen { 0%,100%{ transform: scale(1); } 50%{ transform: scale(1.08); } }
      @keyframes denizen-vc-speak { 0%,100%{ transform: scale(1.02); } 50%{ transform: scale(1.1); } }
      #denizen-voice-call .vc-label { margin-top: 24px; font-size: 1.25rem; font-weight: 600; }
      #denizen-voice-call .vc-sub { margin-top: 8px; opacity: 0.75; font-size: 0.9rem; text-align: center; max-width: 90vw; }
      #denizen-voice-call .vc-transcript {
        margin-top: 20px; max-width: min(520px, 92vw); min-height: 3em;
        font-size: 0.95rem; line-height: 1.45; opacity: 0.9; text-align: center;
      }
      #denizen-voice-call .vc-actions { margin-top: 28px; display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
      #denizen-voice-call button {
        border: 1px solid rgba(148,163,184,0.35); background: rgba(15,23,42,0.8);
        color: #f1f5f9; border-radius: 999px; padding: 10px 18px; font-size: 0.9rem; cursor: pointer;
      }
      #denizen-voice-call button.vc-end { border-color: #ef4444; color: #fecaca; }
      #denizen-voice-call button:active { transform: scale(0.97); }
    `;
    document.head.appendChild(s);
  }

  function ensureDom() {
    if (root) return;
    ensureStyles();
    root = document.createElement('div');
    root.id = 'denizen-voice-call';
    root.innerHTML = `
      <div class="vc-orb" aria-hidden="true"></div>
      <div class="vc-label">Voice call</div>
      <div class="vc-sub">Speak naturally — pauses end your turn</div>
      <div class="vc-transcript" aria-live="polite"></div>
      <div class="vc-actions">
        <button type="button" class="vc-mute" id="denizen-vc-mute">🎤 Mute</button>
        <button type="button" class="vc-end" id="denizen-vc-end">End call</button>
      </div>
    `;
    document.body.appendChild(root);
    orb = root.querySelector('.vc-orb');
    label = root.querySelector('.vc-label');
    sub = root.querySelector('.vc-sub');
    transcript = root.querySelector('.vc-transcript');
    root.querySelector('#denizen-vc-end')?.addEventListener('click', () => {
      window.DenizenVoiceSession?.stop?.();
      hide();
    });
    root.querySelector('#denizen-vc-mute')?.addEventListener('click', () => {
      const vi = window.DenizenVoiceInput;
      if (vi?.isListening?.()) {
        vi.stop();
        sub.textContent = 'Muted — tap to speak again';
      } else {
        window.DenizenVoiceSession?.onMicStart?.();
        vi?.start?.();
        sub.textContent = 'Listening…';
      }
    });
    document.addEventListener('denizen-voice-session', (ev) => {
      if (!ev.detail?.active) hide();
    });
    document.addEventListener('denizen-voice-stream', (ev) => {
      const d = ev.detail || {};
      if (d.text) assistantText = d.text;
      if (transcript) {
        transcript.textContent = [userInterim ? `You: ${userInterim}` : '', assistantText ? `\n${assistantText}` : '']
          .filter(Boolean)
          .join('');
      }
      if (d.done) {
        sub.textContent = 'Listening…';
        setMode('listening');
      }
    });
    document.addEventListener('denizen:voice-user-speech-start', () => {
      sub.textContent = 'Listening…';
      setMode('listening');
    });
    document.addEventListener('denizen:voice-assistant-thinking', () => {
      sub.textContent = 'Thinking…';
      setMode('idle');
    });
    document.addEventListener('denizen:voice-audio-start', () => {
      sub.textContent = 'Speaking…';
      setMode('speaking');
    });
    document.addEventListener('denizen:voice-audio-end', () => {
      sub.textContent = 'Listening…';
      setMode('listening');
    });
    document.addEventListener('denizen:voice-audio-stop', () => {
      sub.textContent = 'Interrupted';
      setMode('listening');
      setTimeout(() => {
        if (root?.classList.contains('open')) sub.textContent = 'Listening…';
      }, 500);
    });
    document.addEventListener('denizen:voice-user-interim', (ev) => {
      userInterim = String(ev?.detail?.text || '').trim();
      if (transcript) {
        transcript.textContent = [userInterim ? `You: ${userInterim}` : '', assistantText ? `\n${assistantText}` : '']
          .filter(Boolean)
          .join('');
      }
    });
  }

  function setMode(mode) {
    if (!root) return;
    root.classList.remove('listening', 'speaking');
    if (mode === 'listening') root.classList.add('listening');
    if (mode === 'speaking') root.classList.add('speaking');
  }

  function show(npcName) {
    ensureDom();
    label.textContent = npcName ? `Talking with ${npcName}` : 'Voice call';
    sub.textContent = 'Listening… speak naturally';
    userInterim = '';
    assistantText = '';
    transcript.textContent = '';
    root.classList.add('open');
    setMode('listening');
    window.DenizenVoiceSession?.onMicStart?.();
    window.DenizenVoiceInput?.start?.();
  }

  function hide() {
    if (!root) return;
    root.classList.remove('open', 'listening', 'speaking');
    try { window.DenizenVoiceInput?.stop?.(); } catch (_) {}
  }

  function openCall(opts = {}) {
    const info = window.DenizenVoiceSession?.start?.(opts) || {};
    show(info.npcName || opts.npcName || 'Assistant');
    return info;
  }

  window.addEventListener('keydown', (e) => {
    if (!e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== 'c' && e.key !== 'C') return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    e.preventDefault();
    if (window.DenizenVoiceSession?.isActive?.()) {
      window.DenizenVoiceSession.stop();
      hide();
    } else {
      openCall();
    }
  });

  window.DenizenVoiceCallUi = { openCall, hide, setMode };
})();
