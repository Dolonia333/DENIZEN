/**
 * Office level chip ΓÇö persistent HUD element showing office-wide XP/level,
 * driven by real outcomes (tasks shipped, CRM deals won, tickets closed).
 * Updates live over the existing /ws connection; celebrates level-ups with
 * a toast visible to everyone (not CEO-gated, unlike mesh-alert-toast).
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-office-level-chip-style';
  const CHIP_ID = 'denizen-office-level-chip';
  const TOAST_ID = 'denizen-office-level-toast';

  let chipEl = null;
  let toastEl = null;
  let toastHideTimer = null;
  let initialized = false;

  function ti(name, opts = {}) {
    return globalThis.DenizenTablerIcons?.icon(name, opts) || '';
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function injectStyles() {
    let s = document.getElementById(STYLE_ID);
    if (!s) {
      s = document.createElement('style');
      s.id = STYLE_ID;
      document.head.appendChild(s);
    }
    s.textContent = `
      #${CHIP_ID} {
        position: relative;
        z-index: 5;
        /* Lives in the HQ chrome row (right slot), not over the map. */
        top: auto !important;
        right: auto !important;
        bottom: auto !important;
        left: auto !important;
        width: max-content;
        max-width: 100%;
        height: auto !important;
        max-height: none;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 10px;
        border-radius: 999px;
        border: 1px solid #334155;
        background: rgba(2, 6, 23, 0.94);
        color: #86efac;
        font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.45);
        cursor: pointer;
        pointer-events: auto;
      }
      #${CHIP_ID}:hover { border-color: #60a5fa; color: #bbf7d0; }
      #${CHIP_ID} .bar {
        width: 60px;
        height: 4px;
        border-radius: 2px;
        background: rgba(148, 163, 184, 0.25);
        overflow: hidden;
      }
      #${CHIP_ID} .bar-fill {
        height: 100%;
        background: #4ade80;
      }
      html.denizen-phone-open #${CHIP_ID},
      html.denizen-chat-open #${CHIP_ID} {
        opacity: 0.35;
        pointer-events: none;
      }
      /* Laptop workbench sidebar covers the top-right — hide Levels while it is out. */
      html.denizen-work-rail-open:not(.denizen-phone) #${CHIP_ID} {
        display: none !important;
      }
      #${TOAST_ID} {
        position: fixed;
        top: calc(max(14px, env(safe-area-inset-top, 0px)) + 48px);
        right: max(14px, env(safe-area-inset-right, 0px));
        left: auto;
        bottom: auto;
        z-index: 100520;
        max-width: min(360px, calc(100vw - 28px));
        margin: 0;
        display: none;
        background: rgba(5, 46, 22, 0.96);
        border: 1px solid #4ade80;
        border-radius: 10px;
        padding: 10px 12px;
        font: 12px/1.45 ui-monospace, Menlo, monospace;
        color: #bbf7d0;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
        pointer-events: none;
        text-align: left;
      }
      html.denizen-touch #${CHIP_ID} {
        position: relative;
        top: auto !important;
        right: auto !important;
        padding: 6px 9px;
        font-size: 10px;
      }
      html.denizen-touch #${CHIP_ID} .bar { width: 48px; }
    `;
  }

  function ensureChip() {
    if (chipEl) return chipEl;
    injectStyles();
    chipEl = document.createElement('div');
    chipEl.id = CHIP_ID;
    chipEl.innerHTML = '<span class="label">Level 1</span><div class="bar"><div class="bar-fill" style="width:0%"></div></div>';
    const slot = document.getElementById('denizen-frame-level-slot');
    (slot || document.body).appendChild(chipEl);
    return chipEl;
  }

  function ensureToast() {
    if (toastEl) return toastEl;
    injectStyles();
    toastEl = document.createElement('div');
    toastEl.id = TOAST_ID;
    toastEl.setAttribute('role', 'status');
    document.body.appendChild(toastEl);
    return toastEl;
  }

  function updateFromProgress(progress) {
    if (!progress) return;
    const el = ensureChip();
    const pct = progress.xpForNextLevel
      ? Math.min(100, Math.round((progress.xpIntoLevel / progress.xpForNextLevel) * 100))
      : 100;
    const nextLabel = progress.xpForNextLevel != null
      ? `${progress.xpIntoLevel}/${progress.xpForNextLevel} XP`
      : 'max level';
    el.innerHTML =
      `<span class="label">Level ${progress.level} · ${nextLabel}</span>` +
      `<div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>`;
  }

  function showToast(text) {
    const el = ensureToast();
    el.textContent = text;
    el.style.display = 'block';
    if (toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => { el.style.display = 'none'; }, 8000);
  }

  function showToastHtml(html) {
    const el = ensureToast();
    el.innerHTML = html;
    el.style.display = 'block';
    if (toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => { el.style.display = 'none'; }, 8000);
  }

  function showLevelUpToast(payload) {
    showToastHtml(`${ti('confetti', { size: 15 })} Office reached Level ${payload?.level ?? '?'}!`);
  }

  function handleWorldStateChange(kind, payload) {
    if (kind === 'office_progress') updateFromProgress(payload);
    else if (kind === 'office_level_up') showLevelUpToast(payload);
    else if (kind === 'achievement_unlocked') {
      const iconName = payload?.icon || 'medal';
      showToastHtml(`${ti(iconName, { size: 15 })} Achievement unlocked: ${_esc(payload?.label || payload?.id || '?')}`);
      globalThis.DenizenOfficeHqPanel?.refresh?.();
    } else if (kind === 'quest_complete') {
      showToastHtml(`${ti('target', { size: 15 })} Quest complete: ${_esc(payload?.label || '?')} ΓÇö claim +${payload?.reward_xp ?? 0} XP`);
      globalThis.DenizenOfficeHqPanel?.refresh?.();
    }
  }

  function watchWs() {
    let attached = null;
    setInterval(() => {
      const ws = globalThis.__DenizenAgentWs;
      if (ws && ws !== attached) {
        attached = ws;
        ws.addEventListener('message', (ev) => {
          let m;
          try { m = JSON.parse(ev.data); } catch (_) { return; }
          if (m.type === 'world_state' && m.kind) {
            handleWorldStateChange(m.kind, m.payload);
          } else if (m.type === 'world_state_batch' && Array.isArray(m.changes)) {
            for (const c of m.changes) handleWorldStateChange(c.kind, c.payload);
          }
        });
      }
    }, 1000);
  }

  async function fetchInitial() {
    try {
      const res = await fetch('/api/office/progress', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok) updateFromProgress(data.progress);
    } catch (_) {}
  }

  function init() {
    if (initialized) return;
    initialized = true;
    const el = ensureChip();
    el.title = 'Open Office HQ';
    el.addEventListener('click', () => globalThis.DenizenOfficeHqPanel?.toggle?.());
    fetchInitial();
    watchWs();
  }

  globalThis.DenizenOfficeLevelChip = { init, updateFromProgress, showLevelUpToast, showToast, showToastHtml };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
