/**
 * Office quests + achievements panel ΓÇö daily/weekly goals with manual
 * claim, and permanent milestone badges. Modeled on npc-leaderboard-panel
 * (toggle chip, fetch-poll); designed to slot into the future HQ hub.
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-quests-style';
  const PANEL_ID = 'denizen-quests-panel';
  const TOGGLE_ID = 'denizen-quests-toggle';
  const POLL_MS = 45000;

  let panelEl = null;
  let bodyEl = null;
  let toggleEl = null;
  let visible = false;
  let pollTimer = null;

  function ti(name, opts = {}) {
    return globalThis.DenizenTablerIcons?.icon(name, opts) || '';
  }
  let claiming = false;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        top: calc(max(8px, env(safe-area-inset-top, 0px)) + 40px);
        left: calc(max(8px, env(safe-area-inset-left, 0px)) + 80px);
        width: 270px;
        max-height: 340px;
        background: rgba(0, 0, 0, 0.82);
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
      #${PANEL_ID} .qp-body { flex: 1; overflow-y: auto; padding: 4px 0 8px; }
      #${PANEL_ID} .qp-section {
        padding: 6px 8px 3px;
        color: #64748b;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      #${PANEL_ID} .qp-quest { padding: 4px 8px 6px; }
      #${PANEL_ID} .qp-row { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
      #${PANEL_ID} .qp-label { color: #cbd5e1; }
      #${PANEL_ID} .qp-xp { color: #4ade80; font-size: 10px; flex-shrink: 0; }
      #${PANEL_ID} .qp-bar { height: 4px; border-radius: 2px; background: rgba(148,163,184,0.18); margin-top: 4px; overflow: hidden; }
      #${PANEL_ID} .qp-fill { height: 100%; background: #60a5fa; }
      #${PANEL_ID} .qp-fill.done { background: #4ade80; }
      #${PANEL_ID} .qp-meta { color: #64748b; font-size: 9px; margin-top: 3px; }
      #${PANEL_ID} .qp-claim {
        margin-top: 4px;
        background: rgba(74, 222, 128, 0.15);
        border: 1px solid rgba(74, 222, 128, 0.5);
        color: #86efac;
        border-radius: 5px;
        padding: 3px 9px;
        font: 10px 'Courier New', Courier, monospace;
        cursor: pointer;
      }
      #${PANEL_ID} .qp-claim:hover { background: rgba(74, 222, 128, 0.3); }
      #${PANEL_ID} .qp-claimed { color: #4ade80; font-size: 10px; margin-top: 3px; }
      #${PANEL_ID} .qp-badges { display: flex; flex-wrap: wrap; gap: 5px; padding: 4px 8px 2px; }
      #${PANEL_ID} .qp-badge {
        font-size: 10px;
        border-radius: 999px;
        padding: 3px 8px;
        border: 1px solid rgba(250, 204, 21, 0.45);
        background: rgba(250, 204, 21, 0.12);
        color: #fde68a;
      }
      #${PANEL_ID} .qp-badge.locked {
        border-color: #1e293b;
        background: rgba(148, 163, 184, 0.06);
        color: #475569;
      }
      #${TOGGLE_ID} {
        position: fixed;
        top: max(8px, env(safe-area-inset-top, 0px));
        left: calc(max(8px, env(safe-area-inset-left, 0px)) + 152px);
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
    panel.innerHTML = '<div class="qp-body"></div>';
    document.body.appendChild(panel);
    panelEl = panel;
    bodyEl = panel.querySelector('.qp-body');
    panel.addEventListener('mousedown', (e) => e.stopPropagation());

    const btn = document.createElement('button');
    btn.id = TOGGLE_ID;
    btn.type = 'button';
    btn.innerHTML = `${ti('target', { size: 14 })} Quests`;
    btn.dataset.active = 'false';
    btn.title = 'Office quests and achievements';
    btn.addEventListener('click', toggle);
    document.body.appendChild(btn);
    toggleEl = btn;
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderQuest(q) {
    const pct = Math.min(100, Math.round((q.count / q.target) * 100));
    let footer;
    if (q.claimed) {
      footer = `<div class="qp-claimed">${ti('check', { size: 12, tone: 'green' })} claimed</div>`;
    } else if (q.complete) {
      footer = `<button class="qp-claim" data-quest="${_esc(q.id)}">claim +${q.reward_xp} XP</button>`;
    } else {
      footer = `<div class="qp-meta">${q.count} / ${q.target} ┬╖ ${_esc(q.period)}</div>`;
    }
    return `<div class="qp-quest">
      <div class="qp-row"><span class="qp-label">${_esc(q.label)}</span><span class="qp-xp">+${q.reward_xp} XP</span></div>
      <div class="qp-bar"><div class="qp-fill${q.complete ? ' done' : ''}" style="width:${pct}%"></div></div>
      ${footer}
    </div>`;
  }

  function renderBadge(a, locked) {
    const progress = locked && a.threshold > 1 ? ` ${Math.min(a.progress, a.threshold)}/${a.threshold}` : '';
    const iconHtml = locked
      ? ti('lock', { size: 12, tone: 'muted')
      : ti(a.icon || 'medal', { size: 12, tone: 'gold' });
    return `<span class="qp-badge${locked ? ' locked' : ''}" title="${_esc(a.label)}">${iconHtml} ${_esc(a.label)}${progress}</span>`;
  }

  function render(data) {
    if (!bodyEl) return;
    const daily = (data.quests || []).filter((q) => q.period === 'daily');
    const weekly = (data.quests || []).filter((q) => q.period === 'weekly');
    const html = [
      '<div class="qp-section">daily quests</div>',
      daily.map(renderQuest).join('') || '<div class="qp-quest qp-meta">none configured</div>',
      '<div class="qp-section">weekly quests</div>',
      weekly.map(renderQuest).join('') || '<div class="qp-quest qp-meta">none configured</div>',
      '<div class="qp-section">achievements</div>',
      '<div class="qp-badges">',
      (data.unlocked || []).map((a) => renderBadge(a, false)).join(''),
      (data.locked || []).map((a) => renderBadge(a, true)).join(''),
      '</div>',
    ].join('');
    bodyEl.innerHTML = html;

    bodyEl.querySelectorAll('.qp-claim').forEach((btn) => {
      btn.addEventListener('click', () => claim(btn.dataset.quest));
    });
  }

  async function refresh() {
    try {
      const [qRes, aRes] = await Promise.all([
        fetch('/api/office/quests', { cache: 'no-store' }),
        fetch('/api/office/achievements', { cache: 'no-store' }),
      ]);
      if (!qRes.ok || !aRes.ok) return;
      const qData = await qRes.json();
      const aData = await aRes.json();
      if (qData?.ok && aData?.ok) {
        render({ quests: qData.quests, unlocked: aData.unlocked, locked: aData.locked });
      }
    } catch (_) {}
  }

  async function claim(questId) {
    if (claiming || !questId) return;
    claiming = true;
    try {
      const res = await fetch('/api/office/quests/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: questId }),
      });
      const data = await res.json().catch(() => null);
      if (data?.ok) {
        globalThis.DenizenOfficeLevelChip?.showToastHtml?.(
          `${ti('target', { size: 14 })} +${data.quest?.reward_xp ?? 0} XP claimed ΓÇö ${_esc(data.quest?.label || '')}`,
        );
        globalThis.DenizenOfficeLevelChip?.updateFromProgress?.(data.progress);
      }
    } catch (_) {}
    claiming = false;
    refresh();
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

  globalThis.DenizenOfficeQuestsPanel = { init, show, hide, toggle, refresh };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
