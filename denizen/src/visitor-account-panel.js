/**
 * Visitor account panel — top-right profile chip + logout + contribution stats.
 * Attaches to globalThis.DenizenAccountPanel (no imports).
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-account-panel-style';
  const ROOT_ID = 'denizen-account-panel';
  const REQUEST_TIMEOUT_MS = 12000;

  let rootEl = null;
  let expanded = false;
  let initialized = false;
  let busyLogout = false;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${ROOT_ID} {
        position: fixed;
        z-index: 100530;
        top: max(12px, env(safe-area-inset-top, 0px));
        right: max(12px, env(safe-area-inset-right, 0px));
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 200px;
        max-width: min(280px, calc(100vw - 24px));
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid #334155;
        background: rgba(2, 6, 23, 0.94);
        color: #e2e8f0;
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.45);
        user-select: none;
      }
      #${ROOT_ID} .acct-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }
      #${ROOT_ID} .acct-identity {
        flex: 1;
        min-width: 0;
        cursor: pointer;
        touch-action: manipulation;
      }
      #${ROOT_ID} .acct-name {
        font-weight: 700;
        color: #e2e8f0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${ROOT_ID} .acct-email {
        color: #94a3b8;
        font-size: 10px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${ROOT_ID} .acct-actions {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
        flex-shrink: 0;
      }
      #${ROOT_ID} .acct-toggle {
        background: transparent;
        border: 1px solid #334155;
        border-radius: 6px;
        color: #94a3b8;
        font: inherit;
        font-size: 10px;
        padding: 2px 6px;
        cursor: pointer;
        touch-action: manipulation;
      }
      #${ROOT_ID} .acct-toggle:hover { border-color: #4ade80; color: #cbd5e1; }
      #${ROOT_ID} .acct-logout {
        background: transparent;
        border: 1px solid #475569;
        border-radius: 6px;
        color: #fca5a5;
        font: inherit;
        font-size: 10px;
        font-weight: 600;
        padding: 4px 8px;
        cursor: pointer;
        touch-action: manipulation;
      }
      #${ROOT_ID} .acct-logout:hover { border-color: #f87171; background: rgba(248, 113, 113, 0.1); }
      #${ROOT_ID} .acct-settings {
        display: none;
        flex-direction: column;
        gap: 8px;
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid #1f2937;
      }
      #${ROOT_ID}[data-expanded="1"] .acct-settings {
        display: flex;
      }
      #${ROOT_ID} .acct-settings-title {
        font-size: 10px;
        font-weight: 700;
        color: #94a3b8;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      #${ROOT_ID} .acct-settings-hint {
        font-size: 9px;
        color: #64748b;
        line-height: 1.35;
      }
      #${ROOT_ID} .acct-field label {
        display: block;
        font-size: 9px;
        color: #94a3b8;
        margin-bottom: 3px;
      }
      #${ROOT_ID} .acct-field input {
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
      #${ROOT_ID} .acct-save-btn {
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
      }
      #${ROOT_ID} .acct-logout:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      #${ROOT_ID} .acct-stats {
        display: none;
        flex-direction: column;
        gap: 6px;
        padding-top: 6px;
        border-top: 1px solid #1f2937;
      }
      #${ROOT_ID}[data-expanded="1"] .acct-stats {
        display: flex;
      }
      #${ROOT_ID} .acct-stat-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        color: #94a3b8;
        font-size: 10px;
      }
      #${ROOT_ID} .acct-stat-val {
        color: #93c5fd;
        font-weight: 600;
        text-align: right;
      }
      #${ROOT_ID} .acct-stat-val.super {
        color: #fde68a;
      }
      #${ROOT_ID} .acct-stat-val.active {
        color: #4ade80;
      }
      #${ROOT_ID} .acct-tier {
        display: inline-block;
        border-radius: 999px;
        border: 1px solid #334155;
        color: #cbd5e1;
        padding: 1px 6px;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      html[data-denizen-modal="open"] #${ROOT_ID} {
        display: none;
      }
      html.denizen-drawer-open #denizen-mobile-drawer-body #${ROOT_ID} {
        display: flex !important;
      }
      html.denizen-phone #denizen-mobile-drawer-body #${ROOT_ID} {
        min-width: 0 !important;
        max-width: 100% !important;
        width: auto !important;
        box-shadow: none !important;
      }
    `;
    document.head.appendChild(s);
  }

  function getSessionApi() {
    return globalThis.DenizenVisitorSession || null;
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

  async function fetchNodeStatus() {
    const api = getSessionApi();
    const sid = api?.getSessionId?.() || api?.getProfile?.()?.sessionId || null;
    if (!sid) return null;
    const headers = typeof api?.authHeaders === 'function'
      ? api.authHeaders()
      : { 'Content-Type': 'application/json' };
    const res = await fetchWithTimeout(
      `/api/compute/node/status?session_id=${encodeURIComponent(sid)}`,
      { method: 'GET', headers },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    return data;
  }

  function formatRam(mb) {
    const n = Number(mb);
    if (!Number.isFinite(n) || n <= 0) return '—';
    if (n >= 1024) return `${Math.round(n / 1024)} GB`;
    return `${Math.round(n)} MB`;
  }

  function getContributionStats() {
    const nodeUi = globalThis.DenizenNodeUI;
    if (nodeUi?.getState) {
      const s = nodeUi.getState();
      return {
        credits: s.credits,
        tier: s.tier,
        isSuperNode: s.isSuperNode,
        contributing: s.contributing,
        optedIn: s.optedIn,
        contributorState: s.contributorState,
        statusLabel: s.statusLabel,
        lmStudioModel: s.lmStudioModel,
        isHostNode: s.isHostNode,
        desktopLinked: s.desktopLinked,
        jobsCompleted: s.jobsCompleted,
        hardwareScore: s.hardwareScore,
        contributionLevel: s.contributionLevel,
        cpuCores: s.cpuCores,
        ramMb: s.ramMb,
        gpuModel: s.gpuModel,
        contributionModes: s.contributionModes,
        cpuPercent: s.cpuPercent,
        ramUsedPercent: s.ramUsedPercent,
        ramUsedMb: s.ramUsedMb,
        gpuUtilPercent: s.gpuUtilPercent,
        gpuVramUsedMb: s.gpuVramUsedMb,
        fleet: s.fleet,
      };
    }
    return null;
  }

  function formatPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return `${Math.round(n * 10) / 10}%`;
  }

  function formatIdentityLabel(profile) {
    if (!profile?.displayName && !profile?.email) return { name: 'Guest', email: null };
    return {
      name: profile.displayName || 'Guest',
      email: profile.email || null,
    };
  }

  function ensureRoot() {
    if (rootEl) return rootEl;
    injectStyles();
    rootEl = document.createElement('section');
    rootEl.id = ROOT_ID;
    rootEl.dataset.expanded = expanded ? '1' : '0';
    rootEl.innerHTML = `
      <div class="acct-top">
        <div class="acct-identity" id="denizen-acct-identity" role="button" tabindex="0" aria-expanded="false">
          <div class="acct-name" id="denizen-acct-name">Guest</div>
          <div class="acct-email" id="denizen-acct-email" hidden></div>
        </div>
        <div class="acct-actions">
          <button type="button" class="acct-toggle" id="denizen-acct-toggle" aria-label="Toggle stats">▾</button>
          <button type="button" class="acct-logout" id="denizen-acct-logout">Log out</button>
        </div>
      </div>
      <div class="acct-stats" id="denizen-acct-stats"></div>
      <div class="acct-settings" id="denizen-acct-settings">
        <div class="acct-settings-title">Connect &amp; notifications</div>
        <div class="acct-settings-hint" id="denizen-acct-email-hint">Email notifications use your login email when Resend is configured on the server.</div>
        <div class="acct-field">
          <label for="denizen-acct-key-anthropic">Anthropic key (optional — for your external AI clients)</label>
          <input type="password" id="denizen-acct-key-anthropic" autocomplete="off" placeholder="sk-ant-…" />
        </div>
        <div class="acct-field">
          <label for="denizen-acct-key-openai">OpenAI key (optional)</label>
          <input type="password" id="denizen-acct-key-openai" autocomplete="off" placeholder="sk-…" />
        </div>
        <label class="acct-settings-hint" style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" id="denizen-acct-notify-email" checked />
          Send me Denizen email updates
        </label>
        <button type="button" class="acct-save-btn" id="denizen-acct-save-settings">Save settings</button>
      </div>
    `;
    document.body.appendChild(rootEl);
    globalThis.DenizenMobileSidebar?.relayout?.();

    const identityEl = rootEl.querySelector('#denizen-acct-identity');
    const toggleEl = rootEl.querySelector('#denizen-acct-toggle');
    const logoutEl = rootEl.querySelector('#denizen-acct-logout');

    const onToggle = () => {
      expanded = !expanded;
      rootEl.dataset.expanded = expanded ? '1' : '0';
      if (identityEl) identityEl.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      if (toggleEl) toggleEl.textContent = expanded ? '▴' : '▾';
      if (expanded) renderStats();
    };

    identityEl?.addEventListener('click', onToggle);
    identityEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    });
    toggleEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      onToggle();
    });
    logoutEl?.addEventListener('click', () => {
      if (busyLogout) return;
      const api = getSessionApi();
      if (typeof api?.logout !== 'function') return;
      busyLogout = true;
      if (logoutEl) logoutEl.disabled = true;
      api.logout()
        .catch((err) => {
          console.warn('[DenizenAccountPanel] logout failed:', err?.message || err);
        })
        .finally(() => {
          busyLogout = false;
          if (logoutEl) logoutEl.disabled = false;
        });
    });

    return rootEl;
  }

  async function loadAccountSettings() {
    const api = getSessionApi();
    const sid = api?.getSessionId?.();
    if (!sid) return;
    try {
      const res = await fetch(
        `/api/visitor/settings?session_id=${encodeURIComponent(sid)}`,
        { headers: api.authHeaders?.() || {} },
      );
      if (!res.ok) return;
      const data = await res.json();
      const settings = data.settings || {};
      const hint = rootEl?.querySelector('#denizen-acct-email-hint');
      if (hint) {
        const emailRes = await fetch(
          `/api/visitor/email/status?session_id=${encodeURIComponent(sid)}`,
          { headers: api.authHeaders?.() || {} },
        ).catch(() => null);
        const emailData = emailRes?.ok ? await emailRes.json() : {};
        if (emailData.resend_configured) {
          hint.textContent = emailData.has_email
            ? `Notifications can reach ${emailData.email}. Operator inbox (Lucy) is separate.`
            : 'Add your email at login to receive Denizen notifications.';
        } else {
          hint.textContent = 'Server email (Resend) not configured — notifications are off until operator sets RESEND_API_KEY.';
        }
      }
      const notify = rootEl?.querySelector('#denizen-acct-notify-email');
      if (notify) notify.checked = settings.notify_email !== false;
    } catch (_) {}
  }

  async function saveAccountSettings() {
    const api = getSessionApi();
    const sid = api?.getSessionId?.();
    if (!sid) return;
    const anthropic = rootEl?.querySelector('#denizen-acct-key-anthropic')?.value?.trim() || '';
    const openai = rootEl?.querySelector('#denizen-acct-key-openai')?.value?.trim() || '';
    const notifyEmail = !!rootEl?.querySelector('#denizen-acct-notify-email')?.checked;
    const provider_keys = {};
    if (anthropic) provider_keys.anthropic = anthropic;
    if (openai) provider_keys.openai = openai;
    const res = await fetch('/api/visitor/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(api.authHeaders?.() || {}),
      },
      body: JSON.stringify({
        session_id: sid,
        provider_keys,
        notify_email: notifyEmail,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const anthEl = rootEl?.querySelector('#denizen-acct-key-anthropic');
    const openEl = rootEl?.querySelector('#denizen-acct-key-openai');
    if (anthEl) anthEl.value = '';
    if (openEl) openEl.value = '';
    await loadAccountSettings();
  }

  function renderProfile() {
    ensureRoot();
    const api = getSessionApi();
    const profile = api?.getProfile?.() || {};
    const { name, email } = formatIdentityLabel(profile);
    const nameEl = rootEl.querySelector('#denizen-acct-name');
    const emailEl = rootEl.querySelector('#denizen-acct-email');
    if (nameEl) nameEl.textContent = name;
    if (emailEl) {
      if (email) {
        emailEl.textContent = email;
        emailEl.hidden = false;
      } else {
        emailEl.textContent = '';
        emailEl.hidden = true;
      }
    }
    if (expanded) {
      renderStats();
      loadAccountSettings();
    }
  }

  function statRow(label, value, className = '') {
    const valClass = className ? ` acct-stat-val ${className}` : ' acct-stat-val';
    return `<div class="acct-stat-row"><span>${label}</span><span class="${valClass.trim()}">${value}</span></div>`;
  }

  async function renderStats() {
    if (!rootEl || !expanded) return;
    const statsEl = rootEl.querySelector('#denizen-acct-stats');
    if (!statsEl) return;

    const api = getSessionApi();
    const profile = api?.getProfile?.() || {};
    let stats = getContributionStats();

    if (!stats && profile.sessionId) {
      try {
        const raw = await fetchNodeStatus();
        if (raw) {
          const base = raw.status || raw.node || raw;
          const summary = base.contribution_summary ?? raw.contribution_summary ?? {};
          stats = {
            credits: Number(base.credits_balance ?? base.credits ?? raw.credits ?? 0),
            tier: String(base.node_tier ?? base.tier ?? profile.tier ?? 'visitor'),
            isSuperNode: !!(base.is_super_node ?? base.super_node ?? raw.is_super_node),
            contributing: !!(base.contributing ?? raw.contributing),
            optedIn: !!(base.opted_in ?? base.opt_in ?? raw.opted_in),
            contributorState: String(base.contributor_state ?? raw.contributor_state ?? 'browser_only'),
            statusLabel: String(base.status_label ?? raw.status_label ?? 'browser only'),
            lmStudioModel: base.lm_studio?.model_short || base.lm_studio?.model || null,
            isHostNode: !!(base.is_host_node ?? raw.is_host_node),
            desktopLinked: !!(base.desktop_linked ?? raw.desktop_linked),
            jobsCompleted: Number(summary.jobs_completed ?? base.active_node?.jobs_completed) || 0,
            hardwareScore: Number(summary.hardware_score ?? base.hardware_score) || 0,
            contributionLevel: String(summary.contribution_level ?? base.contribution_level ?? 'off'),
            cpuCores: summary.cpu_cores ?? base.profile?.cpu_cores ?? null,
            ramMb: summary.ram_mb ?? base.profile?.ram_mb ?? null,
            gpuModel: summary.gpu_model ?? base.profile?.gpu_model ?? null,
            contributionModes: Array.isArray(summary.contribution_modes) ? summary.contribution_modes : [],
          };
        }
      } catch (_) {}
    }

    const tier = profile.tier || stats?.tier || '—';
    const access = profile.accessMethod === 'ceo' ? 'CEO · host' : (profile.accessMethod || '—');
    const credits = stats ? Math.round(Number(stats.credits) || 0) : '—';
    const status = stats?.statusLabel || (stats?.contributing ? 'active' : 'browser only');
    const contrib = stats?.contributing ? 'Yes' : 'No';
    const superBadge = stats?.isSuperNode ? 'SUPER NODE' : null;
    const hostLabel = stats?.isHostNode ? 'host' : (stats?.desktopLinked ? 'desktop linked' : null);

    let html = '';
    html += statRow('Tier', `<span class="acct-tier">${String(tier).toUpperCase()}</span>`);
    html += statRow('Access', String(access));
    html += statRow('Credits', String(credits));
    html += statRow('Contributing', contrib, stats?.contributing ? 'active' : '');
    html += statRow('Status', String(status));
    if (stats?.contributorState) html += statRow('Node state', String(stats.contributorState));
    if (superBadge) html += statRow('Badge', superBadge, 'super');
    if (hostLabel) html += statRow('Link', hostLabel, 'active');
    if (stats?.lmStudioModel) html += statRow('LM model', String(stats.lmStudioModel));
    if (stats?.jobsCompleted != null) html += statRow('Jobs done', String(stats.jobsCompleted));
    if (stats?.hardwareScore != null) html += statRow('HW score', String(stats.hardwareScore));
    if (stats?.contributionLevel) html += statRow('Level', String(stats.contributionLevel));
    if (formatPercent(stats?.cpuPercent)) {
      const cores = Number(stats?.cpuCores) > 0 ? ` · ${stats.cpuCores} cores` : '';
      html += statRow('CPU live', `${formatPercent(stats.cpuPercent)}${cores}`, 'active');
    } else if (Number.isFinite(Number(stats?.cpuCores)) && Number(stats.cpuCores) > 0) {
      html += statRow('CPU', `${stats.cpuCores} cores`);
    }
    if (formatPercent(stats?.ramUsedPercent)) {
      const used = stats?.ramUsedMb ? ` · ${formatRam(stats.ramUsedMb)} used` : '';
      html += statRow('RAM live', `${formatPercent(stats.ramUsedPercent)}${used}`, 'active');
    } else if (stats?.ramMb) {
      html += statRow('RAM', formatRam(stats.ramMb));
    }
    if (formatPercent(stats?.gpuUtilPercent) || stats?.gpuModel) {
      const parts = [];
      if (formatPercent(stats?.gpuUtilPercent)) parts.push(formatPercent(stats.gpuUtilPercent));
      if (stats?.gpuVramUsedMb) parts.push(`${formatRam(stats.gpuVramUsedMb)} VRAM`);
      if (stats?.gpuModel) parts.push(String(stats.gpuModel));
      html += statRow('GPU live', parts.join(' · ') || '—', 'active');
    } else if (stats?.gpuModel) {
      html += statRow('GPU', String(stats.gpuModel));
    }
    const fleet = Array.isArray(stats?.fleet) ? stats.fleet : [];
    if (fleet.length) {
      html += statRow('Machines', String(fleet.length));
      fleet.slice(0, 4).forEach((machine) => {
        const label = machine?.label || machine?.hostname || machine?.machine_id || 'machine';
        const bits = [];
        if (formatPercent(machine?.cpu_percent)) bits.push(`CPU ${formatPercent(machine.cpu_percent)}`);
        if (machine?.ram?.used_percent != null) bits.push(`RAM ${formatPercent(machine.ram.used_percent)}`);
        if (formatPercent(machine?.gpu?.utilization_percent)) bits.push(`GPU ${formatPercent(machine.gpu.utilization_percent)}`);
        if (machine?.reachable === true) bits.push('online');
        if (machine?.reachable === false) bits.push('offline');
        html += statRow(label, bits.join(' · ') || machine?.role || '—');
      });
    }
    const modes = Array.isArray(stats?.contributionModes) ? stats.contributionModes : [];
    if (modes.length) {
      const activeModes = modes
        .filter((m) => m?.active || m?.enabled)
        .map((m) => m.label || m.mode || m.key)
        .filter(Boolean);
      if (activeModes.length) html += statRow('Modes', activeModes.join(', '), 'active');
    }

    statsEl.innerHTML = html;
  }

  function init() {
    if (initialized) return;
    initialized = true;
    ensureRoot();
    renderProfile();

    document.addEventListener('denizen-visitor-session-ready', () => {
      renderProfile();
    });
    document.addEventListener('denizen-visitor-logged-out', () => {
      expanded = false;
      if (rootEl) {
        rootEl.dataset.expanded = '0';
        const toggleEl = rootEl.querySelector('#denizen-acct-toggle');
        if (toggleEl) toggleEl.textContent = '▾';
      }
      renderProfile();
    });
    window.addEventListener('denizen-node-status', () => {
      if (expanded) renderStats();
    });
  }

  function expandForDrawer() {
    expanded = true;
    if (rootEl) {
      rootEl.dataset.expanded = '1';
      const identityEl = rootEl.querySelector('#denizen-acct-identity');
      const toggleEl = rootEl.querySelector('#denizen-acct-toggle');
      if (identityEl) identityEl.setAttribute('aria-expanded', 'true');
      if (toggleEl) toggleEl.textContent = '▴';
    }
    renderStats();
    loadAccountSettings();
  }

  const DenizenAccountPanel = {
    init,
    renderProfile,
    renderStats,
    expandForDrawer,
  };

  globalThis.DenizenAccountPanel = DenizenAccountPanel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
