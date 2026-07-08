/**
 * Visitor NPC Team — Phone UI app with ID cards, batch add, soul/memory view.
 */
(function () {
  'use strict';

  const PANEL_ID = 'denizen-npc-team-panel';
  const STYLE_ID = 'denizen-npc-team-style';
  const TOAST_ID = 'denizen-npc-team-toast';

  let panelEl = null;
  let team = null;
  let orgTeam = null;
  let canManageOrg = false;
  let rosterMode = 'personal';
  let loading = false;
  let view = 'roster';
  let selectedKey = null;
  let orgSelectedKey = null;
  let soulCache = {};
  let draftEdits = {};
  let orgDraftEdits = {};
  let pickSelected = new Set();
  let batchAdding = false;
  let panelStatus = '';

  function api() {
    return globalThis.DenizenVisitorSession || null;
  }

  function hasIdentity() {
    return Boolean(api()?.getIdentityId?.());
  }

  function identityBannerHtml() {
    if (hasIdentity()) return '';
    return `<div class="nt-status nt-status-warn">Sign in via <b>Profile</b> before you can save NPCs to your team.</div>`;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function npcOptions() {
    const roster = globalThis.DenizenNpcRoster;
    const protectedKeys = new Set(['lucy']);
    const entries = Array.isArray(roster?.entries) ? roster.entries : [];
    return entries
      .filter((e) => e?.folder && !protectedKeys.has(String(e.folder).toLowerCase()))
      .map((e) => ({
        key: e.folder,
        label: e.display || e.folder,
        portrait: portraitForKey(e.folder),
      }));
  }

  function portraitForKey(npcKey, scale = 2) {
    const roster = globalThis.DenizenNpcRoster;
    const entry = (roster?.entries || []).find((e) => e.folder === String(npcKey || '').toLowerCase());
    if (!entry) return null;
    const frame = 1;
    const col = frame % 4;
    const row = Math.floor(frame / 4);
    const fw = 32;
    const fh = 48;
    const sw = fw * scale;
    const sh = fh * scale;
    return {
      url: `assets/${entry.assetName}.png`,
      style: [
        `background-image:url('assets/${entry.assetName}.png')`,
        `background-position:${-col * sw}px ${-row * sh}px`,
        `background-size:${4 * sw}px ${4 * sh}px`,
        `width:${sw}px`,
        `height:${sh}px`,
      ].join(';'),
      label: entry.display,
    };
  }

  function portraitHtml(npcKey, scale = 2, extraClass = '') {
    const p = portraitForKey(npcKey, scale);
    if (!p) return `<div class="nt-portrait nt-portrait-fallback ${extraClass}">?</div>`;
    return `<div class="nt-portrait ${extraClass}" style="${p.style}" title="${esc(p.label)}"></div>`;
  }

  function showToast(text) {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: max(14px, env(safe-area-inset-right, 0px));
        bottom: calc(74px + env(safe-area-inset-bottom, 0px));
        width: min(520px, calc(100vw - 28px));
        max-height: min(720px, calc(100dvh - 110px));
        display: none;
        flex-direction: column;
        overflow: hidden;
        z-index: 100460;
        background: #07111f;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 12px;
        color: #e2e8f0;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        box-shadow: 0 18px 44px rgba(0, 0, 0, 0.58);
      }
      #${PANEL_ID}.open { display: flex !important; flex-direction: column; }
      #${PANEL_ID} .nt-head {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 14px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.18);
        background: rgba(15, 23, 42, 0.9);
      }
      #${PANEL_ID} .nt-title h2 { margin: 0; font-size: 14px; }
      #${PANEL_ID} .nt-title p { margin: 4px 0 0; color: #94a3b8; font-size: 10px; line-height: 1.3; }
      #${PANEL_ID} .nt-close {
        width: 44px; height: 44px; border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(30, 41, 59, 0.82); color: #e2e8f0;
        font: 700 20px/1 system-ui, sans-serif; cursor: pointer;
        touch-action: manipulation;
        flex-shrink: 0;
      }
      #${PANEL_ID} .nt-body {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 12px;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      #${PANEL_ID} .nt-body::-webkit-scrollbar {
        display: none;
      }
      #${PANEL_ID} .nt-section {
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 8px;
        background: rgba(15, 23, 42, 0.58);
        padding: 10px;
        margin-bottom: 10px;
      }
      #${PANEL_ID} .nt-row {
        display: grid;
        grid-template-columns: 92px minmax(0, 1fr);
        gap: 8px;
        align-items: start;
        margin-bottom: 8px;
      }
      #${PANEL_ID} label { color: #94a3b8; font-size: 10px; line-height: 1.3; padding-top: 7px; }
      #${PANEL_ID} input, #${PANEL_ID} textarea, #${PANEL_ID} select {
        width: 100%; box-sizing: border-box; border-radius: 7px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        background: #0f172a; color: #e2e8f0;
        padding: 8px 10px; font: inherit; font-size: 11px; outline: none;
      }
      #${PANEL_ID} textarea { min-height: 64px; resize: vertical; line-height: 1.35; }
      #${PANEL_ID} .nt-slider-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #${PANEL_ID} .nt-slider-wrap input[type="range"] {
        flex: 1;
        padding: 0;
        height: 28px;
        accent-color: #4ade80;
      }
      #${PANEL_ID} .nt-slider-val {
        min-width: 28px;
        text-align: right;
        color: #94a3b8;
        font-size: 10px;
      }
      #${PANEL_ID} .nt-hint {
        font-size: 9px;
        color: #64748b;
        line-height: 1.35;
        margin: -4px 0 8px 100px;
      }
      #${PANEL_ID} input:focus, #${PANEL_ID} textarea:focus, #${PANEL_ID} select:focus { border-color: #4ade80; }
      #${PANEL_ID} .nt-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 8px; }
      #${PANEL_ID} button.nt-btn {
        min-height: 44px; border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        background: rgba(30, 41, 59, 0.88); color: #cbd5e1;
        padding: 10px 12px; font: inherit; font-size: 11px; font-weight: 700; cursor: pointer;
        touch-action: manipulation;
        -webkit-tap-highlight-color: rgba(96, 165, 250, 0.2);
      }
      #${PANEL_ID} button.nt-btn:active { transform: scale(0.98); }
      #${PANEL_ID} button.nt-primary { background: #22c55e; color: #052e16; border-color: transparent; }
      #${PANEL_ID} button.nt-danger { color: #fecaca; border-color: rgba(248, 113, 113, 0.45); background: rgba(127, 29, 29, 0.35); }
      #${PANEL_ID} .nt-empty { color: #94a3b8; font-size: 11px; line-height: 1.4; }
      #${PANEL_ID} .nt-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 10px;
      }
      #${PANEL_ID} .nt-idcard {
        border: 1px solid rgba(96, 165, 250, 0.35);
        border-radius: 10px;
        background: linear-gradient(165deg, rgba(30, 58, 138, 0.35), rgba(2, 6, 23, 0.85));
        padding: 10px;
        cursor: pointer;
        text-align: left;
        color: inherit;
        font: inherit;
        width: 100%;
        min-height: 44px;
        touch-action: manipulation;
        -webkit-tap-highlight-color: rgba(96, 165, 250, 0.15);
      }
      #${PANEL_ID} .nt-idcard:hover { border-color: #60a5fa; }
      #${PANEL_ID} .nt-idcard:active { border-color: #93c5fd; transform: scale(0.99); }
      #${PANEL_ID} .nt-idcard-hint {
        font-size: 9px;
        color: #64748b;
        margin-top: 6px;
        letter-spacing: 0.02em;
      }
      #${PANEL_ID} .nt-soul-meta {
        font-size: 9px;
        color: #64748b;
        margin: -4px 0 8px;
      }
      #${PANEL_ID} .nt-drift-row {
        font-size: 10px;
        line-height: 1.45;
        padding: 6px 8px;
        margin-bottom: 6px;
        border-radius: 6px;
        background: rgba(99, 102, 241, 0.12);
        border: 1px solid rgba(129, 140, 248, 0.25);
        color: #c7d2fe;
      }
      #${PANEL_ID} .nt-idcard-top {
        display: flex;
        gap: 8px;
        align-items: flex-end;
        margin-bottom: 6px;
      }
      #${PANEL_ID} .nt-portrait {
        image-rendering: pixelated;
        flex: 0 0 auto;
        border-radius: 4px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background-color: rgba(15, 23, 42, 0.6);
        background-repeat: no-repeat;
      }
      #${PANEL_ID} .nt-portrait-fallback {
        width: 64px; height: 96px;
        display: flex; align-items: center; justify-content: center;
        color: #64748b; font-size: 18px;
      }
      #${PANEL_ID} .nt-idcard-name { font-weight: 800; font-size: 12px; color: #e0f2fe; }
      #${PANEL_ID} .nt-idcard-role { font-size: 10px; color: #93c5fd; margin-top: 2px; }
      #${PANEL_ID} .nt-idcard-job { font-size: 9px; color: #94a3b8; margin-top: 4px; line-height: 1.3; }
      #${PANEL_ID} .nt-idcard-key { font-size: 9px; color: #64748b; margin-top: 6px; }
      #${PANEL_ID} .nt-detail-card {
        display: flex;
        gap: 12px;
        align-items: flex-end;
        padding: 10px;
        border: 1px solid rgba(96, 165, 250, 0.3);
        border-radius: 10px;
        background: rgba(2, 6, 23, 0.55);
        margin-bottom: 10px;
      }
      #${PANEL_ID} .nt-detail-card .nt-portrait { width: 96px !important; height: 144px !important; }
      #${PANEL_ID} .nt-tabs { display: flex; gap: 6px; margin-bottom: 10px; }
      #${PANEL_ID} .nt-tab {
        flex: 1; padding: 10px 8px; border-radius: 8px; border: 1px solid rgba(148, 163, 184, 0.25);
        background: rgba(15, 23, 42, 0.7); color: #94a3b8; font-size: 11px; cursor: pointer;
        min-height: 44px; touch-action: manipulation;
      }
      #${PANEL_ID} .nt-tab.active { border-color: #4ade80; color: #bbf7d0; background: rgba(22, 101, 52, 0.25); }
      #${PANEL_ID} .nt-soul-block {
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 6px;
        padding: 8px;
        margin-bottom: 8px;
        background: rgba(2, 6, 23, 0.45);
        font-size: 10px;
        line-height: 1.4;
        white-space: pre-wrap;
        max-height: 160px;
        overflow: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      #${PANEL_ID} .nt-soul-block::-webkit-scrollbar {
        display: none;
      }
      #${PANEL_ID} .nt-soul-block h4 { margin: 0 0 6px; font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em; }
      #${PANEL_ID} .nt-pick-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
        gap: 8px;
        margin: 8px 0;
      }
      #${PANEL_ID} .nt-pick-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 8px 6px;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: rgba(15, 23, 42, 0.45);
        cursor: pointer;
        font: inherit;
        font-size: 10px;
        color: #cbd5e1;
        min-height: 44px;
        width: 100%;
        box-sizing: border-box;
        touch-action: manipulation;
        -webkit-tap-highlight-color: rgba(96, 165, 250, 0.2);
        appearance: none;
      }
      #${PANEL_ID} .nt-pick-item.selected { border-color: #4ade80; background: rgba(22, 101, 52, 0.2); }
      #${PANEL_ID} .nt-pick-item:active { transform: scale(0.98); }
      #${PANEL_ID} .nt-evolution {
        font-size: 9px;
        color: #a5b4fc;
        margin-top: 4px;
        line-height: 1.35;
      }
      #${TOAST_ID} {
        position: fixed; z-index: 100700;
        top: calc(12px + env(safe-area-inset-top, 0px));
        left: 50%;
        transform: translateX(-50%) translateY(-8px);
        opacity: 0; pointer-events: none;
        transition: opacity 0.2s, transform 0.2s;
        background: #020617; border: 1px solid #1f2937;
        color: #e2e8f0; padding: 9px 14px; border-radius: 8px;
        font: 11px ui-monospace, monospace;
      }
      #${TOAST_ID}.show { opacity: 1; transform: translateX(-50%) translateY(0); pointer-events: auto; }
      #${PANEL_ID} .nt-status {
        font-size: 11px;
        line-height: 1.4;
        padding: 8px 10px;
        border-radius: 8px;
        margin-bottom: 10px;
      }
      #${PANEL_ID} .nt-status-warn {
        color: #fcd34d;
        background: rgba(120, 53, 15, 0.35);
        border: 1px solid rgba(245, 158, 11, 0.45);
      }
      #${PANEL_ID} .nt-status-info {
        color: #93c5fd;
        background: rgba(30, 58, 138, 0.25);
        border: 1px solid rgba(96, 165, 250, 0.35);
      }
      #${PANEL_ID} .nt-pick-summary {
        font-size: 10px;
        color: #94a3b8;
        margin: 4px 0 8px;
      }

      /* Touch / phone — full inset shell (device-profile) + readable forms */
      html.denizen-touch #${PANEL_ID},
      html.denizen-phone-mode #${PANEL_ID} {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      html.denizen-touch #${PANEL_ID} .nt-row,
      html.denizen-phone-mode #${PANEL_ID} .nt-row {
        grid-template-columns: 1fr;
        gap: 4px;
      }
      html.denizen-touch #${PANEL_ID} label,
      html.denizen-phone-mode #${PANEL_ID} label {
        padding-top: 0;
        font-size: 11px;
      }
      html.denizen-touch #${PANEL_ID} input,
      html.denizen-touch #${PANEL_ID} textarea,
      html.denizen-phone-mode #${PANEL_ID} input,
      html.denizen-phone-mode #${PANEL_ID} textarea {
        font-size: 16px;
        padding: 10px 12px;
      }
      html.denizen-touch #${PANEL_ID} .nt-grid,
      html.denizen-phone-mode #${PANEL_ID} .nt-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      html.denizen-touch.denizen-portrait #${PANEL_ID} .nt-grid,
      html.denizen-phone-mode.denizen-portrait #${PANEL_ID} .nt-grid {
        grid-template-columns: 1fr;
      }
      html.denizen-touch #${PANEL_ID} .nt-detail-card,
      html.denizen-phone-mode #${PANEL_ID} .nt-detail-card {
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      html.denizen-touch #${PANEL_ID} .nt-actions,
      html.denizen-phone-mode #${PANEL_ID} .nt-actions {
        justify-content: stretch;
      }
      html.denizen-touch #${PANEL_ID} .nt-actions .nt-btn,
      html.denizen-phone-mode #${PANEL_ID} .nt-actions .nt-btn {
        flex: 1 1 calc(50% - 4px);
        min-width: 0;
      }
      html.denizen-touch #${PANEL_ID} .nt-pick-grid,
      html.denizen-phone-mode #${PANEL_ID} .nt-pick-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      html.denizen-touch.denizen-portrait #${PANEL_ID} .nt-pick-grid,
      html.denizen-phone-mode.denizen-portrait #${PANEL_ID} .nt-pick-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      html.denizen-touch #${PANEL_ID} .nt-soul-block,
      html.denizen-phone-mode #${PANEL_ID} .nt-soul-block {
        max-height: min(28dvh, 200px);
        font-size: 11px;
      }
      html.denizen-touch #${PANEL_ID} .nt-title h2,
      html.denizen-phone-mode #${PANEL_ID} .nt-title h2 {
        font-size: 15px;
      }
      html.denizen-touch #${PANEL_ID} .nt-title p,
      html.denizen-phone-mode #${PANEL_ID} .nt-title p {
        font-size: 11px;
      }
      html.denizen-phone-mode #${PANEL_ID}.open {
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
      }
    `;
    document.head.appendChild(s);
  }

  function personalityFromMember(m) {
    const p = m?.personality || m?.settings?.personality || {};
    return {
      formality: Number.isFinite(Number(p.formality)) ? Number(p.formality) : 50,
      verbosity: Number.isFinite(Number(p.verbosity)) ? Number(p.verbosity) : 50,
      proactivity: Number.isFinite(Number(p.proactivity)) ? Number(p.proactivity) : 50,
    };
  }

  function extraSkillsText(m) {
    const list = m?.extra_skills || m?.settings?.extra_skills;
    return Array.isArray(list) ? list.join(', ') : '';
  }

  function soulSnippetText(m) {
    return m?.soul_snippet || m?.settings?.soul_snippet || '';
  }

  function sliderRow(label, field, value, readOnly = false) {
    const disabled = readOnly ? ' disabled' : '';
    return `<div class="nt-row"><label>${label}</label><div class="nt-slider-wrap">
      <input type="range" data-field="${field}" min="0" max="100" value="${value}"${disabled} />
      <span class="nt-slider-val" data-for="${field}">${value}</span>
    </div></div>`;
  }

  function wireSliders() {
    if (!panelEl) return;
    for (const input of panelEl.querySelectorAll('input[type="range"][data-field]')) {
      input.oninput = () => {
        const span = panelEl.querySelector(`.nt-slider-val[data-for="${input.dataset.field}"]`);
        if (span) span.textContent = input.value;
      };
    }
  }

  function orgMembers() {
    return Array.isArray(orgTeam?.members) ? orgTeam.members : [];
  }

  function orgMemberByKey(key) {
    return orgMembers().find((m) => String(m.npc_key).toLowerCase() === String(key).toLowerCase());
  }

  function mergeOrgDraft(member) {
    const key = member.npc_key;
    const d = orgDraftEdits[key];
    if (!d) return member;
    return { ...member, ...d };
  }

  function togglePick(npcKey) {
    const key = String(npcKey || '').trim().toLowerCase();
    if (!key) return;
    if (pickSelected.has(key)) pickSelected.delete(key);
    else pickSelected.add(key);
    const el = panelEl?.querySelector(`.nt-pick-item[data-npc-key="${key}"]`);
    if (el) {
      el.classList.toggle('selected', pickSelected.has(key));
      el.setAttribute('aria-pressed', pickSelected.has(key) ? 'true' : 'false');
    }
  }

  function runPanelAction(action, target) {
    if (!action) return;
    if (action === 'close') hide();
    else if (action === 'save-template') saveTemplate().catch((e) => showToast(e?.message || 'Save failed'));
    else if (action === 'show-add') { pickSelected.clear(); panelStatus = ''; view = 'add'; render(); }
    else if (action === 'cancel-add') { pickSelected.clear(); panelStatus = ''; view = 'roster'; render(); }
    else if (action === 'toggle-pick') { togglePick(target.dataset.npcKey); render(); }
    else if (action === 'confirm-batch-add') batchAddSelected().catch((e) => showToast(e?.message || 'Add failed'));
    else if (action === 'open-member') openMember(target.dataset.npcKey).catch((e) => showToast(e?.message || 'Open failed'));
    else if (action === 'back-roster') {
      const fields = panelEl.querySelector('[data-field="displayName"]') ? readMemberForm() : null;
      if (selectedKey && fields) draftEdits[selectedKey] = { ...draftEdits[selectedKey], ...fields, job: fields.job };
      view = 'roster';
      selectedKey = null;
      render();
    }
    else if (action === 'save-member') saveSelectedMember().catch((e) => showToast(e?.message || 'Save failed'));
    else if (action === 'remove-member') removeSelectedMember().catch((e) => showToast(e?.message || 'Remove failed'));
    else if (action === 'tab-profile') { detailTab = 'profile'; render(); }
    else if (action === 'tab-soul') {
      detailTab = 'soul';
      if (selectedKey) loadSoul(selectedKey).then((s) => { detailSoul = s; render(); });
      else render();
    }
    else if (action === 'mode-personal') { rosterMode = 'personal'; render(); }
    else if (action === 'mode-org') { rosterMode = 'org'; render(); }
    else if (action === 'open-org-member') openOrgMember(target.dataset.npcKey).catch((e) => showToast(e?.message || 'Open failed'));
    else if (action === 'back-org-roster') {
      const fields = panelEl.querySelector('[data-field="displayName"]') ? readMemberForm() : null;
      if (orgSelectedKey && fields) orgDraftEdits[orgSelectedKey] = { ...orgDraftEdits[orgSelectedKey], ...fields, job: fields.job };
      view = 'roster';
      rosterMode = 'org';
      orgSelectedKey = null;
      render();
    }
    else if (action === 'save-org-member') saveOrgMember().catch((e) => showToast(e?.message || 'Save failed'));
    else if (action === 'remove-org-member') removeOrgMember().catch((e) => showToast(e?.message || 'Remove failed'));
    else if (action === 'save-org-template') saveOrgTemplate().catch((e) => showToast(e?.message || 'Save failed'));
    else if (action === 'add-org-member') {
      const key = target.dataset.npcKey;
      if (!key || !canManageOrg) return;
      api().saveOrgNpcTeamMember({ npcKey: key, role: 'assistant' })
        .then((ot) => { orgTeam = ot; showToast('Org default added'); openOrgMember(key); })
        .catch((e) => showToast(e?.message || 'Add failed'));
    }
  }

  function wirePanelButtons() {
    if (!panelEl) return;
    for (const btn of panelEl.querySelectorAll('[data-action]')) {
      btn.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        runPanelAction(btn.dataset.action, btn);
      };
    }
    wireSliders();
  }

  function ensurePanel() {
    if (panelEl) return panelEl;
    injectStyles();
    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', 'NPC Team');
    panelEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(panelEl);
    return panelEl;
  }

  function blankTeam() {
    const profile = api()?.getProfile?.() || {};
    const name = profile.displayName ? `${profile.displayName}'s NPC team` : 'My NPC team';
    return { name, purpose: '', members: [] };
  }

  function members() {
    return Array.isArray(team?.members) ? team.members : [];
  }

  function memberByKey(key) {
    return members().find((m) => String(m.npc_key).toLowerCase() === String(key).toLowerCase());
  }

  function mergeDraft(member) {
    const key = member.npc_key;
    const d = draftEdits[key];
    if (!d) return member;
    return { ...member, ...d };
  }

  async function loadTeam() {
    if (loading) return;
    loading = true;
    try {
      const bundle = await api()?.getNpcTeam?.();
      team = bundle?.team || blankTeam();
      orgTeam = bundle?.orgTeam || null;
      canManageOrg = !!bundle?.canManageOrg;
    } catch (_) {
      team = blankTeam();
      orgTeam = null;
      canManageOrg = false;
    } finally {
      loading = false;
    }
  }

  async function saveTemplate() {
    const name = panelEl.querySelector('#nt-name')?.value?.trim() || 'My NPC team';
    const purpose = panelEl.querySelector('#nt-purpose')?.value?.trim() || '';
    team = await api().saveNpcTeam({ name, purpose });
    showToast('Team profile saved');
    render();
  }

  async function saveOrgTemplate() {
    const name = panelEl.querySelector('#nt-org-name')?.value?.trim() || 'Org NPC defaults';
    const purpose = panelEl.querySelector('#nt-org-purpose')?.value?.trim() || '';
    orgTeam = await api().saveOrgNpcTeam({ name, purpose });
    showToast('Org defaults saved');
    render();
  }

  async function saveOrgMember() {
    if (!orgSelectedKey || !canManageOrg) return;
    const fields = readMemberForm();
    orgTeam = await api().saveOrgNpcTeamMember({
      npcKey: orgSelectedKey,
      displayName: fields.displayName || orgSelectedKey,
      role: fields.role || 'assistant',
      job: fields.job || '',
      focus: fields.focus || '',
      instructions: fields.instructions || '',
      soulSnippet: fields.soulSnippet || '',
      extraSkills: fields.extraSkills || '',
      personality: fields.personality,
    });
    delete orgDraftEdits[orgSelectedKey];
    showToast('Org default saved');
    render();
  }

  async function removeOrgMember() {
    if (!orgSelectedKey || !canManageOrg) return;
    orgTeam = await api().saveOrgNpcTeamMember({ npcKey: orgSelectedKey, remove: true });
    delete orgDraftEdits[orgSelectedKey];
    orgSelectedKey = null;
    view = 'roster';
    rosterMode = 'org';
    showToast('Org default removed');
    render();
  }

  function readMemberForm() {
    const personality = {
      formality: Number(panelEl.querySelector('[data-field="formality"]')?.value ?? 50),
      verbosity: Number(panelEl.querySelector('[data-field="verbosity"]')?.value ?? 50),
      proactivity: Number(panelEl.querySelector('[data-field="proactivity"]')?.value ?? 50),
    };
    return {
      displayName: panelEl.querySelector('[data-field="displayName"]')?.value?.trim(),
      role: panelEl.querySelector('[data-field="role"]')?.value?.trim(),
      job: panelEl.querySelector('[data-field="job"]')?.value?.trim(),
      focus: panelEl.querySelector('[data-field="focus"]')?.value?.trim(),
      instructions: panelEl.querySelector('[data-field="instructions"]')?.value?.trim(),
      soulSnippet: panelEl.querySelector('[data-field="soulSnippet"]')?.value?.trim(),
      extraSkills: panelEl.querySelector('[data-field="extraSkills"]')?.value?.trim(),
      personality,
    };
  }

  async function saveSelectedMember() {
    if (!selectedKey) return;
    const fields = readMemberForm();
    team = await api().saveNpcTeamMember({
      npcKey: selectedKey,
      displayName: fields.displayName || selectedKey,
      role: fields.role || 'assistant',
      job: fields.job || '',
      focus: fields.focus || '',
      instructions: fields.instructions || '',
      soulSnippet: fields.soulSnippet || '',
      extraSkills: fields.extraSkills || '',
      personality: fields.personality,
    });
    delete draftEdits[selectedKey];
    delete soulCache[selectedKey];
    showToast('NPC ID saved');
    render();
  }

  async function removeSelectedMember() {
    if (!selectedKey) return;
    team = await api().saveNpcTeamMember({ npcKey: selectedKey, remove: true });
    delete draftEdits[selectedKey];
    delete soulCache[selectedKey];
    selectedKey = null;
    view = 'roster';
    showToast('NPC removed');
    render();
  }

  async function batchAddSelected() {
    if (batchAdding) return;
    const checked = pickSelected.size
      ? [...pickSelected]
      : [...panelEl.querySelectorAll('.nt-pick-item.selected')].map((el) => el.dataset.npcKey);
    if (!checked.length) {
      panelStatus = 'Select at least one NPC below (they turn green when selected).';
      showToast('Pick at least one NPC');
      render();
      return;
    }
    if (!api()) {
      panelStatus = 'Session not ready — refresh the page and try again.';
      showToast(panelStatus);
      render();
      return;
    }
    if (!hasIdentity()) {
      panelStatus = 'Sign in via Profile before adding NPCs to your team.';
      showToast(panelStatus);
      render();
      return;
    }
    batchAdding = true;
    panelStatus = `Adding ${checked.length} NPC${checked.length > 1 ? 's' : ''}…`;
    render();
    try {
      const result = await api().addNpcTeamMembers(checked, { role: 'assistant' });
      const added = Array.isArray(result.added) ? result.added : [];
      const errors = Array.isArray(result.errors) ? result.errors : [];
      if (!added.length) {
        const msg = errors[0]?.error
          || result.error
          || 'Could not add NPCs — sign in via Profile first';
        panelStatus = msg;
        showToast(msg);
        if (errors.length) console.warn('[NPC Team] batch add errors', errors);
      } else {
        pickSelected.clear();
        panelStatus = '';
        team = result.team || team;
        await loadTeam();
        if (added.length === 1) {
          showToast('NPC added — set their role and job');
          view = 'roster';
          await openMember(added[0]);
        } else {
          view = 'roster';
          showToast(`Added ${added.length} NPCs — click an ID card to edit`);
          if (errors.length) console.warn('[NPC Team] batch add partial errors', errors);
        }
      }
    } catch (err) {
      panelStatus = err?.message || 'Add failed';
      showToast(panelStatus);
    } finally {
      batchAdding = false;
      render();
    }
  }

  async function loadSoul(npcKey) {
    if (soulCache[npcKey]) return soulCache[npcKey];
    try {
      soulCache[npcKey] = await api().getNpcTeamMemberSoul(npcKey);
    } catch (err) {
      const member = memberByKey(npcKey);
      const settings = member?.settings || {};
      soulCache[npcKey] = {
        offline: true,
        fetch_error: err?.message || 'Failed to load soul',
        user_baseline: settings.user_baseline || {
          display_name: member?.display_name,
          role: member?.role,
          job: member?.job || settings.job,
          focus: member?.focus,
          instructions: member?.instructions,
        },
        evolution_log: settings.evolution_log || [],
        soul: {
          excerpt: 'Live SOUL.md unavailable — restart the Denizen server so it can read npcs/' + npcKey + '/SOUL.md.',
        },
        memory: {
          excerpt: 'Live MEMORY.md unavailable until the server is updated.',
        },
        drift: [],
      };
    }
    return soulCache[npcKey];
  }

  function rosterHtml(data) {
    const list = members();
    const used = new Set(list.map((m) => String(m.npc_key).toLowerCase()));
    const available = npcOptions().filter((o) => !used.has(String(o.key).toLowerCase()));

    const cards = list.length
      ? `<div class="nt-grid">${list.map((m) => {
        const mm = mergeDraft(m);
        const job = mm.job || mm.settings?.job || '';
        return `<button type="button" class="nt-idcard" data-action="open-member" data-npc-key="${esc(m.npc_key)}" aria-label="Open ${esc(mm.display_name || m.npc_key)} ID card">
          <div class="nt-idcard-top">
            ${portraitHtml(m.npc_key, 2)}
            <div>
              <div class="nt-idcard-name">${esc(mm.display_name || m.npc_key)}</div>
              <div class="nt-idcard-role">${esc(mm.role || 'assistant')}</div>
            </div>
          </div>
          ${job ? `<div class="nt-idcard-job">${esc(job.slice(0, 80))}</div>` : ''}
          <div class="nt-idcard-key">${esc(m.npc_key)}</div>
          <div class="nt-idcard-hint">Tap to edit · Soul & memory</div>
        </button>`;
      }).join('')}</div>`
      : '<div class="nt-empty">No NPCs on this team yet. Tap <b>Add NPCs</b> to build your mini-company.</div>';

    const pickCount = pickSelected.size;
    const pickGrid = available.length
      ? `<div class="nt-pick-summary">${pickCount ? `${pickCount} selected` : 'Click NPCs to select them (green border)'}</div>
        <div class="nt-pick-grid">${available.map((o) => {
        const key = String(o.key).toLowerCase();
        const on = pickSelected.has(key);
        return `<button type="button" id="nt-pick-${esc(key)}" class="nt-pick-item${on ? ' selected' : ''}" data-action="toggle-pick" data-npc-key="${esc(key)}" aria-pressed="${on ? 'true' : 'false'}">
            ${portraitHtml(o.key, 1.5)}
            <span>${esc(o.label)}</span>
          </button>`;
      }).join('')}</div>
        <div class="nt-actions">
          <button type="button" class="nt-btn" data-action="cancel-add"${batchAdding ? ' disabled' : ''}>Cancel</button>
          <button type="button" id="nt-confirm-batch-add" class="nt-btn nt-primary" data-action="confirm-batch-add"${batchAdding || !pickCount ? ' disabled' : ''}>${batchAdding ? 'Adding…' : `Add selected${pickCount ? ` (${pickCount})` : ''}`}</button>
        </div>`
      : '<div class="nt-empty">Every available NPC is already on your team.</div>';

    const addSection = view === 'add'
      ? `<div class="nt-section">
          <h3 style="margin:0 0 8px;font-size:11px;color:#93c5fd">Select NPCs to add</h3>
          ${identityBannerHtml()}
          ${panelStatus ? `<div class="nt-status nt-status-info">${esc(panelStatus)}</div>` : ''}
          ${pickGrid}
        </div>`
      : `<div class="nt-section">
          <div class="nt-actions" style="justify-content:flex-start">
            <button type="button" class="nt-btn nt-primary" data-action="show-add"${available.length ? '' : ' disabled'}>+ Add NPCs</button>
          </div>
        </div>`;

    return `
      ${identityBannerHtml()}
      ${orgTeam ? `<div class="nt-tabs">
        <button type="button" class="nt-tab${rosterMode === 'personal' ? ' active' : ''}" data-action="mode-personal">My team</button>
        <button type="button" class="nt-tab${rosterMode === 'org' ? ' active' : ''}" data-action="mode-org">Org defaults</button>
      </div>` : ''}
      ${rosterMode === 'org' && orgTeam ? orgRosterHtml() : `
      <div class="nt-section">
        <div class="nt-row"><label>Company</label><input id="nt-name" maxlength="160" value="${esc(data.name || 'My NPC team')}" /></div>
        <div class="nt-row"><label>Purpose</label><textarea id="nt-purpose" maxlength="1000" placeholder="What should this NPC company accomplish?">${esc(data.purpose || '')}</textarea></div>
        <div class="nt-actions"><button type="button" class="nt-btn nt-primary" data-action="save-template">Save company</button></div>
      </div>
      ${addSection}
      <div class="nt-section">
        <div style="font-size:10px;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em">Team ID cards</div>
        ${cards}
      </div>`}`;
  }

  function fmtWhen(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch (_) {
      return String(iso).slice(0, 16);
    }
  }

  function soulProgressHtml(soul) {
    if (!soul) return '<div class="nt-empty">Loading SOUL.md and MEMORY.md…</div>';
    const baseline = soul?.user_baseline || {};
    const evolution = soul?.evolution_log || [];
    const userEdits = evolution.filter((e) => !e.source || e.source === 'user_edit');
    const npcChanges = evolution.filter((e) => e.source && e.source !== 'user_edit');
    const drift = soul?.drift || [];
    const soulExcerpt = soul?.soul?.excerpt || soul?.soul?.identity || '';
    const memoryExcerpt = soul?.memory?.excerpt || '';
    const soulUpdated = fmtWhen(soul?.soul?.file_mtime);
    const memoryUpdated = fmtWhen(soul?.memory?.file_mtime);
    const memoryLines = soul?.memory?.line_count || 0;

    if (soul?.error && !soul?.offline) {
      return `<div class="nt-empty">${esc(soul.error)}</div>`;
    }

    const baselineText = [
      baseline.display_name && `Name: ${baseline.display_name}`,
      baseline.role && `Role: ${baseline.role}`,
      baseline.job && `Job: ${baseline.job}`,
      baseline.focus && `Focus: ${baseline.focus}`,
      baseline.instructions && `Instructions:\n${baseline.instructions}`,
      baseline.soul_snippet && `SOUL snippet:\n${baseline.soul_snippet}`,
      baseline.personality && `Personality: formality ${baseline.personality.formality}, verbosity ${baseline.personality.verbosity}, proactivity ${baseline.personality.proactivity}`,
      baseline.extra_skills?.length && `Extra skills: ${baseline.extra_skills.join(', ')}`,
    ].filter(Boolean).join('\n') || '(not saved yet — fill the ID card tab and tap Save)';

    const effectiveBlock = soul?.effective_overlay
      ? `<div class="nt-soul-block"><h4>Effective prompt overlay (org + you)</h4>${esc(String(soul.effective_overlay).slice(0, 1800))}</div>`
      : '';

    const driftHtml = drift.length
      ? drift.map((d) => `<div class="nt-drift-row"><b>${esc(d.kind)}</b> — you set “${esc(d.user)}” · SOUL.md has “${esc(d.soul)}”</div>`).join('')
      : '';

    const userEditHtml = userEdits.length
      ? esc(userEdits.slice(-10).map((e) => {
        const when = e.at ? e.at.slice(0, 10) : '?';
        const from = e.from ? ` (was: ${String(e.from).slice(0, 40)})` : '';
        return `${when}: ${e.field} → ${(e.to || '').slice(0, 80)}${from}`;
      }).join('\n'))
      : '(no profile edits yet)';

    const npcChangeHtml = npcChanges.length
      ? esc(npcChanges.slice(-8).map((e) => {
        const when = e.at ? e.at.slice(0, 10) : '?';
        return `${when}: ${e.field || e.kind || 'change'} → ${(e.to || e.summary || '').slice(0, 80)}`;
      }).join('\n'))
      : '(NPC has not diverged from your baseline yet — drift appears as SOUL.md evolves from jobs)';

    const historyBlock = soul?.soul_history_excerpt
      ? `<div class="nt-soul-block"><h4>SOUL change log</h4>${esc(soul.soul_history_excerpt.slice(0, 1200))}</div>`
      : '';

    return `
      ${soul?.offline ? `<div class="nt-empty" style="margin-bottom:8px">⚠ ${esc(soul.fetch_error || 'Live SOUL/MEMORY could not be loaded')} — showing your saved ID card below. Restart <code>apps/office/server.js</code> if this persists.</div>` : ''}
      ${effectiveBlock}
      <div class="nt-soul-block"><h4>What you originally set</h4>${esc(baselineText)}</div>
      ${driftHtml}
      <div class="nt-soul-block">
        <h4>Live SOUL.md</h4>
        ${soulUpdated ? `<div class="nt-soul-meta">Last updated ${esc(soulUpdated)}</div>` : ''}
        ${esc(soulExcerpt.slice(0, 1800) || '(empty — grows as this NPC works)')}
      </div>
      <div class="nt-soul-block">
        <h4>Live MEMORY.md</h4>
        ${memoryUpdated ? `<div class="nt-soul-meta">${memoryLines} recent lines · updated ${esc(memoryUpdated)}</div>` : ''}
        ${esc(memoryExcerpt || '(no memories yet — recurring tasks and jobs append here)')}
      </div>
      ${historyBlock}
      <div class="nt-soul-block"><h4>Your profile edits</h4>${userEditHtml}</div>
      <div class="nt-soul-block"><h4>NPC evolution (from work)</h4>${npcChangeHtml}</div>
      <div class="nt-empty" style="margin-top:6px">MEMORY.md captures task patterns so repeat work needs less hand-holding. Compare “what you set” vs live SOUL/MEMORY to see growth.</div>`;
  }

  function memberProfileFields(m, { readOnly = false } = {}) {
    const p = personalityFromMember(m);
    const disabled = readOnly ? ' disabled' : '';
    return `
      <div class="nt-row"><label>Name</label><input data-field="displayName" maxlength="80" value="${esc(m.display_name || m.npc_key)}"${disabled} /></div>
      <div class="nt-row"><label>Role</label><input data-field="role" maxlength="80" value="${esc(m.role || 'assistant')}" placeholder="Researcher, scheduler..."${disabled} /></div>
      <div class="nt-row"><label>Job</label><input data-field="job" maxlength="500" value="${esc(m.job || m.settings?.job || '')}" placeholder="Current assignment"${disabled} /></div>
      <div class="nt-row"><label>Focus</label><textarea data-field="focus" maxlength="500" placeholder="Ongoing priority"${disabled}>${esc(m.focus || '')}</textarea></div>
      <div class="nt-row"><label>Instructions</label><textarea data-field="instructions" maxlength="1200" placeholder="Tone, process, handoffs"${disabled}>${esc(m.instructions || '')}</textarea></div>
      <div style="font-size:10px;color:#64748b;margin:8px 0 4px;text-transform:uppercase;letter-spacing:0.05em">Personality sliders</div>
      ${sliderRow('Formality', 'formality', p.formality, readOnly)}
      <div class="nt-hint">Low = casual · High = formal</div>
      ${sliderRow('Verbosity', 'verbosity', p.verbosity, readOnly)}
      <div class="nt-hint">Low = ultra-brief · High = thorough</div>
      ${sliderRow('Proactivity', 'proactivity', p.proactivity, readOnly)}
      <div class="nt-hint">Low = answer only · High = suggest next steps</div>
      <div class="nt-row"><label>SOUL snippet</label><textarea data-field="soulSnippet" maxlength="2500" placeholder="Custom overlay on base SOUL.md for this teammate"${disabled}>${esc(soulSnippetText(m))}</textarea></div>
      <div class="nt-hint">Merged with org defaults; yours wins when set.</div>
      <div class="nt-row"><label>Extra skills</label><input data-field="extraSkills" maxlength="240" value="${esc(extraSkillsText(m))}" placeholder="crm-summary, research (comma-separated)"${disabled} /></div>
      <div class="nt-hint">Approved skills beyond the NPC's default allowlist.</div>`;
  }

  function detailHtml(member, soul, tab) {
    const m = mergeDraft(member);
    const profileTab = `
      <div class="nt-detail-card">
        ${portraitHtml(m.npc_key, 3)}
        <div>
          <div class="nt-idcard-name">${esc(m.display_name || m.npc_key)}</div>
          <div class="nt-idcard-role">${esc(m.role || 'assistant')}</div>
          <div class="nt-idcard-key">${esc(m.npc_key)}</div>
        </div>
      </div>
      ${memberProfileFields(m)}
      <div class="nt-actions">
        <button type="button" class="nt-btn nt-danger" data-action="remove-member">Remove</button>
        <button type="button" class="nt-btn nt-primary" data-action="save-member">Save ID card</button>
      </div>`;

    const soulTab = soulProgressHtml(soul);

    return `
      <div class="nt-actions" style="justify-content:flex-start;margin-bottom:8px">
        <button type="button" class="nt-btn" data-action="back-roster">← Team</button>
      </div>
      <div class="nt-tabs">
        <button type="button" class="nt-tab${tab === 'profile' ? ' active' : ''}" data-action="tab-profile">ID card</button>
        <button type="button" class="nt-tab${tab === 'soul' ? ' active' : ''}" data-action="tab-soul">Soul & memory</button>
      </div>
      <div class="nt-section">${tab === 'soul' ? soulTab : profileTab}</div>`;
  }

  function orgDetailHtml(member, tab) {
    const m = mergeOrgDraft(member);
    const readOnly = !canManageOrg;
    const profileTab = `
      <div class="nt-detail-card">
        ${portraitHtml(m.npc_key, 3)}
        <div>
          <div class="nt-idcard-name">${esc(m.display_name || m.npc_key)}</div>
          <div class="nt-idcard-role">${esc(m.role || 'assistant')} · org default</div>
          <div class="nt-idcard-key">${esc(m.npc_key)}</div>
        </div>
      </div>
      ${readOnly ? '<div class="nt-status nt-status-info">Read-only — org owner/admin can edit these defaults.</div>' : ''}
      ${memberProfileFields(m, { readOnly })}
      ${canManageOrg ? `<div class="nt-actions">
        <button type="button" class="nt-btn nt-danger" data-action="remove-org-member">Remove</button>
        <button type="button" class="nt-btn nt-primary" data-action="save-org-member">Save org default</button>
      </div>` : ''}`;

    return `
      <div class="nt-actions" style="justify-content:flex-start;margin-bottom:8px">
        <button type="button" class="nt-btn" data-action="back-org-roster">← Org defaults</button>
      </div>
      <div class="nt-section">${profileTab}</div>`;
  }

  function orgRosterHtml() {
    const data = orgTeam || { name: 'Org NPC defaults', purpose: '', members: [] };
    const list = orgMembers();
    const used = new Set(list.map((m) => String(m.npc_key).toLowerCase()));
    const available = npcOptions().filter((o) => !used.has(String(o.key).toLowerCase()));

    const cards = list.length
      ? `<div class="nt-grid">${list.map((m) => {
        const mm = mergeOrgDraft(m);
        const job = mm.job || mm.settings?.job || '';
        return `<button type="button" class="nt-idcard" data-action="open-org-member" data-npc-key="${esc(m.npc_key)}">
          <div class="nt-idcard-top">${portraitHtml(m.npc_key, 2)}<div>
            <div class="nt-idcard-name">${esc(mm.display_name || m.npc_key)}</div>
            <div class="nt-idcard-role">${esc(mm.role || 'assistant')}</div>
          </div></div>
          ${job ? `<div class="nt-idcard-job">${esc(job.slice(0, 80))}</div>` : ''}
          <div class="nt-idcard-key">${esc(m.npc_key)}</div>
        </button>`;
      }).join('')}</div>`
      : '<div class="nt-empty">No org-wide NPC defaults yet. Team admins can add defaults every teammate inherits.</div>';

    const addGrid = canManageOrg && available.length
      ? `<div style="margin-top:10px;font-size:10px;color:#64748b">Add org default:</div>
        <div class="nt-pick-grid">${available.slice(0, 12).map((o) =>
          `<button type="button" class="nt-pick-item" data-action="add-org-member" data-npc-key="${esc(o.key)}">
            ${portraitHtml(o.key, 1.5)}<span>${esc(o.label)}</span>
          </button>`).join('')}</div>`
      : '';

    return `
      <div class="nt-section">
        <div class="nt-row"><label>Org</label><input id="nt-org-name" maxlength="160" value="${esc(data.name || 'Org NPC defaults')}"${canManageOrg ? '' : ' disabled'} /></div>
        <div class="nt-row"><label>Mission</label><textarea id="nt-org-purpose" maxlength="1000"${canManageOrg ? '' : ' disabled'}>${esc(data.purpose || '')}</textarea></div>
        ${canManageOrg ? '<div class="nt-actions"><button type="button" class="nt-btn nt-primary" data-action="save-org-template">Save org profile</button></div>' : ''}
      </div>
      <div class="nt-section">${cards}${addGrid}</div>`;
  }

  let detailTab = 'profile';
  let detailSoul = null;

  function render() {
    ensurePanel();
    const data = team || blankTeam();

    if (view === 'org-detail' && orgSelectedKey) {
      const member = orgMemberByKey(orgSelectedKey);
      if (!member) {
        view = 'roster';
        rosterMode = 'org';
        orgSelectedKey = null;
      } else {
        panelEl.innerHTML = `
          <div class="nt-head">
            <div class="nt-title"><h2>Org NPC default</h2><p>Shared defaults for your organization — teammates inherit unless they override.</p></div>
            <button type="button" class="nt-close" data-action="close">×</button>
          </div>
          <div class="nt-body">${orgDetailHtml(member, detailTab)}</div>`;
        wirePanelButtons();
        return;
      }
    }

    if (view === 'detail' && selectedKey) {
      const member = memberByKey(selectedKey);
      if (!member) {
        view = 'roster';
        selectedKey = null;
      } else {
        panelEl.innerHTML = `
          <div class="nt-head">
            <div class="nt-title"><h2>NPC ID</h2><p>Edit profile, job, and watch soul growth.</p></div>
            <button type="button" class="nt-close" data-action="close">×</button>
          </div>
          <div class="nt-body">${detailHtml(member, detailSoul, detailTab)}</div>`;
        wirePanelButtons();
        return;
      }
    }

    panelEl.innerHTML = `
      <div class="nt-head">
        <div class="nt-title">
          <h2>NPC Team</h2>
          <p>Your personal mini-company — tap an ID card to edit role, job, and instructions.</p>
        </div>
        <button type="button" class="nt-close" data-action="close">×</button>
      </div>
      <div class="nt-body">${rosterHtml(data)}</div>`;
    wirePanelButtons();
  }

  async function openOrgMember(npcKey) {
    orgSelectedKey = npcKey;
    view = 'org-detail';
    detailTab = 'profile';
    render();
  }

  async function openMember(npcKey) {
    if (selectedKey && selectedKey !== npcKey) {
      const fields = panelEl.querySelector('[data-field="displayName"]') ? readMemberForm() : null;
      if (fields) draftEdits[selectedKey] = { ...draftEdits[selectedKey], ...fields, job: fields.job };
    }
    selectedKey = npcKey;
    view = 'detail';
    detailTab = 'profile';
    detailSoul = null;
    render();
    detailSoul = await loadSoul(npcKey);
    if (selectedKey === npcKey && view === 'detail') render();
  }

  function setPanelOpen(open) {
    document.documentElement.classList.toggle('denizen-npc-team-open', !!open);
    if (panelEl) {
      panelEl.classList.toggle('open', !!open);
      if (open) {
        globalThis.DenizenMobileSidebar?.close?.();
        globalThis.DenizenDeviceProfile?.resetPhonePanelLayout?.(panelEl);
      }
    }
  }

  async function show() {
    ensurePanel();
    setPanelOpen(true);
    if (!team) {
      panelEl.innerHTML = '<div class="nt-head"><div class="nt-title"><h2>NPC Team</h2><p>Loading…</p></div><button type="button" class="nt-close" data-action="close" aria-label="Close">×</button></div>';
      await loadTeam();
    }
    view = 'roster';
    selectedKey = null;
    render();
  }

  function hide() {
    setPanelOpen(false);
  }

  document.addEventListener('denizen-visitor-profile-switching', () => {
    team = null;
    orgTeam = null;
    soulCache = {};
    draftEdits = {};
    orgDraftEdits = {};
    setPanelOpen(false);
  });
  document.addEventListener('denizen-visitor-profile-updated', () => {
    team = null;
    orgTeam = null;
    soulCache = {};
  });

  globalThis.DenizenVisitorNpcTeamUI = {
    show,
    hide,
    render,
    refresh: async () => {
      team = null;
      orgTeam = null;
      soulCache = {};
      await loadTeam();
      if (panelEl?.classList.contains('open')) render();
      return team;
    },
  };

  setTimeout(() => ensurePanel(), 0);
})();
