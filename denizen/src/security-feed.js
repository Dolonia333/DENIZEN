/**
 * Bouncer Security Feed — separate from CEO/Lucy chat.
 * Auto incident reports, Kali status, honeypot lines land here.
 */
(function () {
  'use strict';

  const PANEL_ID = 'denizen-security-feed';
  const CHIP_ID = 'denizen-security-chip';
  const STYLE_ID = 'denizen-security-feed-style';
  const MAX_ENTRIES = 80;

  let panel = null;
  let listEl = null;
  let open = false;
  const entries = [];
  const recentKeys = new Set();

  function formatIncidentReport(message) {
    const m = String(message || '');
    const sev = (m.match(/caught a (\w+)/i) || [])[1] || 'suspicious';
    const cat = (m.match(/caught a \w+ ([\w_]+)/i) || [])[1] || 'intrusion';
    const detail = (m.match(/Detail:\s*([^.]+)/i) || [])[1] || '';
    const confronted = (m.match(/When you confronted them:\s*([^.]+)/i) || [])[1] || '';
    const cm = (m.match(/Countermeasure you set up:\s*([^.]+)/i) || [])[1] || 'locked it down';
    const catNice = cat.replace(/_/g, ' ');
    const detailBit = detail.trim() ? ` — ${detail.trim()}` : '';
    const standoff = /still active|held their ground/i.test(confronted)
      ? ' They held their ground — eyes open.'
      : confronted.trim()
        ? ` ${confronted.trim().charAt(0).toUpperCase()}${confronted.trim().slice(1)}.`
        : '';
    const cmLine = cm.trim().replace(/^i\s+/i, '');
    return `Mm. ${sev} ${catNice}${detailBit}.${standoff} ${cmLine.charAt(0).toUpperCase()}${cmLine.slice(1)}. All clear.`;
  }

  function isSecurityTraffic(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    return (
      /^Mm\.\s+(high|low|medium|critical|suspicious)/i.test(t)
      || /^No active intruder/i.test(t)
      || /^Honeypot/i.test(t)
      || /^🐉/.test(t)
      || /lockout on that door/i.test(t)
      || /Kali (done|Linux)/i.test(t)
    );
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${CHIP_ID} {
        background: rgba(30, 20, 20, 0.92);
        color: #fca5a5;
        border: 1px solid #991b1b;
        border-radius: 999px;
        padding: 6px 12px;
        font: 12px/1.2 monospace;
        cursor: pointer;
        user-select: none;
        min-width: 44px;
        min-height: 44px;
        touch-action: manipulation;
      }
      #${CHIP_ID}[data-alert="1"] { color: #fef08a; border-color: #ca8a04; }
      #${PANEL_ID} {
        position: fixed;
        z-index: 100200;
        right: max(10px, env(safe-area-inset-right, 0px));
        bottom: calc(var(--denizen-dock-height, 56px) + 10px + env(safe-area-inset-bottom, 0px));
        width: min(380px, calc(100vw - 20px));
        max-height: min(42vh, 360px);
        display: none;
        flex-direction: column;
        background: rgba(15, 10, 10, 0.97);
        color: #fecaca;
        border: 1px solid #7f1d1d;
        border-radius: 12px;
        font: 11px/1.45 monospace;
        box-shadow: 0 10px 40px rgba(0,0,0,0.55);
        pointer-events: auto;
      }
      #${PANEL_ID}.open { display: flex !important; }
      #${PANEL_ID} header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-bottom: 1px solid #7f1d1d;
        background: rgba(69, 10, 10, 0.5);
      }
      #${PANEL_ID} header span { flex: 1; color: #fca5a5; font-weight: bold; }
      #${PANEL_ID} header button {
        background: #450a0a;
        color: #fecaca;
        border: 1px solid #991b1b;
        border-radius: 6px;
        padding: 4px 8px;
        cursor: pointer;
        touch-action: manipulation;
        min-height: 32px;
      }
      #${PANEL_ID} .sec-list {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
      }
      #${PANEL_ID} .sec-row {
        padding: 6px 0;
        border-bottom: 1px solid rgba(127, 29, 29, 0.45);
      }
      #${PANEL_ID} .sec-time { color: #94a3b8; font-size: 10px; }
      #${PANEL_ID} .sec-text { color: #fecaca; margin-top: 2px; }
      html.denizen-touch #${CHIP_ID} {
        min-width: 44px;
        max-width: 48px;
        padding: 6px 8px;
      }
    `;
    document.head.appendChild(s);
  }

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <header>
        <span>🛡️ Bouncer — Security</span>
        <button type="button" data-action="clear">Clear</button>
        <button type="button" data-action="close">✕</button>
      </header>
      <div class="sec-list"></div>
    `;
    document.body.appendChild(panel);
    listEl = panel.querySelector('.sec-list');
    panel.querySelector('[data-action="close"]').addEventListener('click', () => setOpen(false));
    panel.querySelector('[data-action="clear"]').addEventListener('click', () => {
      entries.length = 0;
      render();
    });
    return panel;
  }

  function ensureChip() {
    let chip = document.getElementById(CHIP_ID);
    if (chip) return chip;
    chip = document.createElement('button');
    chip.id = CHIP_ID;
    chip.type = 'button';
    chip.className = 'denizen-dock-chip';
    chip.title = 'Bouncer security feed';
    globalThis.DenizenBottomDock?.renderChip?.('denizen-security-chip', 'Security');
    if (!globalThis.DenizenBottomDock?.renderChip) chip.textContent = '🛡️';
    const toggle = () => setOpen(!open);
    if (window.DenizenTouchBind?.bindPress) window.DenizenTouchBind.bindPress(chip, toggle);
    else chip.addEventListener('click', toggle);
    document.body.appendChild(chip);
    return chip;
  }

  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function render() {
    ensurePanel();
    if (!listEl) return;
    if (!entries.length) {
      listEl.innerHTML = '<div style="color:#94a3b8;padding:8px">No security events yet.</div>';
      return;
    }
    listEl.innerHTML = entries.slice(0, 30).map((e) => `
      <div class="sec-row">
        <div class="sec-time">${esc(fmtTime(e.ts))} · ${esc(e.kind || 'event')}</div>
        <div class="sec-text">${esc(e.text)}</div>
      </div>
    `).join('');
  }

  function setOpen(next) {
    open = !!next;
    ensurePanel();
    panel.classList.toggle('open', open);
    if (open) render();
    const chip = document.getElementById(CHIP_ID);
    if (chip) chip.dataset.active = open ? '1' : '0';
  }

  function ingest({ text, kind = 'incident', ts = Date.now(), dedupeMs = 60000 }) {
    const body = String(text || '').trim();
    if (!body) return false;
    const key = `${kind}:${body.slice(0, 140)}`;
    if (recentKeys.has(key)) return false;
    recentKeys.add(key);
    setTimeout(() => recentKeys.delete(key), dedupeMs);

    entries.unshift({ text: body, kind, ts });
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;

    const chip = ensureChip();
    if (chip) chip.dataset.alert = '1';

    if (open) render();
    return true;
  }

  function boot() {
    injectStyle();
    ensureChip();
    ensurePanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.DenizenSecurityFeed = {
    ingest,
    formatIncidentReport,
    isSecurityTraffic,
    show: () => setOpen(true),
    hide: () => setOpen(false),
    toggle: () => setOpen(!open),
  };
})();
