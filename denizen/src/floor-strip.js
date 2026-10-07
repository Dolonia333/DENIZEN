/**
 * Floor strip — the last few things said on the office, kept after bubbles fade.
 * Click a line to open that person's Floor Line thread. The room stays up.
 *
 * In-world NPC speech bubbles (Phaser chips above sprites) are separate —
 * this strip is only the under-map caption log.
 */
(function () {
  'use strict';

  const STRIP_ID = 'denizen-floor-strip';
  const STYLE_ID = 'denizen-floor-strip-style';
  const MAX_KEPT = 12;
  const MAX_SHOWN = 3;

  const lines = [];
  let pinned = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${STRIP_ID} {
        width: 0;
        min-width: 100%;
        max-width: 100%;
        margin-top: 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        overflow: hidden;
        box-sizing: border-box;
      }
      #${STRIP_ID} .dz-floor-line {
        display: flex;
        gap: 8px;
        align-items: baseline;
        width: 100%;
        min-width: 0;
        margin: 0;
        text-align: left;
        background: rgba(2, 6, 23, 0.78);
        color: #e2e8f0;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 8px;
        padding: 5px 8px;
        font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
        cursor: pointer;
      }
      #${STRIP_ID} .dz-floor-line .who {
        color: #7dd3fc;
        font-weight: 700;
        flex: none;
        max-width: 46%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${STRIP_ID} .dz-floor-line .what {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${STRIP_ID} .dz-floor-line.kind-status {
        border-color: rgba(248, 113, 113, 0.45);
      }
      #${STRIP_ID} .dz-floor-line.kind-status .who { color: #fecaca; }
      #${STRIP_ID} .dz-floor-line.kind-quiet {
        cursor: default;
        color: #94a3b8;
      }
      /*
       * Touch: one thin caption under the map canvas (still inside #game-frame
       * so body row-flex does not park it beside the HQ). NPC speech bubbles
       * over sprites are unchanged (agent-actions).
       */
      html.denizen-touch #${STRIP_ID} {
        width: 0;
        min-width: 100%;
        max-width: 100%;
        margin: 2px 0 0;
        gap: 0;
        flex: 0 0 auto;
      }
      html.denizen-touch #${STRIP_ID} .dz-floor-line {
        font-size: 10px;
        line-height: 1.25;
        padding: 2px 0;
        gap: 6px;
        background: transparent;
        border: none;
        border-radius: 0;
        color: rgba(226, 232, 240, 0.82);
        box-shadow: none;
      }
      html.denizen-touch #${STRIP_ID} .dz-floor-line .who {
        color: #7dd3fc;
        font-size: 10px;
        max-width: 38%;
      }
      html.denizen-touch #${STRIP_ID} .dz-floor-line .what {
        color: rgba(203, 213, 225, 0.88);
      }
      html.denizen-touch #${STRIP_ID} .dz-floor-line.kind-status .who { color: #fecaca; }
      /* Hide empty quiet filler — it stole map height for nothing */
      html.denizen-touch #${STRIP_ID}:not(.has-lines) { display: none !important; }
      html.denizen-touch #${STRIP_ID} .dz-floor-line.kind-quiet { display: none !important; }
      /* One caption line under the map on all touch sizes */
      html.denizen-touch #${STRIP_ID} .dz-floor-line:nth-child(n+2) { display: none; }
      html.denizen-touch.denizen-landscape #${STRIP_ID} {
        margin-top: 1px;
      }
    `;
    document.head.appendChild(s);
  }

  function ensureStrip() {
    injectStyles();
    let el = document.getElementById(STRIP_ID);
    const frame = document.getElementById('game-frame');
    const map = document.getElementById('game-container');
    if (el) {
      // Keep under the map canvas inside the HQ frame (body is row-flex).
      if (frame && el.parentElement !== frame) {
        if (map && map.parentElement === frame) map.insertAdjacentElement('afterend', el);
        else frame.appendChild(el);
      } else if (frame && map && map.parentElement === frame && el.previousElementSibling !== map) {
        map.insertAdjacentElement('afterend', el);
      }
      return el;
    }
    if (!frame) return null;
    el = document.createElement('div');
    el.id = STRIP_ID;
    el.setAttribute('role', 'log');
    el.setAttribute('aria-label', 'Floor conversation');
    if (map && map.parentElement === frame) map.insertAdjacentElement('afterend', el);
    else frame.appendChild(el);
    return el;
  }

  function normalize(raw) {
    const text = String(raw?.text || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const from = String(raw.from || raw.name || 'Someone').trim() || 'Someone';
    return {
      from,
      to: String(raw.to || '').trim(),
      text: text.slice(0, 180),
      npcKey: raw.npcKey || '',
      npcName: raw.npcName || raw.name || raw.from || '',
      kind: raw.kind || 'say',
      at: Date.now(),
    };
  }

  function whoLabel(line) {
    return line.to ? `${line.from} → ${line.to}` : line.from;
  }

  function visibleLines() {
    const out = [];
    if (pinned) out.push(pinned);
    const room = MAX_SHOWN - out.length;
    if (room > 0) out.push(...lines.slice(-room));
    return out;
  }

  function render() {
    const el = ensureStrip();
    if (!el) return;
    const rows = visibleLines().filter((r) => r && r.kind !== 'quiet');
    el.classList.toggle('has-lines', rows.length > 0);
    if (!rows.length) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = rows.map((line, i) => (
      `<button type="button" class="dz-floor-line kind-${esc(line.kind)}" data-i="${i}">`
      + `<span class="who">${esc(whoLabel(line))}</span>`
      + `<span class="what">${esc(line.text)}</span>`
      + `</button>`
    )).join('');
    const shown = rows;
    el.querySelectorAll('.dz-floor-line').forEach((btn) => {
      const line = shown[Number(btn.dataset.i)];
      if (!line || line.kind === 'quiet') return;
      btn.addEventListener('click', () => openLine(line));
    });
  }

  function openLine(line) {
    const chat = globalThis.__DenizenPlayerChat;
    const key = line.npcKey;
    const name = line.npcName || line.to || line.from;
    if (!chat || !key || !name || name === 'You') return;
    try {
      chat.noteFloorLine?.({ npcKey: key, npcName: name, text: line.text });
      chat.openWithNpc(key, name, { walk: false });
    } catch (err) {
      console.warn('[FloorStrip] open thread failed:', err?.message || err);
    }
  }

  function push(raw) {
    const line = normalize(raw);
    if (!line || line.kind === 'status') return line;
    const prev = lines[lines.length - 1];
    if (prev && prev.from === line.from && prev.to === line.to && prev.text === line.text
      && Date.now() - prev.at < 1500) {
      return line;
    }
    lines.push(line);
    if (lines.length > MAX_KEPT) lines.splice(0, lines.length - MAX_KEPT);
    render();
    return line;
  }

  function pin(raw) {
    pinned = normalize({ ...raw, kind: 'status' });
    render();
  }

  function unpin() {
    pinned = null;
    render();
  }

  function recent() {
    return lines.slice().reverse();
  }

  globalThis.DenizenFloorStrip = { push, pin, unpin, recent, render };

  function boot() {
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
