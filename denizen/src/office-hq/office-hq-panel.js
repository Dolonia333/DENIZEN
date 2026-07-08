/**
 * Office HQ ΓÇö openable home screen for office progression: level/XP,
 * while-you-were-away, shipped-work heatmap, leaderboard, weekly quests,
 * achievements. Consolidates npc-leaderboard-panel + office-quests-panel.
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-office-hq-style';
  const OVERLAY_ID = 'denizen-office-hq-overlay';
  const PANEL_ID = 'denizen-office-hq-panel';
  const TOGGLE_ID = 'denizen-office-hq-toggle';
  const LAST_SEEN_KEY = 'denizen_hq_last_seen';
  const POLL_MS = 45000;

  let overlayEl = null;
  let panelEl = null;
  let bodyEl = null;
  let toggleEl = null;
  let visible = false;
  let pollTimer = null;
  let claiming = false;
  let lastData = null;
  let heatmapExpanded = true;
  let achievementsExpanded = true;

  function ti(name, opts = {}) {
    return globalThis.DenizenTablerIcons?.icon(name, opts) || '';
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        inset: 0;
        z-index: 100600;
        background: rgba(2, 6, 23, 0.72);
        display: none;
        align-items: center;
        justify-content: center;
        padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right))
          max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
      }
      #${OVERLAY_ID}.open { display: flex; }
      #${PANEL_ID} {
        width: min(420px, 96vw);
        height: min(88vh, 720px);
        min-height: 360px;
        background: rgba(0, 0, 0, 0.92);
        border: 2px solid #1e293b;
        border-radius: 8px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.65), inset 0 0 0 1px rgba(148, 163, 184, 0.08);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: 'Courier New', Courier, ui-monospace, Menlo, monospace;
        font-size: 11px;
        color: #cbd5e1;
        image-rendering: pixelated;
      }
      #${PANEL_ID} .hq-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        border-bottom: 1px solid #1e293b;
        background: rgba(15, 23, 42, 0.6);
      }
      #${PANEL_ID} .hq-title {
        font-size: 11px;
        font-weight: bold;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #94a3b8;
      }
      #${PANEL_ID} .hq-close {
        background: transparent;
        border: 1px solid #334155;
        color: #94a3b8;
        border-radius: 4px;
        padding: 2px 8px;
        font: 10px 'Courier New', Courier, monospace;
        cursor: pointer;
      }
      #${PANEL_ID} .hq-close:hover { color: #e2e8f0; border-color: #64748b; }
      #${PANEL_ID} .hq-body {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        padding: 0 0 10px;
      }
      #${PANEL_ID} .hq-loading {
        padding: 16px 12px;
        color: #64748b;
        font-style: italic;
      }
      #${PANEL_ID} .hq-error {
        padding: 12px;
        margin: 8px 12px;
        border: 1px solid #7f1d1d;
        border-radius: 6px;
        color: #fca5a5;
        background: rgba(127, 29, 29, 0.2);
      }
      #${PANEL_ID} .hq-hero {
        padding: 12px 12px 10px;
        border-bottom: 1px solid #1e293b;
      }
      #${PANEL_ID} .hq-level-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 6px;
      }
      #${PANEL_ID} .hq-level { color: #86efac; font-size: 13px; font-weight: bold; }
      #${PANEL_ID} .hq-xp-label { color: #64748b; font-size: 10px; }
      #${PANEL_ID} .hq-bar {
        height: 6px;
        border-radius: 2px;
        background: rgba(148, 163, 184, 0.18);
        overflow: hidden;
        margin-bottom: 8px;
      }
      #${PANEL_ID} .hq-bar-fill { height: 100%; background: #4ade80; }
      #${PANEL_ID} .hq-stats-line { color: #e2e8f0; font-size: 11px; }
      #${PANEL_ID} .hq-streak { color: #fbbf24; }
      #${PANEL_ID} .hq-shipped { color: #4ade80; }
      #${PANEL_ID} .hq-section {
        padding: 8px 12px 4px;
        color: #64748b;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      #${PANEL_ID} .hq-section.collapsible {
        cursor: pointer;
        user-select: none;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      #${PANEL_ID} .hq-section.collapsible:hover { color: #94a3b8; }
      #${PANEL_ID} .hq-away {
        padding: 4px 12px 8px;
        color: #cbd5e1;
        line-height: 1.5;
      }
      #${PANEL_ID} .hq-away li { margin: 2px 0 2px 16px; }
      #${PANEL_ID} .hq-away-quiet { color: #475569; font-style: italic; padding: 4px 12px 8px; }
      #${PANEL_ID} .hq-heatmap-wrap { padding: 4px 12px 10px; }
      #${PANEL_ID} .hq-heatmap {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 3px;
      }
      #${PANEL_ID} .hq-heat-cell {
        aspect-ratio: 1;
        border-radius: 2px;
        border: 1px solid rgba(30, 41, 59, 0.8);
        min-height: 10px;
      }
      #${PANEL_ID} .hq-heat-legend {
        margin-top: 6px;
        color: #475569;
        font-size: 9px;
        display: flex;
        justify-content: space-between;
      }
      #${PANEL_ID} .hq-lb-row {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 3px 12px;
      }
      #${PANEL_ID} .hq-lb-rank { color: #475569; width: 16px; }
      #${PANEL_ID} .hq-lb-name { color: #e2e8f0; flex: 1; font-weight: bold; }
      #${PANEL_ID} .hq-lb-shipped { color: #4ade80; }
      #${PANEL_ID} .hq-lb-streak { color: #fbbf24; margin-left: 4px; }
      #${PANEL_ID} .hq-quest { padding: 4px 12px 8px; }
      #${PANEL_ID} .hq-quest-row { display: flex; justify-content: space-between; gap: 6px; }
      #${PANEL_ID} .hq-quest-xp { color: #4ade80; font-size: 10px; }
      #${PANEL_ID} .hq-quest-bar {
        height: 4px;
        border-radius: 2px;
        background: rgba(148, 163, 184, 0.18);
        margin-top: 4px;
        overflow: hidden;
      }
      #${PANEL_ID} .hq-quest-fill { height: 100%; background: #60a5fa; }
      #${PANEL_ID} .hq-quest-fill.done { background: #4ade80; }
      #${PANEL_ID} .hq-claim {
        margin-top: 5px;
        background: rgba(74, 222, 128, 0.12);
        border: 1px solid rgba(74, 222, 128, 0.45);
        color: #86efac;
        border-radius: 4px;
        padding: 3px 10px;
        font: 10px 'Courier New', Courier, monospace;
        cursor: pointer;
      }
      #${PANEL_ID} .hq-claim:hover { background: rgba(74, 222, 128, 0.28); }
      #${PANEL_ID} .hq-claimed { color: #4ade80; font-size: 10px; margin-top: 4px; }
      #${PANEL_ID} .hq-meta { color: #64748b; font-size: 9px; margin-top: 3px; }
      #${PANEL_ID} .hq-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        padding: 4px 12px 8px;
      }
      #${PANEL_ID} .hq-badge {
        font-size: 10px;
        border-radius: 999px;
        padding: 3px 8px;
        border: 1px solid rgba(250, 204, 21, 0.45);
        background: rgba(250, 204, 21, 0.1);
        color: #fde68a;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      #${PANEL_ID} .hq-badge.locked {
        border-color: #1e293b;
        background: rgba(148, 163, 184, 0.05);
        color: #475569;
      }
      #${PANEL_ID} .hq-enter {
        margin: 8px 12px 4px;
        width: calc(100% - 24px);
        padding: 8px;
        border-radius: 6px;
        border: 1px solid #334155;
        background: rgba(59, 130, 246, 0.12);
        color: #93c5fd;
        font: 11px 'Courier New', Courier, monospace;
        font-weight: bold;
        cursor: pointer;
      }
      #${PANEL_ID} .hq-enter:hover { background: rgba(59, 130, 246, 0.22); }
      #${TOGGLE_ID} {
        position: fixed;
        top: max(8px, env(safe-area-inset-top, 0px));
        left: calc(max(8px, env(safe-area-inset-left, 0px)) + 74px);
        z-index: 100200;
        background: rgba(2, 6, 23, 0.75);
        color: #94a3b8;
        border: 1px solid #334155;
        border-radius: 999px;
        padding: 4px 10px;
        font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
        cursor: pointer;
        user-select: none;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      #${TOGGLE_ID}:hover, #${TOGGLE_ID}[data-active="true"] {
        color: #dbeafe;
        border-color: #60a5fa;
      }
      @media (max-width: 480px) {
        #${PANEL_ID} .hq-heatmap-wrap.collapsed,
        #${PANEL_ID} .hq-badges.collapsed { display: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getLastSeen() {
    try {
      const v = localStorage.getItem(LAST_SEEN_KEY);
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    } catch (_) {}
    return Date.now() - 24 * 60 * 60 * 1000;
  }

  function touchLastSeen() {
    try { localStorage.setItem(LAST_SEEN_KEY, String(Date.now())); } catch (_) {}
  }

  function heatColor(shipped, max) {
    if (!shipped) return 'rgba(30, 41, 59, 0.5)';
    const t = Math.min(1, shipped / max);
    const g = Math.round(100 + t * 155);
    return `rgba(34, ${g}, 80, ${0.35 + t * 0.55})`;
  }

  function renderHeatmap(heatmap) {
    if (!heatmap?.cells?.length) return '<div class="hq-away-quiet">no ship history yet</div>';
    const cells = heatmap.cells.map((c) => {
      const title = `${c.date}: ${c.shipped} shipped`;
      const bg = heatColor(c.shipped, heatmap.max || 1);
      return `<div class="hq-heat-cell" style="background:${bg}" title="${_esc(title)}"></div>`;
    }).join('');
    return `<div class="hq-heatmap-wrap${heatmapExpanded ? '' : ' collapsed'}">
      <div class="hq-heatmap">${cells}</div>
      <div class="hq-heat-legend"><span>less</span><span>shipped work ┬╖ ${heatmap.days || 35}d</span><span>more</span></div>
    </div>`;
  }

  function renderQuest(q) {
    const pct = Math.min(100, Math.round((q.count / q.target) * 100));
    let footer;
    if (q.claimed) footer = `<div class="hq-claimed">${ti('check', { size: 12, tone: 'green' })} claimed</div>`;
    else if (q.complete) {
      footer = `<button class="hq-claim" data-quest="${_esc(q.id)}">claim +${q.reward_xp} XP</button>`;
    } else {
      footer = `<div class="hq-meta">${q.count} / ${q.target}</div>`;
    }
    return `<div class="hq-quest">
      <div class="hq-quest-row"><span>${_esc(q.label)}</span><span class="hq-quest-xp">+${q.reward_xp} XP</span></div>
      <div class="hq-quest-bar"><div class="hq-quest-fill${q.complete ? ' done' : ''}" style="width:${pct}%"></div></div>
      ${footer}
    </div>`;
  }

  function renderBadge(a, locked) {
    const progress = locked && a.threshold > 1 ? ` ${Math.min(a.progress, a.threshold)}/${a.threshold}` : '';
    const iconHtml = locked
      ? ti('lock', { size: 12, tone: 'muted' })
      : ti(a.icon || 'medal', { size: 12, tone: 'gold' });
    return `<span class="hq-badge${locked ? ' locked' : ''}" title="${_esc(a.label)}">${iconHtml}<span>${_esc(a.label)}${progress}</span></span>`;
  }

  function renderLoading(message) {
    if (!bodyEl) return;
    bodyEl.innerHTML = `<div class="hq-loading">${_esc(message || 'loading office statsΓÇª')}</div>`;
  }

  function renderError(message) {
    if (!bodyEl) return;
    bodyEl.innerHTML = `<div class="hq-error">${_esc(message)}</div>`;
  }

  function emptyHqPayload() {
    return {
      progress: { level: 1, xpIntoLevel: 0, xpForNextLevel: 50, totalXp: 0 },
      today: { shipped: 0 },
      maxStreak: 0,
      topStreakNpc: null,
      heatmap: { cells: [], max: 1, days: 35 },
      leaderboard: [],
      quests: [],
      achievements: { unlocked: [], locked: [] },
      away: { quiet: true, lines: [] },
    };
  }

  function render(data) {
    if (!bodyEl || !data) return;
    lastData = data;
    const p = data.progress || {};
    const pct = p.xpForNextLevel
      ? Math.min(100, Math.round((p.xpIntoLevel / p.xpForNextLevel) * 100))
      : 100;
    const xpLabel = p.xpForNextLevel != null
      ? `${p.xpIntoLevel}/${p.xpForNextLevel} XP`
      : 'max level';
    const streakLine = data.maxStreak > 0
      ? `<span class="hq-streak">${ti('flame', { size: 13, tone: 'gold' })} ${data.maxStreak}-day streak${data.topStreakNpc ? ` ┬╖ ${_esc(data.topStreakNpc)}` : ''}</span>`
      : '<span class="hq-streak">no active streak</span>';
    const todayShipped = data.today?.shipped || 0;

    let awayHtml;
    if (data.away?.quiet) {
      awayHtml = '<div class="hq-away-quiet">quiet while you were away ΓÇö office is warming up</div>';
    } else {
      const items = (data.away?.lines || []).map((l) => `<li>${_esc(l)}</li>`).join('');
      awayHtml = `<ul class="hq-away">${items}</ul>`;
    }

    const lb = (data.leaderboard || []).filter((r) => r.shipped > 0).slice(0, 5);
    const lbHtml = lb.length
      ? lb.map((r, i) => {
        const streak = r.streakDays > 0
          ? `<span class="hq-lb-streak">${ti('flame', { size: 11, tone: 'gold' })}${r.streakDays}d</span>`
          : '';
        return `<div class="hq-lb-row">
          <span class="hq-lb-rank">${i + 1}.</span>
          <span class="hq-lb-name">${_esc(r.npcName)}</span>
          <span class="hq-lb-shipped">${r.shipped}</span>${streak}
        </div>`;
      }).join('')
      : '<div class="hq-away-quiet">no shipped work this week</div>';

    const weekly = (data.quests || []).filter((q) => q.period === 'weekly');
    const achievements = data.achievements || {};

    bodyEl.innerHTML = `
      <div class="hq-hero">
        <div class="hq-level-row">
          <span class="hq-level">Level ${p.level || 1}</span>
          <span class="hq-xp-label">${xpLabel}</span>
        </div>
        <div class="hq-bar"><div class="hq-bar-fill" style="width:${pct}%"></div></div>
        <div class="hq-stats-line">${streakLine} ┬╖ <span class="hq-shipped">${todayShipped} shipped today</span></div>
      </div>
      <div class="hq-section">while you were away</div>
      ${awayHtml}
      <div class="hq-section collapsible" data-collapse="heatmap">shipped-work heatmap <span>${ti(heatmapExpanded ? 'chevron-down' : 'chevron-right', { size: 12, tone: 'muted' })}</span></div>
      ${renderHeatmap(data.heatmap)}
      <div class="hq-section">leaderboard ┬╖ this week</div>
      ${lbHtml}
      <div class="hq-section">weekly quests</div>
      ${weekly.map(renderQuest).join('') || '<div class="hq-away-quiet">none configured</div>'}
      <div class="hq-section collapsible" data-collapse="achievements">achievements <span>${ti(achievementsExpanded ? 'chevron-down' : 'chevron-right', { size: 12, tone: 'muted' })}</span></div>
      <div class="hq-badges${achievementsExpanded ? '' : ' collapsed'}">
        ${(achievements.unlocked || []).map((a) => renderBadge(a, false)).join('')}
        ${(achievements.locked || []).map((a) => renderBadge(a, true)).join('')}
      </div>
      <button type="button" class="hq-enter">enter office ΓåÆ</button>
    `;

    bodyEl.querySelectorAll('.hq-claim').forEach((btn) => {
      btn.addEventListener('click', () => claim(btn.dataset.quest));
    });
    bodyEl.querySelectorAll('.hq-section.collapsible').forEach((el) => {
      el.addEventListener('click', () => {
        const key = el.dataset.collapse;
        if (key === 'heatmap') heatmapExpanded = !heatmapExpanded;
        if (key === 'achievements') achievementsExpanded = !achievementsExpanded;
        render(lastData);
      });
    });
    bodyEl.querySelector('.hq-enter')?.addEventListener('click', hide);
  }

  function createDOM() {
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = `<div id="${PANEL_ID}" role="dialog" aria-label="Office HQ">
      <div class="hq-topbar">
        <span class="hq-title">Office HQ</span>
        <button type="button" class="hq-close" aria-label="Close">esc</button>
      </div>
      <div class="hq-body"></div>
    </div>`;
    document.body.appendChild(overlay);
    overlayEl = overlay;
    panelEl = overlay.querySelector(`#${PANEL_ID}`);
    bodyEl = panelEl.querySelector('.hq-body');
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) hide(); });
    panelEl.addEventListener('mousedown', (e) => e.stopPropagation());
    panelEl.querySelector('.hq-close')?.addEventListener('click', hide);

    const btn = document.createElement('button');
    btn.id = TOGGLE_ID;
    btn.type = 'button';
    btn.innerHTML = `${ti('building-skyscraper', { size: 14 })} HQ`;
    btn.dataset.active = 'false';
    btn.title = 'Office HQ ΓÇö level, streaks, quests, achievements';
    btn.addEventListener('click', toggle);
    document.body.appendChild(btn);
    toggleEl = btn;

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && visible) hide();
    });
  }

  async function refresh() {
    const since = getLastSeen();
    renderLoading();
    try {
      const res = await fetch(`/api/office/hq?since=${encodeURIComponent(since)}`, { cache: 'no-store' });
      if (!res.ok) {
        const errText = res.status === 404
          ? 'Office HQ API not found ΓÇö restart the Denizen server (npm start) to pick up the latest code.'
          : `Could not load office stats (HTTP ${res.status}).`;
        renderError(errText);
        return;
      }
      const data = await res.json();
      if (data?.ok) render(data);
      else render(emptyHqPayload());
    } catch (err) {
      renderError(`Could not reach the office API. Is the server running? ${err?.message || ''}`.trim());
    }
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
          `${ti('target', { size: 14 })} +${data.quest?.reward_xp ?? 0} XP ΓÇö ${_esc(data.quest?.label || '')}`,
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
    overlayEl.classList.add('open');
    if (toggleEl) toggleEl.dataset.active = 'true';
    renderLoading();
    refresh();
    if (!pollTimer) pollTimer = setInterval(refresh, POLL_MS);
  }

  function hide() {
    if (!visible) return;
    visible = false;
    overlayEl.classList.remove('open');
    if (toggleEl) toggleEl.dataset.active = 'false';
    touchLastSeen();
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function toggle() {
    if (visible) hide(); else show();
  }

  function init() {
    injectStyles();
    createDOM();
    touchLastSeen();
  }

  globalThis.DenizenOfficeHqPanel = { init, show, hide, toggle, refresh };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
