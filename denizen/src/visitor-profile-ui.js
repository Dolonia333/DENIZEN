/**
 * Denizen user profile UI — tabbed editor for identity, AI memory, and security.
 * Used by DenizenAccountPanel (globalThis.DenizenProfileUI).
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-profile-ui-style';
  const REQUEST_TIMEOUT_MS = 12000;

  const TABS = [
    { id: 'overview', label: 'Overview', icon: '◈' },
    { id: 'identity', label: 'Identity', icon: '◉' },
    { id: 'memory', label: 'AI memory', icon: '◎' },
    { id: 'connect', label: 'Connect', icon: '⚡' },
  ];

  let activeTab = 'overview';
  let deepProfile = null;
  let settingsCache = null;
  let positionCache = null;
  let positionDraft = null;
  let positionSuggestions = [];
  let statusTimer = null;

  function getSessionApi() {
    return globalThis.DenizenVisitorSession || null;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  function initials(name) {
    const parts = String(name || 'Guest').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'G';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  function tierAccent(tier) {
    const t = String(tier || '').toLowerCase();
    if (t === 'ceo') return 'linear-gradient(135deg, #fbbf24, #f59e0b)';
    if (t === 'team') return 'linear-gradient(135deg, #4ade80, #22c55e)';
    if (t === 'demo') return 'linear-gradient(135deg, #38bdf8, #0ea5e9)';
    return 'linear-gradient(135deg, #94a3b8, #64748b)';
  }

  async function fetchWithTimeout(url, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new Error('Request timed out — server may be slow or offline.');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      .prof-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 10px;
      }
      .prof-avatar {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 15px;
        font-weight: 800;
        color: #0f172a;
        flex-shrink: 0;
        box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.9), 0 0 0 3px rgba(148, 163, 184, 0.35);
      }
      .prof-header-text { min-width: 0; flex: 1; }
      .prof-header-name {
        font-size: 14px;
        font-weight: 700;
        color: #f1f5f9;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .prof-header-meta {
        font-size: 10px;
        color: #94a3b8;
        margin-top: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .prof-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin: 8px 0 10px;
      }
      .prof-tab {
        background: rgba(15, 23, 42, 0.7);
        border: 1px solid #334155;
        border-radius: 999px;
        color: #94a3b8;
        font: inherit;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        padding: 5px 10px;
        cursor: pointer;
        touch-action: manipulation;
      }
      .prof-tab:hover { border-color: #64748b; color: #e2e8f0; }
      .prof-tab.active {
        border-color: #4ade80;
        color: #bbf7d0;
        background: rgba(34, 197, 94, 0.12);
      }
      .prof-panel { display: none; flex-direction: column; gap: 8px; }
      .prof-panel.active { display: flex; }
      .prof-section-title {
        font-size: 10px;
        font-weight: 700;
        color: #94a3b8;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .prof-hint {
        font-size: 9px;
        color: #64748b;
        line-height: 1.4;
      }
      .prof-field label {
        display: block;
        font-size: 9px;
        color: #94a3b8;
        margin-bottom: 3px;
      }
      .prof-field input,
      .prof-field textarea {
        width: 100%;
        box-sizing: border-box;
        background: rgba(15, 23, 42, 0.9);
        border: 1px solid #334155;
        border-radius: 6px;
        color: #e2e8f0;
        font: inherit;
        font-size: 10px;
        padding: 6px 8px;
      }
      .prof-field textarea { min-height: 56px; resize: vertical; }
      .prof-position-card {
        margin-top: 6px;
        padding: 8px;
        border-radius: 8px;
        border: 1px solid #334155;
        background: rgba(15, 23, 42, 0.55);
      }
      .prof-position-summary {
        font-size: 10px;
        color: #cbd5e1;
        line-height: 1.45;
        margin: 6px 0;
      }
      .prof-position-list {
        margin: 4px 0 0;
        padding-left: 16px;
        font-size: 9px;
        color: #94a3b8;
        line-height: 1.4;
      }
      .prof-position-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }
      .prof-chip-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
      }
      .prof-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border-radius: 999px;
        border: 1px solid #334155;
        background: rgba(30, 41, 59, 0.8);
        color: #cbd5e1;
        font-size: 9px;
        padding: 3px 8px;
      }
      .prof-chip button {
        background: transparent;
        border: 0;
        color: #f87171;
        cursor: pointer;
        font-size: 11px;
        line-height: 1;
        padding: 0;
      }
      .prof-row {
        display: flex;
        gap: 6px;
        align-items: flex-end;
      }
      .prof-row .prof-field { flex: 1; }
      .prof-btn {
        align-self: flex-start;
        background: rgba(74, 222, 128, 0.12);
        border: 1px solid #4ade80;
        border-radius: 6px;
        color: #4ade80;
        font: inherit;
        font-size: 10px;
        font-weight: 700;
        padding: 6px 10px;
        cursor: pointer;
        touch-action: manipulation;
      }
      .prof-btn.secondary {
        background: transparent;
        border-color: #475569;
        color: #cbd5e1;
      }
      .prof-status {
        font-size: 9px;
        color: #4ade80;
        min-height: 12px;
      }
      .prof-status.err { color: #fca5a5; }
      .prof-empty {
        font-size: 9px;
        color: #64748b;
        font-style: italic;
        padding: 6px 0;
      }
      html.denizen-phone #denizen-mobile-drawer-body .prof-tab {
        font-size: 10px;
        padding: 6px 12px;
      }
      html.denizen-phone #denizen-mobile-drawer-body .prof-header-name {
        font-size: 16px;
      }
      html.denizen-phone #denizen-mobile-drawer-body #denizen-account-panel .prof-tabs,
      html.denizen-phone #denizen-mobile-drawer-body #denizen-account-panel .prof-panel,
      html.denizen-phone #denizen-mobile-drawer-body #denizen-account-panel .prof-header {
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }
      html.denizen-phone #denizen-mobile-drawer-body #denizen-account-panel .prof-tabs {
        flex-wrap: nowrap;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      html.denizen-phone #denizen-mobile-drawer-body #denizen-account-panel .prof-tabs::-webkit-scrollbar {
        display: none;
      }
      html.denizen-phone-mode[data-denizen-phone-app="profile"] #denizen-account-panel .prof-tabs {
        flex-wrap: nowrap;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      html.denizen-phone-mode[data-denizen-phone-app="profile"] #denizen-account-panel .prof-tabs::-webkit-scrollbar {
        display: none;
      }
      html.denizen-phone-mode[data-denizen-phone-app="profile"] #denizen-account-panel .prof-tab {
        flex: 0 0 auto;
        font-size: 10px;
        padding: 6px 11px;
      }
      html.denizen-phone-mode[data-denizen-phone-app="profile"] #denizen-account-panel .prof-header-name {
        font-size: 15px;
      }
      html.denizen-phone-mode[data-denizen-phone-app="profile"] #denizen-account-panel .prof-row {
        flex-direction: column;
        align-items: stretch;
      }
      html.denizen-phone-mode[data-denizen-phone-app="profile"] #denizen-account-panel .prof-row .prof-btn {
        align-self: stretch;
        text-align: center;
      }
      html.denizen-phone-mode[data-denizen-phone-app="profile"] #denizen-account-panel .acct-stat-row {
        gap: 6px;
      }
      .prof-mcp-card {
        margin-bottom: 10px;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid rgba(96, 165, 250, 0.35);
        background: rgba(30, 58, 138, 0.15);
      }
      .prof-mcp-card .prof-hint { color: #93c5fd; }
      html.denizen-phone-mode[data-denizen-phone-app="profile"] #denizen-account-panel .acct-stat-val {
        max-width: 55%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      html.denizen-desktop.denizen-phone-mode[data-denizen-phone-app="profile"] #denizen-account-panel .prof-header-name {
        font-size: 16px;
      }
      html.denizen-desktop.denizen-phone-mode[data-denizen-phone-app="profile"] #denizen-account-panel .prof-tab {
        font-size: 11px;
        padding: 7px 12px;
      }
      html.denizen-desktop.denizen-phone-mode[data-denizen-phone-app="profile"] #denizen-account-panel[data-dzp-docked="1"] .prof-tabs {
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: none;
        margin-bottom: 6px;
      }
      html.denizen-desktop.denizen-phone-mode[data-denizen-phone-app="profile"] #denizen-account-panel[data-dzp-docked="1"] .prof-tabs::-webkit-scrollbar {
        display: none;
      }
      html.denizen-desktop.denizen-phone-mode[data-denizen-phone-app="profile"] #denizen-account-panel[data-dzp-docked="1"] .prof-tab {
        flex: 0 0 auto;
        font-size: 9px;
        padding: 5px 9px;
        letter-spacing: 0.03em;
      }
      html.denizen-desktop.denizen-phone-mode[data-denizen-phone-app="profile"] #denizen-account-panel .prof-field input,
      html.denizen-desktop.denizen-phone-mode[data-denizen-phone-app="profile"] #denizen-account-panel .prof-field textarea {
        font-size: 12px;
      }
    `;
    document.head.appendChild(s);
  }

  function setStatus(rootEl, message, isError = false) {
    const el = rootEl?.querySelector('#prof-status');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('err', !!isError);
    clearTimeout(statusTimer);
    if (message) {
      statusTimer = setTimeout(() => {
        el.textContent = '';
        el.classList.remove('err');
      }, 3200);
    }
  }

  function renderHeader(profile) {
    const name = profile?.displayName || 'Guest';
    const email = profile?.email || '';
    const tier = profile?.tier || 'guest';
    const positionTitle = profile?.workPosition?.title || positionCache?.title || '';
    const metaParts = [];
    if (positionTitle) metaParts.push(positionTitle);
    if (email) metaParts.push(email);
    else if (profile?.demoUsername) metaParts.push(`@${profile.demoUsername}`);
    else if (!positionTitle) metaParts.push('Not signed in');
    const meta = metaParts.join(' · ');
    return `
      <div class="prof-header">
        <div class="prof-avatar" style="background:${tierAccent(tier)}">${escapeHtml(initials(name))}</div>
        <div class="prof-header-text">
          <div class="prof-header-name" id="prof-header-name">${escapeHtml(name)}</div>
          <div class="prof-header-meta" id="prof-header-meta">${escapeHtml(meta)}</div>
        </div>
      </div>
    `;
  }

  function renderTabs() {
    return `
      <div class="prof-tabs" role="tablist">
        ${TABS.map((t) => `
          <button type="button" class="prof-tab${activeTab === t.id ? ' active' : ''}"
            data-prof-tab="${t.id}" role="tab" aria-selected="${activeTab === t.id}">
            ${t.icon} ${t.label}
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderChipList(items, field) {
    if (!items?.length) return `<div class="prof-empty" id="prof-${field}-empty">None yet — NPCs learn from chat, or add below.</div>`;
    return `<div class="prof-chip-list" id="prof-${field}-list">${items.map((item, i) => `
      <span class="prof-chip" data-field="${field}" data-index="${i}">
        ${escapeHtml(item)}
        <button type="button" data-remove-chip="${field}" data-index="${i}" aria-label="Remove">×</button>
      </span>
    `).join('')}</div>`;
  }

  function renderConnectExtras(rootEl) {
    const panel = rootEl.querySelector('#prof-panel-connect');
    if (!panel || panel.querySelector('#prof-mcp-connect')) return;
    const card = document.createElement('div');
    card.id = 'prof-mcp-connect';
    card.className = 'prof-mcp-card';
    globalThis.DenizenSafeDom.setSafeHtml(card, `
      <div class="prof-section-title">External AI (MCP)</div>
      <div class="prof-hint">Connect Cursor, ChatGPT, or Claude to your Denizen NPC tools.</div>
      <button type="button" class="prof-btn secondary" id="prof-open-mcp">Connect MCP</button>
    `);
    panel.insertBefore(card, panel.firstChild);
    card.querySelector('#prof-open-mcp')?.addEventListener('click', () => {
      globalThis.DenizenVisitorMcpConnectUI?.openConnect?.();
    });
  }

  function mountShell(rootEl, profile) {
    injectStyles();
    if (!rootEl.querySelector('#prof-shell')) {
      const shell = document.createElement('div');
      shell.id = 'prof-shell';
      globalThis.DenizenSafeDom.setSafeHtml(shell, `
        ${renderHeader(profile)}
        ${renderTabs()}
        <div class="prof-status" id="prof-status"></div>
        <div class="prof-panel${activeTab === 'overview' ? ' active' : ''}" data-prof-panel="overview" id="prof-panel-overview"></div>
        <div class="prof-panel${activeTab === 'identity' ? ' active' : ''}" data-prof-panel="identity" id="prof-panel-identity"></div>
        <div class="prof-panel${activeTab === 'memory' ? ' active' : ''}" data-prof-panel="memory" id="prof-panel-memory"></div>
        <div class="prof-panel${activeTab === 'connect' ? ' active' : ''}" data-prof-panel="connect" id="prof-panel-connect"></div>
      `);
      const statsEl = rootEl.querySelector('#denizen-acct-stats');
      const settingsEl = rootEl.querySelector('#denizen-acct-settings');
      const rulesEl = rootEl.querySelector('#denizen-acct-rules');
      const demoBanner = rootEl.querySelector('#denizen-acct-demo-banner');
      if (statsEl) shell.querySelector('#prof-panel-overview')?.appendChild(statsEl);
      if (rulesEl) shell.querySelector('#prof-panel-overview')?.prepend(rulesEl);
      if (demoBanner) shell.querySelector('#prof-panel-overview')?.prepend(demoBanner);
      if (settingsEl) shell.querySelector('#prof-panel-connect')?.appendChild(settingsEl);
      const top = rootEl.querySelector('.acct-top');
      if (top?.nextSibling) {
        rootEl.insertBefore(shell, top.nextSibling);
      } else {
        rootEl.appendChild(shell);
      }
      bindTabHandlers(rootEl);
      renderConnectExtras(rootEl);
    } else {
      const header = rootEl.querySelector('.prof-header');
      if (header) header.outerHTML = renderHeader(profile);
      const tabs = rootEl.querySelector('.prof-tabs');
      if (tabs) tabs.outerHTML = renderTabs();
      bindTabHandlers(rootEl);
      renderConnectExtras(rootEl);
    }
    syncTabPanels(rootEl);
  }

  function syncTabPanels(rootEl) {
    rootEl.querySelectorAll('[data-prof-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.getAttribute('data-prof-panel') === activeTab);
    });
    rootEl.querySelectorAll('[data-prof-tab]').forEach((btn) => {
      const on = btn.getAttribute('data-prof-tab') === activeTab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function bindTabHandlers(rootEl) {
    rootEl.querySelectorAll('[data-prof-tab]').forEach((btn) => {
      btn.onclick = () => {
        activeTab = btn.getAttribute('data-prof-tab') || 'overview';
        syncTabPanels(rootEl);
        if (activeTab === 'memory') renderMemoryPanel(rootEl);
        if (activeTab === 'identity') renderIdentityPanel(rootEl);
        if (activeTab === 'overview') globalThis.DenizenAccountPanel?.renderStats?.();
      };
    });
  }

  function renderPositionPreview(position) {
    if (!position?.title) {
      return '<div class="prof-hint" id="prof-position-preview">Type a title and click Understand role — Denizen will learn how that job typically works.</div>';
    }
    const resp = Array.isArray(position.responsibilities) ? position.responsibilities.slice(0, 4) : [];
    return `
      <div class="prof-position-card" id="prof-position-preview">
        <div class="prof-section-title">How Denizen sees this role</div>
        <div class="prof-position-summary">${escapeHtml(position.summary || '')}</div>
        ${resp.length ? `<ul class="prof-position-list">${resp.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
        ${position.how_to_help ? `<div class="prof-hint" style="margin-top:6px">${escapeHtml(position.how_to_help)}</div>` : ''}
      </div>
    `;
  }

  function renderIdentityPanel(rootEl) {
    const panel = rootEl.querySelector('#prof-panel-identity');
    if (!panel) return;
    const api = getSessionApi();
    const profile = api?.getProfile?.() || {};
    const hasPassword = !!settingsCache?.has_demo_account || profile.tier === 'team';
    const minPass = getSessionApi()?.getMinPasswordLength?.() || 6;
    const position = positionDraft || positionCache || profile.workPosition || null;
    const suggestions = positionSuggestions.length ? positionSuggestions : [
      'CEO', 'Product Manager', 'Software Engineer', 'Designer', 'Executive Assistant', 'Intern',
    ];
    const datalistOptions = suggestions.map((s) => `<option value="${escapeHtml(s)}"></option>`).join('');
    globalThis.DenizenSafeDom.setSafeHtml(panel, `
      <div class="prof-section-title">Your identity</div>
      <div class="prof-hint">Who you are — name, email, and the work you do. Overview shows your account ID (tier, server, credits).</div>
      <div class="prof-field">
        <label for="prof-display-name">Display name</label>
        <input type="text" id="prof-display-name" maxlength="200" value="${escapeHtml(profile.displayName || '')}" />
      </div>
      <div class="prof-field">
        <label for="prof-email">Email</label>
        <input type="email" id="prof-email" maxlength="320" value="${escapeHtml(profile.email || settingsCache?.email || '')}" placeholder="you@company.com" />
      </div>
      <button type="button" class="prof-btn" id="prof-save-identity">Save identity</button>

      <div class="prof-section-title" style="margin-top:12px">Work position</div>
      <div class="prof-hint">Type any title — Product Manager, CEO, Intern, Assistant. Denizen searches what that role means so NPCs know how to help you.</div>
      <div class="prof-field">
        <label for="prof-position-title">Position title</label>
        <input type="text" id="prof-position-title" maxlength="120" list="prof-position-suggestions"
          value="${escapeHtml(position?.title || '')}" placeholder="e.g. Product Manager" />
        <datalist id="prof-position-suggestions">${datalistOptions}</datalist>
      </div>
      <div class="prof-position-actions">
        <button type="button" class="prof-btn secondary" id="prof-resolve-position">Understand role</button>
        <button type="button" class="prof-btn" id="prof-save-position">Save position</button>
      </div>
      ${renderPositionPreview(position)}

      ${hasPassword ? `
        <div class="prof-section-title" style="margin-top:10px">Security</div>
        <div class="prof-hint">Change the password you use to log back into this account.</div>
        <div class="prof-field">
          <label for="prof-current-pass">Current password</label>
          <input type="password" id="prof-current-pass" autocomplete="current-password" />
        </div>
        <div class="prof-field">
          <label for="prof-new-pass">New password (${minPass}+ chars)</label>
          <input type="password" id="prof-new-pass" autocomplete="new-password" />
        </div>
        <button type="button" class="prof-btn secondary" id="prof-save-password">Update password</button>
      ` : `
        <div class="prof-hint" style="margin-top:8px">Create a demo account from the banner on Overview to set a password.</div>
      `}
    `);
    panel.querySelector('#prof-save-identity')?.addEventListener('click', () => {
      saveIdentity(rootEl).catch((err) => setStatus(rootEl, err?.message || 'Save failed', true));
    });
    panel.querySelector('#prof-resolve-position')?.addEventListener('click', () => {
      resolvePosition(rootEl).catch((err) => setStatus(rootEl, err?.message || 'Could not understand role', true));
    });
    panel.querySelector('#prof-save-position')?.addEventListener('click', () => {
      savePosition(rootEl).catch((err) => setStatus(rootEl, err?.message || 'Save position failed', true));
    });
    panel.querySelector('#prof-save-password')?.addEventListener('click', () => {
      savePassword(rootEl).catch((err) => setStatus(rootEl, err?.message || 'Password update failed', true));
    });
  }

  function renderMemoryPanel(rootEl) {
    const panel = rootEl.querySelector('#prof-panel-memory');
    if (!panel) return;
    const prefs = Array.isArray(deepProfile?.preferences) ? deepProfile.preferences : [];
    const vips = Array.isArray(deepProfile?.vips) ? deepProfile.vips : [];
    globalThis.DenizenSafeDom.setSafeHtml(panel, `
      <div class="prof-section-title">AI memory</div>
      <div class="prof-hint">NPCs use these notes when you chat. Preferences are also learned from conversation.</div>
      <div class="prof-field">
        <label>Preferences</label>
        ${renderChipList(prefs, 'preferences')}
        <div class="prof-row" style="margin-top:6px">
          <div class="prof-field">
            <input type="text" id="prof-pref-input" placeholder="e.g. Keep replies short" maxlength="120" />
          </div>
          <button type="button" class="prof-btn secondary" id="prof-add-pref">Add</button>
        </div>
      </div>
      <div class="prof-field">
        <label>VIP contacts</label>
        ${renderChipList(vips, 'vips')}
        <div class="prof-row" style="margin-top:6px">
          <div class="prof-field">
            <input type="text" id="prof-vip-input" placeholder="Client or partner name" maxlength="80" />
          </div>
          <button type="button" class="prof-btn secondary" id="prof-add-vip">Add</button>
        </div>
      </div>
      <div class="prof-field">
        <label for="prof-writing-style">Writing style</label>
        <textarea id="prof-writing-style" maxlength="500" placeholder="How should NPCs write emails and drafts for you?">${escapeHtml(deepProfile?.writing_style || '')}</textarea>
      </div>
      <div class="prof-field">
        <label for="prof-long-horizon">Long-term goals</label>
        <textarea id="prof-long-horizon" maxlength="800" placeholder="Quarter goals, priorities NPCs should remember">${escapeHtml(deepProfile?.long_horizon || '')}</textarea>
      </div>
      <button type="button" class="prof-btn" id="prof-save-memory">Save AI memory</button>
    `);
    panel.querySelectorAll('[data-remove-chip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const field = btn.getAttribute('data-remove-chip');
        const idx = Number(btn.getAttribute('data-index'));
        if (!deepProfile || !Array.isArray(deepProfile[field])) return;
        deepProfile[field] = deepProfile[field].filter((_, i) => i !== idx);
        renderMemoryPanel(rootEl);
      });
    });
    panel.querySelector('#prof-add-pref')?.addEventListener('click', () => {
      const input = panel.querySelector('#prof-pref-input');
      const val = String(input?.value || '').trim();
      if (!val) return;
      if (!deepProfile) deepProfile = { preferences: [], vips: [] };
      if (!Array.isArray(deepProfile.preferences)) deepProfile.preferences = [];
      if (!deepProfile.preferences.includes(val)) deepProfile.preferences.push(val);
      if (input) input.value = '';
      renderMemoryPanel(rootEl);
    });
    panel.querySelector('#prof-add-vip')?.addEventListener('click', () => {
      const input = panel.querySelector('#prof-vip-input');
      const val = String(input?.value || '').trim();
      if (!val) return;
      if (!deepProfile) deepProfile = { preferences: [], vips: [] };
      if (!Array.isArray(deepProfile.vips)) deepProfile.vips = [];
      if (!deepProfile.vips.includes(val)) deepProfile.vips.push(val);
      if (input) input.value = '';
      renderMemoryPanel(rootEl);
    });
    panel.querySelector('#prof-save-memory')?.addEventListener('click', () => {
      saveMemory(rootEl).catch((err) => setStatus(rootEl, err?.message || 'Save failed', true));
    });
  }

  async function loadSettings() {
    const api = getSessionApi();
    const sid = api?.getSessionId?.();
    if (!sid) return null;
    try {
      const res = await fetchWithTimeout(
        `/api/visitor/settings?session_id=${encodeURIComponent(sid)}`,
        { headers: api.authHeaders?.() || {} },
      );
      if (!res.ok) return null;
      const data = await res.json();
      settingsCache = data.settings || {};
      return settingsCache;
    } catch (err) {
      console.warn('[DenizenProfileUI] loadSettings failed:', err?.message || err);
      return null;
    }
  }

  async function loadDeepProfile() {
    const api = getSessionApi();
    const sid = api?.getSessionId?.();
    if (!sid) return null;
    try {
      const res = await fetchWithTimeout(
        `/api/visitor/profile?session_id=${encodeURIComponent(sid)}`,
        { headers: api.authHeaders?.() || {} },
      );
      if (!res.ok) return null;
      const data = await res.json();
      deepProfile = data.profile || { preferences: [], vips: [] };
      return deepProfile;
    } catch (err) {
      console.warn('[DenizenProfileUI] loadDeepProfile failed:', err?.message || err);
      deepProfile = deepProfile || { preferences: [], vips: [] };
      return deepProfile;
    }
  }

  async function loadPosition() {
    const api = getSessionApi();
    const sid = api?.getSessionId?.();
    if (!sid) return null;
    try {
      const res = await fetchWithTimeout(
        `/api/visitor/position?session_id=${encodeURIComponent(sid)}`,
        { headers: api.authHeaders?.() || {} },
      );
      if (!res.ok) return null;
      const data = await res.json();
      positionCache = data.position || null;
      positionSuggestions = Array.isArray(data.suggestions) ? data.suggestions : positionSuggestions;
      if (positionCache?.title && api?.applyProfilePatch) {
        api.applyProfilePatch({ workPosition: positionCache });
      }
      return positionCache;
    } catch (err) {
      console.warn('[DenizenProfileUI] loadPosition failed:', err?.message || err);
      return null;
    }
  }

  async function resolvePosition(rootEl) {
    const api = getSessionApi();
    const sid = api?.getSessionId?.();
    if (!sid) throw new Error('Not signed in');
    const title = rootEl.querySelector('#prof-position-title')?.value?.trim();
    if (!title) throw new Error('Enter a position title first');
    setStatus(rootEl, 'Understanding role…');
    const res = await fetchWithTimeout('/api/visitor/position/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(api.authHeaders?.() || {}) },
      body: JSON.stringify({ session_id: sid, title }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    positionDraft = data.position || null;
    const preview = rootEl.querySelector('#prof-position-preview');
    if (preview) {
      preview.outerHTML = renderPositionPreview(positionDraft);
    }
    setStatus(rootEl, positionDraft?.source === 'llm' ? 'Role understood (AI)' : 'Role understood');
  }

  async function savePosition(rootEl) {
    const api = getSessionApi();
    const sid = api?.getSessionId?.();
    if (!sid) throw new Error('Not signed in');
    const title = rootEl.querySelector('#prof-position-title')?.value?.trim();
    if (!title) throw new Error('Enter a position title first');
    setStatus(rootEl, 'Saving position…');
    const res = await fetchWithTimeout('/api/visitor/position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(api.authHeaders?.() || {}) },
      body: JSON.stringify({
        session_id: sid,
        title,
        profile: positionDraft?.title === title ? positionDraft : undefined,
        resolve: !positionDraft || positionDraft.title !== title,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    positionCache = data.position || null;
    positionDraft = null;
    if (typeof api.applyProfilePatch === 'function') {
      api.applyProfilePatch({ workPosition: positionCache });
    }
    const preview = rootEl.querySelector('#prof-position-preview');
    if (preview) {
      preview.outerHTML = renderPositionPreview(positionCache);
    }
    const metaEl = rootEl.querySelector('#prof-header-meta');
    const profile = api.getProfile?.() || {};
    if (metaEl) {
      const parts = [];
      if (profile.workPosition?.title) parts.push(profile.workPosition.title);
      if (profile.email) parts.push(profile.email);
      metaEl.textContent = parts.join(' · ') || metaEl.textContent;
    }
    globalThis.DenizenAccountPanel?.renderProfile?.();
    setStatus(rootEl, 'Position saved — NPCs will tailor help to your role');
  }

  async function saveIdentity(rootEl) {
    const api = getSessionApi();
    const sid = api?.getSessionId?.();
    if (!sid) throw new Error('Not signed in');
    const displayName = rootEl.querySelector('#prof-display-name')?.value?.trim();
    const email = rootEl.querySelector('#prof-email')?.value?.trim();
    if (!displayName) throw new Error('Display name is required');
    const res = await fetchWithTimeout('/api/visitor/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(api.authHeaders?.() || {}) },
      body: JSON.stringify({
        session_id: sid,
        display_name: displayName,
        email: email || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (typeof api.applyProfilePatch === 'function') {
      api.applyProfilePatch({ displayName, email: email || null });
    }
    const nameEl = rootEl.querySelector('#prof-header-name');
    const metaEl = rootEl.querySelector('#prof-header-meta');
    if (nameEl) nameEl.textContent = displayName;
    if (metaEl) metaEl.textContent = email || metaEl.textContent;
    globalThis.DenizenAccountPanel?.renderProfile?.();
    setStatus(rootEl, 'Identity saved');
  }

  async function savePassword(rootEl) {
    const api = getSessionApi();
    const sid = api?.getSessionId?.();
    if (!sid) throw new Error('Not signed in');
    const currentPassword = rootEl.querySelector('#prof-current-pass')?.value || '';
    const newPassword = rootEl.querySelector('#prof-new-pass')?.value || '';
    const res = await fetchWithTimeout('/api/visitor/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(api.authHeaders?.() || {}) },
      body: JSON.stringify({ session_id: sid, current_password: currentPassword, new_password: newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    rootEl.querySelector('#prof-current-pass').value = '';
    rootEl.querySelector('#prof-new-pass').value = '';
    setStatus(rootEl, 'Password updated');
  }

  async function saveMemory(rootEl) {
    const api = getSessionApi();
    const sid = api?.getSessionId?.();
    if (!sid) throw new Error('Not signed in');
    const writing_style = rootEl.querySelector('#prof-writing-style')?.value?.trim() || null;
    const long_horizon = rootEl.querySelector('#prof-long-horizon')?.value?.trim() || null;
    const res = await fetchWithTimeout('/api/visitor/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(api.authHeaders?.() || {}) },
      body: JSON.stringify({
        session_id: sid,
        preferences: deepProfile?.preferences || [],
        vips: deepProfile?.vips || [],
        writing_style,
        long_horizon,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    deepProfile = data.profile || deepProfile;
    setStatus(rootEl, 'AI memory saved');
  }

  async function mount(rootEl, profile, { expandTab } = {}) {
    if (expandTab) activeTab = expandTab;
    mountShell(rootEl, profile);
    try {
      await Promise.all([loadSettings(), loadDeepProfile(), loadPosition()]);
    } catch (err) {
      console.warn('[DenizenProfileUI] mount failed:', err?.message || err);
      setStatus(rootEl, 'Some profile data could not load. You can still edit below.', true);
    }
    renderIdentityPanel(rootEl);
    if (activeTab === 'memory') renderMemoryPanel(rootEl);
  }

  function setTab(tabId) {
    activeTab = tabId || 'overview';
  }

  globalThis.DenizenProfileUI = {
    mount,
    setTab,
    loadDeepProfile,
    loadSettings,
    renderIdentityPanel,
    renderMemoryPanel,
  };
})();
