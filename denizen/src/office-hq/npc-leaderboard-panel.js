/**
 * NPC leaderboard panel ΓÇö who's shipping the most this week, with streaks.
 *
 * Toggle button top-left area (next to the work feed toggle). Polls
 * /api/office/leaderboard since this is a leisurely-refreshing HUD, not a
 * live feed ΓÇö no need for WS push here.
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-leaderboard-style';
  const PANEL_ID = 'denizen-leaderboard-panel';
  const TOGGLE_ID = 'denizen-leaderboard-toggle';
  const POLL_MS = 45000;

  let panelEl = null;
  let listEl = null;
  let toggleEl = null;
  let visible = false;
  let pollTimer = null;

  function ti(name, opts = {}) {
    return globalThis.DenizenTablerIcons?.icon(name, opts) || '';
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        top: calc(max(8px, env(safe-area-inset-top, 0px)) + 40px);
        left: max(8px, env(safe-area-inset-left, 0px));
        width: 240px;
        max-height: 260px;
        background: rgba(0, 0, 0, 0.8);
        border: 1px solid #1e293b;
        border-radius: 6px;
        display: none;
        flex-direction: column;
        z-index: 9997;
        font-family: 'Courier New', Courier, monospace;
        font-size: 11px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
        overflow: hidden;
      }
      #${PANEL_ID}.open { display: flex; }
      #${PANEL_ID} .lb-header {
        padding: 5px 8px;
        border-bottom: 1px solid #1e293b;
        color: #64748b;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      #${PANEL_ID} .lb-list { flex: 1; overflow-y: auto; padding: 4px 0; }
      #${PANEL_ID} .lb-row {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 3px 8px;
      }
      #${PANEL_ID} .lb-rank { color: #475569; width: 14px; flex-shrink: 0; }
      #${PANEL_ID} .lb-name { color: #e2e8f0; flex: 1; font-weight: bold; }
      #${PANEL_ID} .lb-shipped { color: #4ade80; }
      #${PANEL_ID} .lb-streak { color: #fbbf24; margin-left: 4px; }
      #${PANEL_ID} .lb-empty { padding: 10px 8px; color: #334155; font-style: italic; text-align: center; }
      #${TOGGLE_ID} {
        position: fixed;
        top: max(8px, env(safe-area-inset-top, 0px));
        left: calc(max(8px, env(safe-area-inset-left, 0px)) + 74px);
        z-index: 9999;
        background: rgba(2, 6, 23, 0.75);
        color: #94a3b8;
        border: 1px solid #334155;
        border-radius: 999px;
        padding: 4px 10px;
        font: 11px/1.4 system-ui, sans-serif;
        cursor: pointer;
        user-select: none;
      }
      #${TOGGLE_ID}:hover, #${TOGGLE_ID}[data-active="true"] {
        color: #dbeafe;
        border-color: #60a5fa;
      }
    `;
    document.head.appendChild(style);
  }

  function createDOM() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="lb-header">leaderboard ┬╖ this week</div>
      <div class="lb-list"></div>
    `;
    document.body.appendChild(panel);
    panelEl = panel;
    listEl = panel.querySelector('.lb-list');
    panel.addEventListener('mousedown', (e) => e.stopPropagation());

    const btn = document.createElement('button');
    btn.id = TOGGLE_ID;
    btn.type = 'button';
    btn.innerHTML = `${ti('trophy', { size: 14 })} Board`;
    btn.dataset.active = 'false';
    btn.title = 'NPC leaderboard ΓÇö who shipped the most this week';
    btn.addEventListener('click', toggle);
    document.body.appendChild(btn);
    toggleEl = btn;
  }

  function renderRows(rows) {
    if (!listEl) return;
    if (!rows.length) {
      listEl.innerHTML = '<div class="lb-empty">No shipped work yet</div>';
      return;
    }
    listEl.innerHTML = rows.slice(0, 5).map((r, i) => {
      const streak = r.streakDays > 0
        ? `<span class="lb-streak">${ti('flame', { size: 11, tone: 'gold' })}${r.streakDays}d</span>`
        : '';
      return `<div class="lb-row">
        <span class="lb-rank">${i + 1}.</span>
        <span class="lb-name">${_esc(r.npcName)}</span>
        <span class="lb-shipped">${r.shipped}</span>${streak}
      </div>`;
    }).join('');
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function refresh() {
    try {
      const res = await fetch('/api/office/leaderboard?period=week', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok) renderRows(data.leaderboard || []);
    } catch (_) {}
  }

  function show() {
    if (visible) return;
    visible = true;
    panelEl.classList.add('open');
    if (toggleEl) toggleEl.dataset.active = 'true';
    refresh();
    if (!pollTimer) pollTimer = setInterval(refresh, POLL_MS);
  }

  function hide() {
    if (!visible) return;
    visible = false;
    panelEl.classList.remove('open');
    if (toggleEl) toggleEl.dataset.active = 'false';
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function toggle() {
    if (visible) hide(); else show();
  }

  function init() {
    injectStyles();
    createDOM();
  }

  globalThis.DenizenNpcLeaderboardPanel = { init, show, hide, toggle, refresh };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
