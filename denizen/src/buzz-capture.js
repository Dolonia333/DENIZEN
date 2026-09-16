/**
 * Buzz capture ring — Stapler-style click → ring → note card → Abby.
 * Short-click is owned by denizen-phone-ui (toggleRing). Long-click still
 * opens Denizen OS. This module draws the ring + note card and posts
 * /api/context-drop.
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-buzz-capture-style';
  const RING_ID = 'denizen-buzz-ring';
  const NOTE_ID = 'denizen-buzz-note';
  const CROP_ID = 'denizen-buzz-crop';
  const LONG_RECORD_MS = 120000;
  const MEETING_CHUNK_MS = 10 * 60 * 1000;

  let ringEl = null;
  let noteEl = null;
  let state = {
    kind: 'note',
    note: '',
    transcript: '',
    imageDataUrl: null,
    imageName: 'buzz-screenshot.jpg',
    target: 'Abby',
    recording: false,
    recorder: null,
    chunks: [],
    recTimer: null,
    meetingTracks: [],
    speechRec: null,
    cropOrigin: null,
  };

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${RING_ID} {
        position: fixed;
        width: 320px;
        height: 320px;
        z-index: 2147483600;
        pointer-events: none;
      }
      #${RING_ID}.open { pointer-events: auto; }
      #${RING_ID}.open .bz-act { pointer-events: auto; }
      html.denizen-buzz-ring-open #denizen-phone-fab {
        width: 72px !important;
        height: 96px !important;
        z-index: 2147483601 !important;
      }
      html.denizen-buzz-ring-open:not(.denizen-phone) #denizen-phone-fab {
        right: 168px !important;
        bottom: 152px !important;
        transform: none !important;
      }
      html.denizen-phone.denizen-buzz-ring-open #denizen-phone-fab {
        right: 50% !important;
        bottom: 38% !important;
        transform: translateX(50%) !important;
      }
      html.denizen-buzz-ring-open #denizen-phone-fab .dzp-fab-buzz-bubble {
        display: none !important;
      }
      #${RING_ID} .bz-orbit {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        opacity: 0;
        transform: scale(0.82);
        transition: opacity 0.2s ease, transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
      }
      #${RING_ID}.open .bz-orbit { opacity: 0.85; transform: scale(1); }
      #${RING_ID} .bz-act {
        position: absolute;
        width: 48px;
        height: 48px;
        margin: -24px 0 0 -24px;
        border: 0;
        border-radius: 50%;
        background: #f8f4ec;
        color: #1a1520;
        font-family: "IBM Plex Sans", system-ui, sans-serif;
        font-size: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 8px 20px rgba(0,0,0,0.32);
        transform: scale(0.4);
        opacity: 0;
        transition: transform 0.28s cubic-bezier(0.22,1,0.36,1), opacity 0.18s ease, box-shadow 0.15s ease;
      }
      #${RING_ID} .bz-act svg {
        width: 20px;
        height: 20px;
        display: block;
        flex-shrink: 0;
        stroke: currentColor;
      }
      #${RING_ID} .bz-act i { display: none; }
      #${RING_ID}.open .bz-act { transform: scale(1); opacity: 1; }
      #${RING_ID} .bz-act:nth-child(2) { transition-delay: 0.02s; }
      #${RING_ID} .bz-act:nth-child(3) { transition-delay: 0.05s; }
      #${RING_ID} .bz-act:nth-child(4) { transition-delay: 0.08s; }
      #${RING_ID} .bz-act:nth-child(5) { transition-delay: 0.11s; }
      #${RING_ID} .bz-act:nth-child(6) { transition-delay: 0.14s; }
      #${RING_ID} .bz-act:nth-child(7) { transition-delay: 0.17s; }
      #${RING_ID} .bz-act[data-act="hide"] { background: #2a2f3a; color: #f4efe4; }
      #${RING_ID} .bz-act[disabled] { opacity: 0.4; cursor: not-allowed; filter: grayscale(0.6); }
      #${RING_ID} .bz-act:hover:not([disabled]) {
        box-shadow: 0 10px 24px rgba(0,0,0,0.38), 0 0 0 3px rgba(163,230,53,0.45);
      }
      html.denizen-phone #${RING_ID} { width: 240px; height: 240px; }
      html.denizen-phone #${RING_ID} .bz-act { width: 44px; height: 44px; margin: -22px 0 0 -22px; }
      html.denizen-phone #${RING_ID} .bz-act svg { width: 18px; height: 18px; }

      #${NOTE_ID} {
        display: none;
        position: fixed;
        right: max(16px, env(safe-area-inset-right));
        bottom: calc(96px + env(safe-area-inset-bottom, 0px));
        width: min(360px, calc(100vw - 24px));
        z-index: 2147483201;
        background: linear-gradient(180deg, rgba(15,23,42,0.96), rgba(2,6,23,0.96));
        border: 1px solid rgba(250, 204, 21, 0.35);
        border-radius: 16px;
        box-shadow: 0 18px 50px rgba(0,0,0,0.5);
        color: #e2e8f0;
        font-family: "IBM Plex Sans", system-ui, sans-serif;
        overflow: hidden;
      }
      #${NOTE_ID}.open { display: flex; flex-direction: column; }
      #${NOTE_ID} header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px 8px; border-bottom: 1px solid rgba(148,163,184,0.18);
      }
      #${NOTE_ID} header strong { font-size: 13px; color: #fde68a; }
      #${NOTE_ID} header span { font-size: 11px; color: #94a3b8; }
      #${NOTE_ID} .bz-preview {
        display: none; max-height: 140px; object-fit: contain; width: 100%;
        background: #020617; border-bottom: 1px solid rgba(148,163,184,0.12);
      }
      #${NOTE_ID} .bz-preview.show { display: block; }
      #${NOTE_ID} textarea {
        width: 100%; min-height: 72px; resize: vertical; border: 0;
        background: transparent; color: #f1f5f9; padding: 10px 12px;
        font: 14px/1.45 "IBM Plex Sans", system-ui, sans-serif; outline: none;
      }
      #${NOTE_ID} .bz-meta {
        padding: 0 12px 8px; font-size: 11px; color: #94a3b8;
      }
      #${NOTE_ID} footer {
        display: flex; gap: 8px; padding: 8px 12px 12px; justify-content: flex-end;
      }
      #${NOTE_ID} footer button {
        border-radius: 999px; border: 1px solid #334155; background: transparent;
        color: #cbd5e1; padding: 6px 12px; font-size: 12px; cursor: pointer;
      }
      #${NOTE_ID} footer button.primary {
        background: #a3e635; color: #052e16; border-color: #a3e635; font-weight: 700;
      }
      #${NOTE_ID} footer button:disabled { opacity: 0.5; cursor: wait; }
      #${NOTE_ID} select {
        background: #0f172a; color: #e2e8f0; border: 1px solid #334155;
        border-radius: 8px; font-size: 11px; padding: 2px 6px;
      }
      #${NOTE_ID} [data-note="stop"] { display: none; }
      #${NOTE_ID}.recording [data-note="stop"] { display: inline-flex; }
      #${NOTE_ID}.recording [data-note="send"] { display: none; }
      #${CROP_ID} {
        display: none; position: fixed; inset: 0; z-index: 2147483602;
        background: rgba(2,6,23,0.72); cursor: crosshair;
      }
      #${CROP_ID}.open { display: block; }
      #${CROP_ID} img { position: absolute; inset: 0; margin: auto; max-width: 92vw; max-height: 88vh; }
      #${CROP_ID} .bz-crop-box {
        position: absolute; border: 2px solid #a3e635; background: rgba(163,230,53,0.12);
        pointer-events: none;
      }
      #${CROP_ID} p {
        position: absolute; left: 0; right: 0; bottom: 16px; margin: 0; text-align: center;
        color: #e2e8f0; font: 13px/1.4 "IBM Plex Sans", system-ui, sans-serif;
      }
    `;
    document.head.appendChild(s);
  }

  let leaveTimer = null;
  let openedAt = 0;
  const RING_SIZE = 320;
  const OPEN_GUARD_MS = 500;
  const ICO = {
    screenshot: '<svg class="bz-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M4 16v2a2 2 0 0 0 2 2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M16 20h2a2 2 0 0 0 2-2v-2"/></svg>',
    record: '<svg class="bz-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M8 21h8"/></svg>',
    dictate: '<svg class="bz-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4V6z"/></svg>',
    meeting: '<svg class="bz-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 10l5-2v8l-5-2z"/></svg>',
    hide: '<svg class="bz-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    phone: '<svg class="bz-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>',
    desktop: '<svg class="bz-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/></svg>',
    invisible: '<svg class="bz-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.1A9 9 0 0 1 12 5c5 0 9 4.5 9 7-0.3.8-1.2 2.2-2.8 3.4"/><path d="M6.1 6.1C4.2 7.5 3 9.2 3 12c0 2.5 4 7 9 7 1.4 0 2.7-.3 3.9-.9"/></svg>',
  };

  function actions() {
    const desktop = !!window.DenizenDesktop?.buzzOverlayToggle;
    const extra = desktop
      ? { id: 'invisible', label: 'Ghost', ico: 'ti-eye-off', svg: ICO.invisible, title: 'Leave invisible — stay out of screen share' }
      : { id: 'desktop', label: 'Desktop', ico: 'ti-device-desktop', svg: ICO.desktop, title: 'Always-on-top Buzz overlay' };
    return [
      { id: 'screenshot', label: 'Screenshot', ico: 'ti-screenshot', svg: ICO.screenshot },
      { id: 'meeting', label: 'Meet', ico: 'ti-video', svg: ICO.meeting, title: 'Record meeting — transcribed as it lands' },
      { id: 'dictate', label: 'Say', ico: 'ti-message', svg: ICO.dictate },
      { id: 'phone', label: 'Apps', ico: 'ti-device-mobile', svg: ICO.phone, title: 'Open the phone — chat, CRM, and the rest of the apps' },
      extra,
      { id: 'record', label: 'Record', ico: 'ti-microphone', svg: ICO.record },
    ];
  }

  function ringRadius() {
    return document.documentElement.classList.contains('denizen-phone') ? 88 : 118;
  }

  function ringSize() {
    return document.documentElement.classList.contains('denizen-phone') ? 240 : RING_SIZE;
  }

  function phoneAnchor() {
    return document.querySelector('#denizen-phone-fab .dzp-fab-buzz')
      || document.getElementById('denizen-phone-fab');
  }

  function railLeft() {
    const rail = document.getElementById('denizen-work-rail');
    if (!rail || !document.documentElement.classList.contains('denizen-work-rail-open')) {
      return window.innerWidth;
    }
    const r = rail.getBoundingClientRect();
    return r.width > 40 ? r.left : window.innerWidth;
  }

  function layoutRing() {
    if (!ringEl) return;
    const phone = phoneAnchor();
    const size = ringSize();
    const radius = ringRadius();
    const list = [...ringEl.querySelectorAll('.bz-act')];
    let cx;
    let cy;
    if (phone) {
      const rect = phone.getBoundingClientRect();
      if (rect.width > 8 && rect.height > 8) {
        cx = rect.left + rect.width / 2;
        cy = rect.top + rect.height / 2;
      }
    }
    if (cx == null || cy == null) {
      cx = Math.min(window.innerWidth, railLeft()) - 204;
      cy = window.innerHeight - 200;
    }
    ringEl.style.width = `${size}px`;
    ringEl.style.height = `${size}px`;
    ringEl.style.left = `${Math.round(cx - size / 2)}px`;
    ringEl.style.top = `${Math.round(cy - size / 2)}px`;
    ringEl.style.right = 'auto';
    ringEl.style.bottom = 'auto';
    const n = list.length || 1;
    list.forEach((btn, i) => {
      const deg = -90 + (360 * i) / n;
      const rad = (deg * Math.PI) / 180;
      btn.style.left = `${size / 2 + Math.cos(rad) * radius}px`;
      btn.style.top = `${size / 2 + Math.sin(rad) * radius}px`;
    });
  }

  function insideBuzz(node) {
    if (!node || node === document || node === window) return false;
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !!(el && el.closest?.(`#${RING_ID}, #${NOTE_ID}, #${CROP_ID}, #denizen-phone-fab, #denizen-corner-hit-phone`));
  }

  function cancelHide() {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  }

  function recentlyOpened() {
    return openedAt > 0 && (Date.now() - openedAt) < OPEN_GUARD_MS;
  }

  function scheduleHide() {
    cancelHide();
    if (recentlyOpened()) return;
    if (noteEl?.classList.contains('open')) return;
    if (document.getElementById(CROP_ID)?.classList.contains('open')) return;
    leaveTimer = setTimeout(() => {
      leaveTimer = null;
      if (recentlyOpened()) return;
      closeRing();
    }, 420);
  }

  function buildRing() {
    if (ringEl) return;
    ringEl = document.createElement('div');
    ringEl.id = RING_ID;
    ringEl.setAttribute('role', 'menu');
    ringEl.setAttribute('aria-label', 'Buzz capture');
    ringEl.innerHTML = `<svg class="bz-orbit" viewBox="0 0 320 320" aria-hidden="true"><circle cx="160" cy="160" r="118" fill="none" stroke="rgba(163,230,53,0.35)" stroke-width="1.5" stroke-dasharray="3 7"/></svg>`
      + actions().map((a) => {
        const title = a.title ? ` title="${esc(a.title)}"` : '';
        return `<button type="button" class="bz-act" data-act="${a.id}" aria-label="${esc(a.label)}"${title} role="menuitem">${a.svg}<i class="ti ${a.ico}" aria-hidden="true"></i></button>`;
      }).join('');
    ringEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn && !btn.disabled) {
        onAction(btn.dataset.act);
      }
      // Empty ring space is the FAB teleport target — never close on background click.
    });
    ringEl.addEventListener('pointerenter', cancelHide);
    ringEl.addEventListener('pointerleave', (e) => {
      if (insideBuzz(e.relatedTarget)) return;
      scheduleHide();
    });
    document.body.appendChild(ringEl);
    window.addEventListener('resize', () => { if (isRingOpen()) layoutRing(); });
  }

  function buildNote() {
    if (noteEl) return;
    noteEl = document.createElement('div');
    noteEl.id = NOTE_ID;
    noteEl.innerHTML = `
      <header>
        <div>
          <strong>Buzz note</strong>
          <span> — you see it before it goes</span>
        </div>
        <label>To
          <select id="bz-target" aria-label="Send to"></select>
        </label>
      </header>
      <img class="bz-preview" id="bz-preview" alt="Screenshot preview" />
      <textarea id="bz-note" placeholder="One line — what should they do?" maxlength="4000"></textarea>
      <div class="bz-meta" id="bz-meta"></div>
      <footer>
        <button type="button" data-note="mic" title="Dictation">Mic</button>
        <button type="button" data-note="discard">Discard</button>
        <button type="button" data-note="stop">Stop</button>
        <button type="button" class="primary" data-note="send">Send</button>
      </footer>
    `;
    noteEl.addEventListener('click', (e) => {
      const act = e.target.closest('[data-note]')?.dataset.note;
      if (act === 'discard') closeNote();
      if (act === 'send') void sendDrop();
      if (act === 'stop') stopRecording();
      if (act === 'mic') void startDictate();
    });
    document.body.appendChild(noteEl);
  }

  function fillTargets() {
    const sel = noteEl?.querySelector('#bz-target');
    if (!sel) return;
    const roster = globalThis.DenizenNpcRoster?.displayNames || ['Abby', 'Lucy', 'Marcus'];
    const assistant = globalThis.DenizenVisitorSession?.getAssistant?.();
    const preferred = assistant?.assistant_name || assistant?.npc_key || 'Abby';
    const names = Array.from(new Set([preferred, 'Abby', ...roster]));
    sel.innerHTML = names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    sel.value = preferred;
    state.target = preferred;
    sel.onchange = () => { state.target = sel.value; };
  }

  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function setRingOpen(open) {
    buildRing();
    ringEl.classList.toggle('open', !!open);
    document.documentElement.classList.toggle('denizen-buzz-ring-open', !!open);
    const fab = document.getElementById('denizen-phone-fab');
    if (fab) {
      if (open) {
        if (!fab.dataset.buzzTitle) fab.dataset.buzzTitle = fab.getAttribute('title') || '';
        fab.removeAttribute('title');
      } else if (fab.dataset.buzzTitle) {
        fab.title = fab.dataset.buzzTitle;
      }
    }
    if (open) {
      openedAt = Date.now();
      cancelHide();
      const place = () => layoutRing();
      requestAnimationFrame(() => {
        place();
        requestAnimationFrame(place);
      });
      setTimeout(place, 80);
      setTimeout(place, 240);
    }
  }

  function isRingOpen() {
    return !!ringEl?.classList.contains('open');
  }

  function toggleRing() {
    injectStyles();
    buildRing();
    setRingOpen(!isRingOpen());
  }

  function closeRing() {
    cancelHide();
    setRingOpen(false);
  }

  function openNote(kind) {
    injectStyles();
    buildNote();
    fillTargets();
    state.kind = kind || state.kind || 'note';
    noteEl.classList.add('open');
    const ta = noteEl.querySelector('#bz-note');
    ta.value = state.note || '';
    const preview = noteEl.querySelector('#bz-preview');
    if (state.imageDataUrl) {
      preview.src = state.imageDataUrl;
      preview.classList.add('show');
    } else {
      preview.removeAttribute('src');
      preview.classList.remove('show');
    }
    const meta = [];
    if (state.transcript) meta.push('Transcript ready');
    if (state.recording) meta.push(state.kind === 'meeting' ? 'Recording meeting…' : 'Recording…');
    if (state.imageDataUrl && window.DenizenDesktop?.buzzSaveCapture) {
      meta.push('Saved on this disk; Abby gets the path');
    } else if (state.imageDataUrl) {
      meta.push('You see it first; the office stores a copy so Abby can see it');
    }
    noteEl.querySelector('#bz-meta').textContent = meta.join(' · ');
    noteEl.classList.toggle('recording', !!state.recording);
    closeRing();
    setTimeout(() => ta?.focus(), 40);
  }

  function closeNote() {
    stopRecording();
    closeCrop();
    noteEl?.classList.remove('open', 'recording');
    state = {
      kind: 'note', note: '', transcript: '', imageDataUrl: null,
      imageName: 'buzz-screenshot.jpg', target: state.target || 'Abby',
      recording: false, recorder: null, chunks: [], recTimer: null,
      meetingTracks: [], speechRec: null, cropOrigin: null,
    };
  }

  function dataUrlToAttachment(dataUrl, name, mime) {
    const comma = String(dataUrl || '').indexOf(',');
    const data = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    return { name, mime: mime || 'image/jpeg', data };
  }

  async function captureScreenshot() {
    state.kind = 'screenshot';
    try {
      if (navigator.mediaDevices?.getDisplayMedia) {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const track = stream.getVideoTracks()[0];
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        await video.play();
        await new Promise((r) => setTimeout(r, 60));
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        canvas.getContext('2d').drawImage(video, 0, 0);
        track.stop();
        stream.getTracks().forEach((t) => t.stop());
        state.imageDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        state.imageName = 'buzz-screenshot.jpg';
        openCropper(state.imageDataUrl);
        return;
      }
    } catch (err) {
      if (err?.name === 'NotAllowedError') return;
    }
    pickImageFile();
  }

  function pickImageFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        state.imageDataUrl = String(reader.result || '');
        state.imageName = file.name || 'buzz-screenshot.jpg';
        openNote('screenshot');
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function closeCrop() {
    document.getElementById(CROP_ID)?.classList.remove('open');
    state.cropOrigin = null;
  }

  function cropImage(dataUrl, box, imgEl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const rect = imgEl.getBoundingClientRect();
        const scaleX = img.naturalWidth / rect.width;
        const scaleY = img.naturalHeight / rect.height;
        const sx = Math.max(0, (box.left - rect.left) * scaleX);
        const sy = Math.max(0, (box.top - rect.top) * scaleY);
        const sw = Math.max(4, box.width * scaleX);
        const sh = Math.max(4, box.height * scaleY);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(sw);
        canvas.height = Math.round(sh);
        canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = dataUrl;
    });
  }

  function openCropper(dataUrl) {
    injectStyles();
    let overlay = document.getElementById(CROP_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = CROP_ID;
      overlay.innerHTML = '<img alt="Screenshot — drag a box" /><div class="bz-crop-box" hidden></div><p>Drag a box to crop · click or Esc to keep the full shot</p>';
      overlay.addEventListener('mousedown', (e) => {
        if (e.target.closest('p')) return;
        state.cropOrigin = { x: e.clientX, y: e.clientY };
        const box = overlay.querySelector('.bz-crop-box');
        box.hidden = false;
        box.style.left = `${e.clientX}px`;
        box.style.top = `${e.clientY}px`;
        box.style.width = '0px';
        box.style.height = '0px';
      });
      overlay.addEventListener('mousemove', (e) => {
        if (!state.cropOrigin) return;
        const box = overlay.querySelector('.bz-crop-box');
        const x = Math.min(state.cropOrigin.x, e.clientX);
        const y = Math.min(state.cropOrigin.y, e.clientY);
        box.style.left = `${x}px`;
        box.style.top = `${y}px`;
        box.style.width = `${Math.abs(e.clientX - state.cropOrigin.x)}px`;
        box.style.height = `${Math.abs(e.clientY - state.cropOrigin.y)}px`;
      });
      overlay.addEventListener('mouseup', async (e) => {
        const origin = state.cropOrigin;
        state.cropOrigin = null;
        const box = overlay.querySelector('.bz-crop-box');
        const imgEl = overlay.querySelector('img');
        const w = Math.abs((e.clientX) - (origin?.x || 0));
        const h = Math.abs((e.clientY) - (origin?.y || 0));
        if (origin && w > 12 && h > 12) {
          try {
            const src = overlay.dataset.src || overlay.querySelector('img').src;
            state.imageDataUrl = await cropImage(src, box.getBoundingClientRect(), imgEl);
          } catch (_) {}
        }
        closeCrop();
        openNote('screenshot');
      });
      document.body.appendChild(overlay);
    }
    overlay.querySelector('img').src = dataUrl;
    overlay.dataset.src = dataUrl;
    overlay.querySelector('.bz-crop-box').hidden = true;
    overlay.classList.add('open');
    closeRing();
  }

  function speechEngine() {
    return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
  }

  function appendTranscript(text) {
    const next = String(text || '').trim();
    if (!next) return;
    state.transcript = state.transcript ? `${state.transcript}\n${next}` : next;
    if (!state.note) state.note = next;
    else if (!state.note.includes(next)) state.note = `${state.note}\n${next}`;
    const ta = noteEl?.querySelector('#bz-note');
    if (ta) ta.value = state.note;
    const meta = noteEl?.querySelector('#bz-meta');
    if (meta) meta.textContent = 'Transcript landing… edit before send';
  }

  function mixMeetingStream(display, mic) {
    const tracks = [...(display?.getVideoTracks?.() || [])];
    state.meetingTracks = [...(display?.getTracks?.() || []), ...(mic?.getTracks?.() || [])];
    const audioTracks = [
      ...(display?.getAudioTracks?.() || []),
      ...(mic?.getAudioTracks?.() || []),
    ];
    if (!audioTracks.length) {
      return new MediaStream(tracks);
    }
    try {
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      audioTracks.forEach((track) => {
        const src = new MediaStream([track]);
        ctx.createMediaStreamSource(src).connect(dest);
      });
      tracks.push(...dest.stream.getAudioTracks());
    } catch (_) {
      tracks.push(...audioTracks);
    }
    return new MediaStream(tracks);
  }

  async function startMeeting() {
    if (state.recording) {
      stopRecording();
      return;
    }
    closeRing();
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch (err) {
      if (err?.name === 'NotAllowedError') return;
      openNote('meeting');
      const meta = noteEl?.querySelector('#bz-meta');
      if (meta) meta.textContent = 'Screen share is needed to record a meeting.';
      return;
    }
    let mic = null;
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (_) {}
    const video = document.createElement('video');
    video.srcObject = display;
    video.muted = true;
    try {
      await video.play();
      await new Promise((r) => setTimeout(r, 80));
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext('2d').drawImage(video, 0, 0);
      state.imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      state.imageName = 'meeting-still.jpg';
    } catch (_) {}
    const stream = mixMeetingStream(display, mic);
    const audioOnly = new MediaStream(stream.getAudioTracks());
    if (!audioOnly.getAudioTracks().length) {
      display.getTracks().forEach((t) => t.stop());
      mic?.getTracks?.().forEach((t) => t.stop());
      openNote('meeting');
      const meta = noteEl?.querySelector('#bz-meta');
      if (meta) meta.textContent = 'No audio on that share — add a line about the meeting, then Send.';
      return;
    }
    const rec = new MediaRecorder(audioOnly);
    state.chunks = [];
    state.recorder = rec;
    state.recording = true;
    state.kind = 'meeting';
    rec.ondataavailable = async (e) => {
      if (!e.data?.size) return;
      try {
        const text = await transcribe(e.data);
        appendTranscript(text);
      } catch (err) {
        const meta = noteEl?.querySelector('#bz-meta');
        if (meta) meta.textContent = err.message || 'STT failed — keep talking or type the note';
      }
    };
    rec.onstop = () => {
      state.meetingTracks.forEach((t) => { try { t.stop(); } catch (_) {} });
      state.meetingTracks = [];
      display.getTracks().forEach((t) => t.stop());
      mic?.getTracks?.().forEach((t) => t.stop());
      state.recording = false;
      noteEl?.classList.remove('recording');
      const meta = noteEl?.querySelector('#bz-meta');
      if (meta) meta.textContent = state.transcript ? 'Meeting transcript ready — edit before send' : 'Meeting captured — add a line, then Send';
    };
    rec.start(MEETING_CHUNK_MS);
    openNote('meeting');
    const meta = noteEl?.querySelector('#bz-meta');
    if (meta) meta.textContent = 'Recording meeting… Stop when you are done. Transcripts land in parts.';
  }

  async function startDictate() {
    if (state.recording || state.speechRec) {
      stopRecording();
      return;
    }
    const SR = speechEngine();
    if (SR) {
      try {
        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = document.documentElement.lang || 'en-US';
        rec.onresult = (event) => {
          let finalText = '';
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const piece = event.results[i][0]?.transcript || '';
            if (event.results[i].isFinal) finalText += piece;
            else interim += piece;
          }
          if (finalText) appendTranscript(finalText);
          const ta = noteEl?.querySelector('#bz-note');
          if (ta && interim) ta.placeholder = interim;
          const meta = noteEl?.querySelector('#bz-meta');
          if (meta) meta.textContent = interim ? `Dictating… ${interim}` : 'Dictating… Stop when you are done';
        };
        rec.onerror = () => { void startRecording('dictate'); };
        state.speechRec = rec;
        state.recording = true;
        state.kind = 'dictate';
        rec.start();
        openNote('dictate');
        const meta = noteEl?.querySelector('#bz-meta');
        if (meta) meta.textContent = 'Dictating… written down as you speak. Stop when you are done.';
        return;
      } catch (_) {}
    }
    await startRecording('dictate');
  }

  async function blobToBase64(blob) {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  async function transcribe(blob) {
    const audioBase64 = await blobToBase64(blob);
    const headers = {
      'Content-Type': 'application/json',
      ...(globalThis.DenizenVisitorSession?.authHeaders?.() || {}),
    };
    const res = await fetch('/api/stt', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        audioBase64,
        mimeType: blob.type || 'audio/webm',
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `STT ${res.status}`);
    return String(json.text || '').trim();
  }

  async function startRecording(kind) {
    if (state.recording) {
      stopRecording();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    state.chunks = [];
    state.recorder = rec;
    state.recording = true;
    state.kind = kind;
    rec.ondataavailable = (e) => { if (e.data?.size) state.chunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      state.recording = false;
      const blob = new Blob(state.chunks, { type: rec.mimeType || 'audio/webm' });
      state.chunks = [];
      if (!blob.size) {
        openNote(kind);
        return;
      }
      try {
        const text = await transcribe(blob);
        state.transcript = text;
        if (!state.note) state.note = text;
        openNote(kind);
        const ta = noteEl?.querySelector('#bz-note');
        if (ta && text && !ta.value) ta.value = text;
        const meta = noteEl?.querySelector('#bz-meta');
        if (meta) meta.textContent = text ? 'Transcript ready — edit before send' : 'No speech captured';
      } catch (err) {
        openNote(kind);
        const meta = noteEl?.querySelector('#bz-meta');
        if (meta) meta.textContent = err.message || 'STT failed — type the note instead';
      }
    };
    rec.start(250);
    openNote(kind);
    const meta = noteEl?.querySelector('#bz-meta');
    if (meta) {
      meta.textContent = kind === 'record'
        ? 'Recording… Stop when you are done'
        : 'Dictating… Stop when you are done';
    }
    noteEl?.classList.add('recording');
    clearTimeout(state.recTimer);
    state.recTimer = setTimeout(() => stopRecording(), LONG_RECORD_MS);
  }

  function stopRecording() {
    clearTimeout(state.recTimer);
    state.recTimer = null;
    try { state.speechRec?.stop?.(); } catch (_) {}
    state.speechRec = null;
    try { if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop(); } catch (_) {}
    state.recorder = null;
    state.recording = false;
    state.meetingTracks.forEach((t) => { try { t.stop(); } catch (_) {} });
    state.meetingTracks = [];
    noteEl?.classList.remove('recording');
  }

  async function sendDrop() {
    const ta = noteEl?.querySelector('#bz-note');
    state.note = String(ta?.value || '').trim();
    const sel = noteEl?.querySelector('#bz-target');
    if (sel?.value) state.target = sel.value;
    const sendBtn = noteEl?.querySelector('[data-note="send"]');
    if (sendBtn) sendBtn.disabled = true;
    const attachments = [];
    if (state.imageDataUrl) {
      attachments.push(dataUrlToAttachment(state.imageDataUrl, state.imageName, 'image/jpeg'));
    }
    const sess = globalThis.DenizenVisitorSession;
    const from = sess?.getDisplayName?.() || 'Visitor';
    try {
      const res = await fetch('/api/context-drop', {
        method: 'POST',
        headers: sess?.authHeaders?.() || { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: state.note,
          transcript: state.transcript,
          kind: state.kind,
          to: state.target,
          from,
          attachments,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || `Drop failed (${res.status})`);
      }
      try {
        document.dispatchEvent(new CustomEvent('denizen-buzz-drop', { detail: json }));
      } catch (_) {}
      closeNote();
    } catch (err) {
      const meta = noteEl?.querySelector('#bz-meta');
      if (meta) meta.textContent = err.message || 'Could not send';
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function onAction(id) {
    if (id === 'hide') {
      closeRing();
      return;
    }
    if (id === 'phone') {
      closeRing();
      globalThis.DenizenPhoneUi?.open?.();
      return;
    }
    if (id === 'desktop') {
      closeRing();
      if (window.DenizenDesktop?.buzzOverlayToggle) {
        window.DenizenDesktop.buzzOverlayToggle(true);
        return;
      }
      window.location.href = '/desktop/download.html';
      return;
    }
    if (id === 'invisible') {
      closeRing();
      if (window.DenizenDesktop?.buzzOverlayInvisible) {
        window.DenizenDesktop.buzzOverlayInvisible();
      }
      return;
    }
    if (id === 'screenshot') {
      void captureScreenshot();
      return;
    }
    if (id === 'record') {
      void startRecording('record');
      return;
    }
    if (id === 'dictate') {
      void startDictate();
      return;
    }
    if (id === 'meeting') {
      void startMeeting();
    }
  }

  function onFabClick(api) {
    if (api?.isOpen?.()) {
      api.closePhone?.();
      return;
    }
    toggleRing();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (noteEl?.classList.contains('open')) { closeNote(); e.stopPropagation(); }
    else if (document.getElementById(CROP_ID)?.classList.contains('open')) {
      closeCrop();
      if (state.imageDataUrl) openNote('screenshot');
      e.stopPropagation();
    }
    else if (isRingOpen()) { closeRing(); e.stopPropagation(); }
  });

  document.addEventListener('paste', (e) => {
    if (!noteEl?.classList.contains('open') && !isRingOpen()) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.imageDataUrl = String(reader.result || '');
      state.imageName = file.name || 'paste.jpg';
      openNote('screenshot');
    };
    reader.readAsDataURL(file);
  });

  function consumeBuzzQuery() {
    let params;
    try { params = new URLSearchParams(location.search); } catch (_) { return; }
    const act = String(params.get('buzz') || '').trim();
    const allowed = new Set(['screenshot', 'record', 'dictate', 'meeting', 'phone']);
    if (!allowed.has(act)) return;
    try {
      params.delete('buzz');
      const q = params.toString();
      history.replaceState({}, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash || ''}`);
    } catch (_) {}
    setTimeout(() => {
      injectStyles();
      if (act === 'phone') {
        globalThis.DenizenPhoneUi?.open?.();
        return;
      }
      buildRing();
      onAction(act);
    }, 700);
  }

  function wireDismiss() {
    if (wireDismiss.bound) return;
    wireDismiss.bound = true;
    document.addEventListener('pointerdown', (e) => {
      if (!isRingOpen() || recentlyOpened()) return;
      if (insideBuzz(e.target)) return;
      closeRing();
    }, true);
    const watchFab = () => {
      const fab = document.getElementById('denizen-phone-fab');
      if (!fab || fab.dataset.bzWired === '1') return;
      fab.dataset.bzWired = '1';
      fab.addEventListener('pointerenter', cancelHide);
      fab.addEventListener('pointerleave', (e) => {
        if (insideBuzz(e.relatedTarget)) return;
        scheduleHide();
      });
    };
    watchFab();
    document.addEventListener('denizen-deferred-scripts-ready', watchFab);
  }

  function boot() {
    injectStyles();
    wireDismiss();
    consumeBuzzQuery();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  globalThis.DenizenBuzzCapture = {
    toggleRing,
    openRing: () => { injectStyles(); buildRing(); setRingOpen(true); },
    closeRing,
    openNote,
    closeNote,
    onFabClick,
    isRingOpen,
    captureScreenshot,
    startMeeting,
    startDictate,
  };
})();
