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
    const meta = email || (profile?.demoUsername ? `@${profile.demoUsername}` : 'Not signed in');
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

  function mountShell(rootEl, profile) {
    injectStyles();
    if (!rootEl.querySelector('#prof-shell')) {
      const shell = document.createElement('div');
      shell.id = 'prof-shell';
      shell.innerHTML = `
        ${renderHeader(profile)}
        ${renderTabs()}
        <div class="prof-status" id="prof-status"></div>
        <div class="prof-panel${activeTab === 'overview' ? ' active' : ''}" data-prof-panel="overview" id="prof-panel-overview"></div>
        <div class="prof-panel${activeTab === 'identity' ? ' active' : ''}" data-prof-panel="identity" id="prof-panel-identity"></div>
        <div class="prof-panel${activeTab === 'memory' ? ' active' : ''}" data-prof-panel="memory" id="prof-panel-memory"></div>
        <div class="prof-panel${activeTab === 'connect' ? ' active' : ''}" data-prof-panel="connect" id="prof-panel-connect"></div>
      `;
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
    } else {
      const header = rootEl.querySelector('.prof-header');
      if (header) header.outerHTML = renderHeader(profile);
      const tabs = rootEl.querySelector('.prof-tabs');
      if (tabs) tabs.outerHTML = renderTabs();
      bindTabHandlers(rootEl);
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

  function renderIdentityPanel(rootEl) {
    const panel = rootEl.querySelector('#prof-panel-identity');
    if (!panel) return;
    const api = getSessionApi();
    const profile = api?.getProfile?.() || {};
    const hasPassword = !!settingsCache?.has_demo_account || profile.tier === 'team';
    const minPass = getSessionApi()?.getMinPasswordLength?.() || 6;
    panel.innerHTML = `
      <div class="prof-section-title">Your identity</div>
      <div class="prof-hint">Name and email sync across Denizen, CRM header, and team roster.</div>
      <div class="prof-field">
        <label for="prof-display-name">Display name</label>
        <input type="text" id="prof-display-name" maxlength="200" value="${escapeHtml(profile.displayName || '')}" />
      </div>
      <div class="prof-field">
        <label for="prof-email">Email</label>
        <input type="email" id="prof-email" maxlength="320" value="${escapeHtml(profile.email || settingsCache?.email || '')}" placeholder="you@company.com" />
      </div>
      <button type="button" class="prof-btn" id="prof-save-identity">Save identity</button>
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
    `;
    panel.querySelector('#prof-save-identity')?.addEventListener('click', () => {
      saveIdentity(rootEl).catch((err) => setStatus(rootEl, err?.message || 'Save failed', true));
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
    panel.innerHTML = `
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
    `;
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
    const res = await fetchWithTimeout(
      `/api/visitor/settings?session_id=${encodeURIComponent(sid)}`,
      { headers: api.authHeaders?.() || {} },
    );
    if (!res.ok) return null;
    const data = await res.json();
    settingsCache = data.settings || {};
    return settingsCache;
  }

  async function loadDeepProfile() {
    const api = getSessionApi();
    const sid = api?.getSessionId?.();
    if (!sid) return null;
    const res = await fetchWithTimeout(
      `/api/visitor/profile?session_id=${encodeURIComponent(sid)}`,
      { headers: api.authHeaders?.() || {} },
    );
    if (!res.ok) return null;
    const data = await res.json();
    deepProfile = data.profile || { preferences: [], vips: [] };
    return deepProfile;
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
    await Promise.all([loadSettings(), loadDeepProfile()]);
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
