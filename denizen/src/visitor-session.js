/**
 * Denizen visitor session — persistent browser identity + personal assistant claim.
 * Attaches to globalThis.DenizenVisitorSession (no imports).
 */
(function () {
  'use strict';

  try {
    const resetParams = new URLSearchParams(window.location.search);
    if (resetParams.get('reset') === '1') {
      [
        'denizen-visitor-session',
        'denizen-role',
        'denizen-onboarding-seen',
        'denizen-ceo-grant',
      ].forEach((key) => localStorage.removeItem(key));
      sessionStorage.removeItem('denizen-portrait-ok');
      resetParams.delete('reset');
      const qs = resetParams.toString();
      window.location.replace(`${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    }
  } catch (_) {}

  let pendingJoinCode = null;
  try {
    const inviteParams = new URLSearchParams(window.location.search);
    const join = inviteParams.get('join') || inviteParams.get('team') || inviteParams.get('code');
    if (join) {
      pendingJoinCode = String(join).trim();
      inviteParams.delete('join');
      inviteParams.delete('team');
      inviteParams.delete('code');
      const qs = inviteParams.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    }
  } catch (_) {}

  const STORAGE_KEY = 'denizen-visitor-session';
  const ROLE_STORAGE_KEY = 'denizen-role';
  const PROTECTED_NPC_KEYS = new Set(['lucy', 'abby', 'bouncer']);

  function readRole() {
    try {
      return localStorage.getItem(ROLE_STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function clearCeoUiMode() {
    globalThis.__DenizenCeoMode = false;
    try { localStorage.removeItem(ROLE_STORAGE_KEY); } catch (_) {}
    document.documentElement.classList.remove('denizen-ceo-mode');
    document.getElementById('denizen-ceo-shell')?.remove();
    document.getElementById('denizen-ceo-mode-chip')?.remove();
    const mobile = globalThis.DenizenMobilePlay;
    if (typeof mobile?.setCeoMode === 'function') {
      mobile.setCeoMode();
    }
  }

  if (readRole() === 'ceo') {
    clearCeoUiMode();
  }

  const FOLDER_TO_NPC_KEY = {
    conference_man: 'marcus',
    conference_woman: 'sarah',
  };

  let sessionId = null;
  let sessionToken = null;
  let displayName = null;
  let assistant = null;
  let tier = null;
  let orgSlug = null;
  let accessMethod = null;
  let identityId = null;
  let officeId = null;
  let userEmail = null;
  let teamRole = null;
  let canApproveSkills = false;
  let workPosition = null;
  let initPromise = null;
  let modalEl = null;
  let officeConfig = null;

  async function fetchOfficeConfig() {
    if (officeConfig) return officeConfig;
    try {
      const res = await fetch('/api/office-config');
      if (res.ok) {
        officeConfig = await res.json();
        return officeConfig;
      }
    } catch (_) {}
    officeConfig = {
      visitorAccess: {
        demoOrgSlug: 'acme',
        teamOrgSlug: 'zion',
        teamCodeRequired: true,
        ceoAccessRequired: true,
        minPasswordLength: 6,
        devPasswordRelaxed: false,
      },
    };
    return officeConfig;
  }

  function minPasswordLen() {
    const n = Number(officeConfig?.visitorAccess?.minPasswordLength);
    return Number.isFinite(n) && n >= 3 ? n : 6;
  }

  function passwordPlaceholder() {
    const min = minPasswordLen();
    return min < 6 ? `Password (${min}+ characters, dev)` : `Password (${min}+ characters)`;
  }

  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  function writeStore(partial) {
    const next = { ...readStore(), ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  function clearActiveSessionMemory() {
    sessionId = null;
    sessionToken = null;
    assistant = null;
    identityId = null;
    officeId = null;
    teamRole = null;
    canApproveSkills = false;
    try {
      delete window.__DenizenOfficeId;
      delete window.__DenizenIsOperatorOffice;
    } catch (_) {}
  }

  function resetStoredSessionForSwitch() {
    announceProfileSwitching({ displayName: 'Switching account', tier: null });
    clearActiveSessionMemory();
    displayName = null;
    tier = null;
    orgSlug = null;
    accessMethod = null;
    identityId = null;
    userEmail = null;
    workPosition = null;
    initPromise = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(ROLE_STORAGE_KEY);
      localStorage.removeItem('denizen-ceo-grant');
    } catch (_) {}
    clearCeoUiMode();
  }

  async function applyWelcomeSession(welcome) {
    if (!welcome) {
      return { sessionId: null, displayName: null, assistant: null };
    }
    displayName = welcome.displayName;
    tier = welcome.tier;
    orgSlug = welcome.orgSlug;
    accessMethod = welcome.accessMethod;
    try {
      await touchSession(displayName, {
        orgSlug: welcome.orgSlug,
        tier: welcome.tier,
        accessMethod: welcome.accessMethod,
        accessGrant: welcome.accessGrant,
        email: welcome.email || null,
        demoUsername: welcome.demoUsername || null,
        freshPrincipal: welcome.freshPrincipal !== false,
      });
    } catch (err) {
      console.warn('[DenizenVisitorSession] session touch failed:', err?.message || err);
      resetStoredSessionForSwitch();
      return { sessionId: null, displayName: null, assistant: null };
    }
    await refreshSessionSettings().catch(() => null);
    if (isCeoPrincipalNow()) {
      tier = 'ceo';
      accessMethod = 'ceo';
    }
    try {
      document.dispatchEvent(new CustomEvent('denizen-visitor-session-ready', {
        detail: {
          sessionId,
          tier,
          accessMethod,
          identityId,
        },
      }));
    } catch (_) {}
    DenizenVisitorSession.refreshAssistant().catch(() => null);
    return { sessionId, displayName, assistant };
  }

  function announceProfileSwitching(profile = {}) {
    try {
      document.dispatchEvent(new CustomEvent('denizen-visitor-profile-switching', {
        detail: profile,
      }));
    } catch (_) {}
  }

  function isOwnerPrincipalNow() {
    const storedTier = String(tier || readStore().tier || '').toLowerCase();
    if (storedTier === 'ceo') return true;
    const role = String(teamRole || '').toLowerCase();
    return role === 'owner' || role === 'ceo';
  }

  function isCeoPrincipalNow() {
    const storedTier = String(tier || readStore().tier || '').toLowerCase();
    if (storedTier === 'demo') return false;
    const method = String(accessMethod || readStore().access_method || '').toLowerCase();
    if (method === 'demo' || method === 'demo_login') return false;
    if (method === 'ceo') return true;
    if (isOwnerPrincipalNow()) return true;
    if (method && method !== 'ceo') return false;
    try {
      return !!localStorage.getItem('denizen-ceo-grant');
    } catch (_) {
      return false;
    }
  }

  function applyOwnerPrincipalState(extra = {}) {
    if (!isOwnerPrincipalNow() && !extra.isCeoPrincipal) return false;
    tier = 'ceo';
    accessMethod = 'ceo';
    const store = readStore();
    writeStore({
      ...store,
      tier: 'ceo',
      access_method: 'ceo',
      accessMethod: 'ceo',
    });
    if (extra.ceoGrant) {
      try { localStorage.setItem('denizen-ceo-grant', extra.ceoGrant); } catch (_) {}
    }
    return true;
  }

  function readCeoGrant() {
    try {
      return localStorage.getItem('denizen-ceo-grant') || null;
    } catch (_) {
      return null;
    }
  }

  function authHeaders(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    if (sessionId) headers['X-Session-Id'] = sessionId;
    if (sessionToken) headers['X-Session-Token'] = sessionToken;
    if (userEmail) headers['X-Email'] = userEmail;
    if (displayName) headers['X-Display-Name'] = displayName;
    if (isCeoPrincipalNow()) {
      headers['X-Access-Method'] = 'ceo';
      // The server verifies the signed grant — bare assertion headers
      // (X-Ceo-Principal etc.) no longer grant anything.
      const grant = readCeoGrant();
      if (grant) headers['X-Denizen-Ceo-Grant'] = grant;
    }
    return headers;
  }

  function textureKeyToNpcKey(textureKey) {
    const roster = globalThis.DenizenNpcRoster;
    if (!roster?.entries) {
      return String(textureKey || '').replace(/^xp_/, '');
    }
    const entry = roster.entries.find((e) => e.textureKey === textureKey);
    if (!entry) return String(textureKey || '').replace(/^xp_/, '');
    return FOLDER_TO_NPC_KEY[entry.folder] || entry.folder;
  }

  function npcKeyToTextureKey(npcKey) {
    const roster = globalThis.DenizenNpcRoster;
    if (!roster?.entries) return npcKey ? `xp_${npcKey}` : null;
    const key = String(npcKey || '').toLowerCase();
    const entry = roster.entries.find((e) => {
      const mapped = FOLDER_TO_NPC_KEY[e.folder] || e.folder;
      return mapped === key || e.folder === key;
    });
    return entry?.textureKey || (key ? `xp_${key}` : null);
  }

  function injectModalStyles() {
    if (document.getElementById('denizen-visitor-session-style')) return;
    const s = document.createElement('style');
    s.id = 'denizen-visitor-session-style';
    s.textContent = `
      #denizen-visitor-name-modal,
      #denizen-demo-account-modal {
        position: fixed;
        inset: 0;
        z-index: 100900;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(2, 6, 23, 0.92);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        pointer-events: auto;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }
      #denizen-demo-account-modal { z-index: 2147483645; }
      #denizen-visitor-name-modal .vis-card {
        background: #020617;
        border: 1px solid #1f2937;
        border-radius: 10px;
        padding: 24px 28px;
        width: min(360px, calc(100vw - 32px));
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
        pointer-events: auto;
        position: relative;
        z-index: 1;
        max-height: calc(100dvh - 32px);
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      #denizen-visitor-name-modal h2 {
        margin: 0 0 8px;
        font-size: 15px;
        font-weight: 700;
        color: #e2e8f0;
      }
      #denizen-visitor-name-modal p {
        margin: 0 0 16px;
        font-size: 12px;
        color: #94a3b8;
      }
      #denizen-visitor-name-modal .vis-input,
      #denizen-visitor-name-input {
        width: 100%;
        box-sizing: border-box;
        background: #1e293b;
        border: 1px solid #1f2937;
        border-radius: 6px;
        color: #e2e8f0;
        padding: 12px 14px;
        font: inherit;
        font-size: 16px;
        outline: none;
        margin-bottom: 14px;
        min-height: 44px;
        touch-action: manipulation;
      }
      #denizen-visitor-name-modal .vis-input:focus,
      #denizen-visitor-name-input:focus {
        border-color: #4ade80;
      }
      #denizen-visitor-name-continue {
        width: 100%;
        background: #4ade80;
        color: #0f172a;
        border: none;
        border-radius: 8px;
        padding: 12px 16px;
        font: inherit;
        font-weight: bold;
        font-size: 14px;
        cursor: pointer;
        min-height: 48px;
        touch-action: manipulation;
      }
      #denizen-visitor-name-continue:hover { background: #22c55e; }
      #denizen-visitor-name-continue:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      #denizen-visitor-name-modal .vis-paths {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 14px;
      }
      #denizen-visitor-name-modal .vis-path-btn {
        width: 100%;
        background: #1e293b;
        color: #e2e8f0;
        border: 1px solid #334155;
        border-radius: 8px;
        padding: 12px 16px;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        text-align: center;
        min-height: 48px;
        touch-action: manipulation;
      }
      #denizen-visitor-name-modal .vis-path-title {
        display: block;
      }
      #denizen-visitor-name-modal .vis-path-btn:hover,
      #denizen-visitor-name-modal .vis-path-btn:active {
        border-color: #4ade80;
        background: #0f172a;
      }
      #denizen-visitor-name-modal .vis-path-btn.ceo {
        border-color: #475569;
        color: #fde68a;
      }
      #denizen-visitor-name-modal .vis-path-btn .vis-path-sub {
        display: block;
        margin-top: 3px;
        font-size: 11px;
        font-weight: 400;
        color: #94a3b8;
      }
      #denizen-visitor-name-modal .vis-path-btn.ceo .vis-path-sub {
        color: #a8a29e;
      }
      #denizen-visitor-name-modal .vis-back {
        background: transparent;
        border: none;
        color: #64748b;
        font: inherit;
        font-size: 11px;
        cursor: pointer;
        text-decoration: underline;
        padding: 0;
        margin-bottom: 12px;
      }
      #denizen-visitor-name-modal .vis-back:hover { color: #94a3b8; }
      #denizen-visitor-name-modal .vis-error {
        margin: 0 0 12px;
        font-size: 11px;
        color: #f87171;
      }
      #denizen-visitor-name-modal .vis-link-row {
        margin-top: 10px;
        font-size: 11px;
        color: #64748b;
        text-align: center;
      }
      #denizen-visitor-name-modal .vis-link {
        background: none;
        border: none;
        color: #7dd3fc;
        font: inherit;
        font-size: 11px;
        cursor: pointer;
        text-decoration: underline;
        padding: 0;
      }
      #denizen-visitor-name-modal .vis-hint {
        margin: -8px 0 12px;
        font-size: 10px;
        color: #64748b;
      }
      #denizen-visitor-name-modal .vis-or {
        margin: 2px 0 10px;
        font-size: 10px;
        color: #475569;
        text-align: center;
      }
      #denizen-visitor-name-modal .vis-team-code-box {
        margin: 12px 0 16px;
        padding: 14px 16px;
        border-radius: 10px;
        border: 1px solid #4ade80;
        background: rgba(20, 83, 45, 0.35);
        text-align: center;
      }
      #denizen-visitor-name-modal .vis-team-code-box .code {
        display: block;
        margin-top: 6px;
        font-size: 28px;
        font-weight: 800;
        letter-spacing: 0.12em;
        color: #bbf7d0;
      }
      html[data-denizen-modal="open"] #game-container,
      html[data-denizen-modal="open"] #game-container canvas,
      html[data-denizen-modal="open"] #denizen-bottom-dock,
      html[data-denizen-modal="open"] #player-chat-fab,
      html[data-denizen-modal="open"] #denizen-mobile-menu-btn,
      html[data-denizen-modal="open"] #denizen-mobile-controls,
      html[data-denizen-modal="open"] #denizen-rotate-hint,
      html[data-denizen-modal="open"] #denizen-ceo-shell,
      html[data-denizen-modal="open"] #denizen-ws-banner,
      html[data-denizen-modal="open"] #denizen-load-banner {
        pointer-events: none !important;
      }
      html[data-denizen-modal="open"] #denizen-rotate-hint,
      html[data-denizen-modal="open"] #denizen-ceo-shell {
        display: none !important;
      }
      html[data-denizen-modal="open"] #denizen-bottom-dock,
      html[data-denizen-modal="open"] #denizen-mobile-menu-btn {
        opacity: 0 !important;
        visibility: hidden !important;
      }
      html[data-denizen-modal="open"] #denizen-visitor-name-modal {
        z-index: 2147483645;
      }
      html.denizen-touch #denizen-visitor-name-modal {
        align-items: flex-end;
        justify-content: center;
        padding: max(12px, env(safe-area-inset-top, 0px))
          max(12px, env(safe-area-inset-right, 0px))
          max(12px, env(safe-area-inset-bottom, 0px))
          max(12px, env(safe-area-inset-left, 0px));
        box-sizing: border-box;
        background: rgba(2, 6, 23, 0.76);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      html.denizen-touch #denizen-visitor-name-modal .vis-card {
        width: min(100%, var(--denizen-panel-max-width, 440px));
        max-height: min(72dvh, calc(100dvh - 28px));
        padding: 18px;
        border-color: #334155;
        border-radius: 16px;
        box-shadow: 0 -14px 42px rgba(0, 0, 0, 0.62);
      }
      html.denizen-touch #denizen-visitor-name-modal h2 {
        font-size: 22px;
        letter-spacing: 0;
      }
      html.denizen-touch #denizen-visitor-name-modal p {
        margin-bottom: 14px;
        font-size: 14px;
        line-height: 1.35;
      }
      html.denizen-touch #denizen-visitor-name-modal .vis-paths {
        gap: 8px;
        margin-bottom: 0;
      }
      html.denizen-touch #denizen-visitor-name-modal .vis-path-btn {
        min-height: 58px;
        padding: 10px 12px;
        text-align: left;
        border-radius: 10px;
        font-size: 15px;
        line-height: 1.2;
      }
      html.denizen-touch #denizen-visitor-name-modal .vis-path-sub {
        margin-top: 2px;
        font-size: 12px;
        line-height: 1.25;
      }
      html.denizen-touch #denizen-visitor-name-modal .vis-path-btn:first-child {
        background: #14532d;
        border-color: #4ade80;
      }
      @media (max-height: 430px) {
        html.denizen-touch #denizen-visitor-name-modal {
          align-items: center;
          padding: 8px;
        }
        html.denizen-touch #denizen-visitor-name-modal .vis-card {
          max-height: calc(100dvh - 16px);
          padding: 12px;
        }
        html.denizen-touch #denizen-visitor-name-modal h2 {
          font-size: 18px;
        }
        html.denizen-touch #denizen-visitor-name-modal p {
          margin-bottom: 8px;
          font-size: 12px;
        }
        html.denizen-touch #denizen-visitor-name-modal .vis-paths {
          gap: 6px;
        }
        html.denizen-touch #denizen-visitor-name-modal .vis-path-btn {
          min-height: 46px;
          padding: 8px 10px;
        }
        html.denizen-touch #denizen-visitor-name-modal .vis-path-sub {
          display: none;
        }
      }
    `;
    document.head.appendChild(s);
  }

  const SESSION_FETCH_MS = 10000;
  const API_FETCH_MS = 8000;
  const CLOUD_AUTH_FETCH_MS = 25000;
  const CLOUD_SESSION_FETCH_MS = 20000;

  function usesTunnelSafeTransport() {
    const host = String(window.location?.hostname || '').toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1') return false;
    return window.location?.protocol === 'https:' || host.endsWith('.dolonia.cloud');
  }

  function isTransientSessionError(err) {
    const msg = String(err?.message || err || '');
    return err?.name === 'AbortError'
      || /timeout|timed out|failed to fetch|network|load failed/i.test(msg);
  }

  function authFetchMs() {
    return usesTunnelSafeTransport() ? CLOUD_AUTH_FETCH_MS : API_FETCH_MS;
  }

  function sessionFetchMs() {
    return usesTunnelSafeTransport() ? CLOUD_SESSION_FETCH_MS : SESSION_FETCH_MS;
  }

  function fetchAbortMessage() {
    if (usesTunnelSafeTransport()) {
      return 'Denizen cloud is not responding in time — the server may be down, restarting, or running old code. Wait a minute, hard-refresh (Ctrl+Shift+R), and try again. If it keeps failing, redeploy and restart denizen.dolonia.cloud.';
    }
    const origin = window.location?.origin || 'this page';
    return `Denizen server timed out (${origin}) — restart with npm start and reload.`;
  }

  function formatTeamAuthError(res, data) {
    const status = Number(res?.status) || 0;
    if (status === 524 || status === 502 || status === 503 || status === 504) {
      if (usesTunnelSafeTransport()) {
        return 'Denizen cloud timed out (proxy 502/524) — restart the Node server on dolonia.cloud, then hard-refresh.';
      }
      return 'Denizen server timed out — restart the server and reload this page.';
    }
    if (status === 404 && usesTunnelSafeTransport()) {
      return 'Login API not found on cloud — deploy the latest Denizen server and restart it, then hard-refresh.';
    }
    return data?.error || `Login failed (${status || 'network'})`;
  }

  function teamAuthHeaderFallback(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (body.username) headers['X-Username'] = String(body.username);
    if (body.password) headers['X-Password'] = String(body.password);
    if (body.email) headers['X-Email'] = String(body.email);
    const code = body.team_code ?? body.teamCode;
    if (code) headers['X-Team-Code'] = String(code);
    const teamName = body.team_name ?? body.teamName;
    if (teamName) headers['X-Team-Name'] = String(teamName);
    const displayName = body.display_name ?? body.displayName;
    if (displayName) headers['X-Display-Name'] = String(displayName);
    return fetchWithTimeout(path, { method: 'GET', headers }, authFetchMs());
  }

  function normalizeFetchError(err) {
    const msg = String(err?.message || err || '');
    if (err?.name === 'AbortError' || /aborted|abort/i.test(msg)) {
      return new Error(fetchAbortMessage());
    }
    if (/failed to fetch|network|load failed/i.test(msg)) {
      const origin = window.location?.origin || 'this page';
      if (usesTunnelSafeTransport()) {
        return new Error(`Cannot reach Denizen at ${origin} — check your connection and hard-refresh.`);
      }
      const port = String(window.location?.port || '8081');
      return new Error(`Cannot reach Denizen server — is it running on http://127.0.0.1:${port} ?`);
    }
    return err instanceof Error ? err : new Error(msg || 'Request failed');
  }

  async function fetchWithTimeout(url, opts = {}, ms = API_FETCH_MS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } catch (err) {
      throw normalizeFetchError(err);
    } finally {
      clearTimeout(timer);
    }
  }

  function formatAccessError(res, data) {
    const status = Number(res?.status) || 0;
    if (status === 524 || status === 502 || status === 503 || status === 504) {
      if (usesTunnelSafeTransport()) {
        return 'Denizen cloud timed out (proxy) — redeploy the app server and hard-refresh.';
      }
      return 'Denizen server timed out — restart the server and reload this page.';
    }
    if (status === 403) {
      return data?.error || 'Invalid access code';
    }
    if (status === 404 && usesTunnelSafeTransport()) {
      return 'Denizen server needs a restart to enable cloud login — run npm start, then hard-refresh.';
    }
    if (status === 0) {
      return 'Cannot reach Denizen server — is it running?';
    }
    return data?.error || `Access denied (${status})`;
  }

  async function verifyAccessCode(code, type) {
    const verifyMs = 15000;
    if (usesTunnelSafeTransport()) {
      const res = await fetchWithTimeout(
        `/api/visitor/access/verify?type=${encodeURIComponent(type)}`,
        {
          method: 'GET',
          headers: { 'X-Visitor-Access-Code': code },
        },
        verifyMs,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(formatAccessError(res, data));
      }
      return data;
    }
    let res;
    try {
      res = await fetchWithTimeout('/api/visitor/access/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, type, kind: type }),
      }, verifyMs);
    } catch (err) {
      if (!isTransientSessionError(err)) throw err;
      res = await fetchWithTimeout(
        `/api/visitor/access/verify?type=${encodeURIComponent(type)}`,
        {
          method: 'GET',
          headers: { 'X-Visitor-Access-Code': code },
        },
        verifyMs,
      );
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(formatAccessError(res, data));
    }
    return data;
  }

  async function teamAuthRequest(path, body) {
    const ms = authFetchMs();
    let res;
    try {
      res = await fetchWithTimeout(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, ms);
    } catch (err) {
      if (!usesTunnelSafeTransport() || !isTransientSessionError(err)) throw err;
      res = await teamAuthHeaderFallback(path, body);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(formatTeamAuthError(res, data));
    }
    return data;
  }

  function showWelcomeModal() {
    injectModalStyles();
    return new Promise((resolve) => {
      if (modalEl) modalEl.remove();
      modalEl = document.createElement('div');
      modalEl.id = 'denizen-visitor-name-modal';
      document.body.appendChild(modalEl);
      document.documentElement.dataset.denizenModal = 'open';

      let step = pendingJoinCode ? 'join-team' : 'choose';
      let pendingAccess = null;
      let busy = false;
      let unbindPress = null;
      let stepUnbinds = [];
      const prefilledTeamCode = pendingJoinCode || null;
      pendingJoinCode = null;

      function applyPrefills() {
        if (!prefilledTeamCode || !modalEl) return;
        const codeEl = modalEl.querySelector('#denizen-visitor-team-code-input');
        if (codeEl && !codeEl.value) codeEl.value = prefilledTeamCode;
      }

      function setGameInputBlocked(block) {
        window.__DenizenGameInputBlocked = !!block;
        const apply = () => {
          try {
            if (window.game?.input) window.game.input.enabled = !block;
          } catch (_) {}
        };
        apply();
        if (!block) {
          [0, 100, 500, 2000, 5000].forEach((ms) => setTimeout(apply, ms));
        }
      }

      function closeModal(result) {
        delete document.documentElement.dataset.denizenModal;
        setGameInputBlocked(false);
        if (unbindPress) {
          unbindPress();
          unbindPress = null;
        }
        stepUnbinds.forEach((fn) => fn());
        stepUnbinds = [];
        modalEl.remove();
        modalEl = null;
        if (result) {
          globalThis.DenizenMobilePlay?.syncLayout?.();
        }
        resolve(result);
      }

      setGameInputBlocked(true);

      function accessCtx() {
        const access = officeConfig?.visitorAccess || {};
        return {
          demoSlug: access.demoOrgSlug || 'acme',
          teamSlug: access.teamOrgSlug || 'zion',
        };
      }

      function focusFirstInput() {
        const selector = (step === 'join-team' && prefilledTeamCode)
          ? '#denizen-visitor-username-input'
          : '.vis-input, #denizen-visitor-name-input';
        const input = modalEl.querySelector(selector);
        if (input) {
          setTimeout(() => {
            try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
          }, 60);
        }
      }

      async function submitAccessCode(type) {
        if (busy) return;
        const input = modalEl.querySelector('#denizen-visitor-code-input');
        const btn = modalEl.querySelector('#denizen-visitor-name-continue');
        const errEl = modalEl.querySelector('#denizen-vis-error');
        const code = String(input?.value || '').trim();
        if (!code) {
          input?.focus();
          return;
        }
        busy = true;
        if (btn) btn.disabled = true;
        if (errEl) errEl.hidden = true;
        const { teamSlug } = accessCtx();
        try {
          const verified = await verifyAccessCode(code, type);
          if (type === 'ceo') {
            if (verified.ceo_grant) {
              try { localStorage.setItem('denizen-ceo-grant', verified.ceo_grant); } catch (_) {}
            }
            try { localStorage.setItem('denizen-onboarding-seen', '1'); } catch (_) {}
            const prior = readStore();
            closeModal({
              displayName: 'Dolonia',
              orgSlug: verified.org_slug || teamSlug,
              tier: 'ceo',
              accessMethod: 'ceo',
              accessGrant: verified.access_grant || null,
            });
            return;
          }
          pendingAccess = {
            orgSlug: verified.org_slug || teamSlug,
            tier: verified.tier || 'team',
            accessMethod: 'team',
            accessGrant: verified.access_grant || null,
          };
          step = 'name';
          render();
        } catch (err) {
          if (errEl) {
            errEl.textContent = err?.message || (type === 'ceo' ? 'Invalid CEO code' : 'Invalid team code');
            errEl.hidden = false;
          }
          if (btn) btn.disabled = false;
          input?.focus();
        } finally {
          busy = false;
        }
      }

      function submitName() {
        if (busy) return;
        const input = modalEl.querySelector('#denizen-visitor-name-input');
        const btn = modalEl.querySelector('#denizen-visitor-name-continue');
        const name = String(input?.value || '').trim();
        if (!name) {
          input?.focus();
          return;
        }
        // Team joins ask for a work email so the session links to the member's
        // own identity instead of an anonymous guest one.
        let email = pendingAccess?.email || null;
        const emailInput = modalEl.querySelector('#denizen-visitor-name-email-input');
        if (emailInput) {
          email = String(emailInput.value || '').trim().toLowerCase() || null;
          const errEl = modalEl.querySelector('#denizen-vis-error');
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            if (errEl) {
              errEl.textContent = 'Enter your work email so your profile stays yours.';
              errEl.hidden = false;
            }
            emailInput.focus();
            return;
          }
          if (errEl) errEl.hidden = true;
        }
        busy = true;
        if (btn) btn.disabled = true;
        closeModal({
          displayName: pendingAccess?.displayName || name,
          orgSlug: pendingAccess?.orgSlug,
          tier: pendingAccess?.tier,
          accessMethod: pendingAccess?.accessMethod,
          accessGrant: pendingAccess?.accessGrant || null,
          email,
          freshPrincipal: true,
        });
      }

      function finishTeamAuth(data, fallbackName, accessMethod = 'website_login') {
        const { teamSlug } = accessCtx();
        const name = String(data.display_name || fallbackName || '').trim();
        const isOwner = data.tier === 'ceo' || !!data.ceo_grant || !!data.is_owner;
        if (data.ceo_grant) {
          try { localStorage.setItem('denizen-ceo-grant', data.ceo_grant); } catch (_) {}
        }
        if (!name && !isOwner) {
          pendingAccess = {
            orgSlug: data.org_slug || teamSlug,
            tier: data.tier || 'team',
            accessMethod,
            accessGrant: data.access_grant || null,
          };
          step = 'name';
          render();
          return;
        }
        const resolvedTier = isOwner ? 'ceo' : (data.tier || 'team');
        closeModal({
          displayName: name || (isOwner ? 'Dolonia' : fallbackName),
          orgSlug: data.org_slug || (resolvedTier === 'demo' ? accessCtx().demoSlug : teamSlug),
          tier: resolvedTier,
          accessMethod: isOwner
            ? 'ceo'
            : (resolvedTier === 'demo' ? (accessMethod || 'demo_login') : accessMethod),
          accessGrant: data.access_grant || null,
          email: data.identity?.email || pendingAccess?.email || null,
          demoUsername: data.username || data.identity?.username || null,
          freshPrincipal: true,
        });
      }

      async function submitLogin() {
        if (busy) return;
        const usernameEl = modalEl.querySelector('#denizen-visitor-username-input');
        const passwordEl = modalEl.querySelector('#denizen-visitor-password-input');
        const emailEl = modalEl.querySelector('#denizen-visitor-email-input');
        const codeEl = modalEl.querySelector('#denizen-visitor-team-code-input');
        const btn = modalEl.querySelector('#denizen-visitor-name-continue');
        const errEl = modalEl.querySelector('#denizen-vis-error');
        const username = String(usernameEl?.value || '').trim();
        const password = String(passwordEl?.value || '');
        const email = String(emailEl?.value || '').trim().toLowerCase();
        const teamCode = String(codeEl?.value || '').trim();
        if (!username) {
          usernameEl?.focus();
          return;
        }
        if (!password) {
          passwordEl?.focus();
          return;
        }
        busy = true;
        if (btn) btn.disabled = true;
        if (errEl) errEl.hidden = true;
        try {
          if (!teamCode && !email) {
            if (errEl) {
              errEl.textContent = 'Team login needs your team code or work email. Demo accounts: use Demo → Log in, or Join a team to upgrade.';
              errEl.hidden = false;
            }
            (teamCode ? codeEl : emailEl)?.focus();
            if (btn) btn.disabled = false;
            busy = false;
            return;
          }
          const data = await teamAuthRequest('/api/visitor/auth/login', {
            username,
            password,
            email: email || undefined,
            team_code: teamCode || undefined,
          });
          finishTeamAuth(data, username);
        } catch (err) {
          if (errEl) {
            errEl.textContent = err?.message || 'Login failed';
            errEl.hidden = false;
          }
          if (btn) btn.disabled = false;
          passwordEl?.focus();
        } finally {
          busy = false;
        }
      }

      async function submitDemoLogin() {
        if (busy) return;
        const usernameEl = modalEl.querySelector('#denizen-visitor-username-input');
        const passwordEl = modalEl.querySelector('#denizen-visitor-password-input');
        const btn = modalEl.querySelector('#denizen-visitor-name-continue');
        const errEl = modalEl.querySelector('#denizen-vis-error');
        const username = String(usernameEl?.value || '').trim();
        const password = String(passwordEl?.value || '');
        if (!username) {
          usernameEl?.focus();
          return;
        }
        if (!password) {
          passwordEl?.focus();
          return;
        }
        busy = true;
        if (btn) btn.disabled = true;
        if (errEl) errEl.hidden = true;
        try {
          const data = await teamAuthRequest('/api/visitor/auth/login-demo', { username, password });
          finishTeamAuth(data, username, 'demo_login');
        } catch (err) {
          if (errEl) {
            errEl.textContent = err?.message || 'Demo login failed';
            errEl.hidden = false;
          }
          if (btn) btn.disabled = false;
          passwordEl?.focus();
        } finally {
          busy = false;
        }
      }

      async function submitJoinTeam() {
        if (busy) return;
        const usernameEl = modalEl.querySelector('#denizen-visitor-username-input');
        const passwordEl = modalEl.querySelector('#denizen-visitor-password-input');
        const emailEl = modalEl.querySelector('#denizen-visitor-email-input');
        const codeEl = modalEl.querySelector('#denizen-visitor-team-code-input');
        const btn = modalEl.querySelector('#denizen-visitor-name-continue');
        const errEl = modalEl.querySelector('#denizen-vis-error');
        const username = String(usernameEl?.value || '').trim();
        const password = String(passwordEl?.value || '');
        const email = String(emailEl?.value || '').trim().toLowerCase();
        const teamCode = String(codeEl?.value || '').trim();
        if (!username || !password || !email || !teamCode) {
          if (!username) usernameEl?.focus();
          else if (!password) passwordEl?.focus();
          else if (!email) emailEl?.focus();
          else codeEl?.focus();
          return;
        }
        busy = true;
        if (btn) btn.disabled = true;
        if (errEl) errEl.hidden = true;
        try {
          const data = await teamAuthRequest('/api/visitor/auth/register', {
            username,
            password,
            email,
            display_name: username,
            team_code: teamCode,
          });
          finishTeamAuth(data, username, 'website_register');
        } catch (err) {
          if (errEl) {
            const msg = String(err?.message || 'Could not join team');
            errEl.textContent = /already (exists|registered)/i.test(msg)
              ? `${msg} — use Log in with team code ${teamCode || '1921'}, your email, and password.`
              : msg;
            errEl.hidden = false;
          }
          if (btn) btn.disabled = false;
        } finally {
          busy = false;
        }
      }

      async function submitCreateTeam() {
        if (busy) return;
        const teamEl = modalEl.querySelector('#denizen-visitor-team-name-input');
        const usernameEl = modalEl.querySelector('#denizen-visitor-username-input');
        const passwordEl = modalEl.querySelector('#denizen-visitor-password-input');
        const emailEl = modalEl.querySelector('#denizen-visitor-email-input');
        const btn = modalEl.querySelector('#denizen-visitor-name-continue');
        const errEl = modalEl.querySelector('#denizen-vis-error');
        const teamName = String(teamEl?.value || '').trim();
        const username = String(usernameEl?.value || '').trim();
        const password = String(passwordEl?.value || '');
        const email = String(emailEl?.value || '').trim().toLowerCase();
        if (!teamName || !username || !password || !email) {
          if (!teamName) teamEl?.focus();
          else if (!username) usernameEl?.focus();
          else if (!password) passwordEl?.focus();
          else emailEl?.focus();
          return;
        }
        busy = true;
        if (btn) btn.disabled = true;
        if (errEl) errEl.hidden = true;
        try {
          const data = await teamAuthRequest('/api/visitor/auth/create-team', {
            team_name: teamName,
            username,
            password,
            email,
            display_name: username,
          });
          pendingAccess = {
            orgSlug: data.org_slug,
            tier: data.tier || 'team',
            accessMethod: 'team_create',
            accessGrant: data.access_grant || null,
            email: data.identity?.email || email,
            displayName: data.display_name || username,
            teamCode: data.team_code,
            teamName: data.team_name || teamName,
          };
          step = 'team-created';
          render();
        } catch (err) {
          if (errEl) {
            errEl.textContent = err?.message || 'Could not create team';
            errEl.hidden = false;
          }
          if (btn) btn.disabled = false;
        } finally {
          busy = false;
        }
      }

      function finishCreateTeam() {
        if (!pendingAccess?.accessGrant) return;
        closeModal({
          displayName: pendingAccess.displayName,
          orgSlug: pendingAccess.orgSlug,
          tier: pendingAccess.tier,
          accessMethod: pendingAccess.accessMethod,
          accessGrant: pendingAccess.accessGrant,
          email: pendingAccess.email,
          freshPrincipal: true,
        });
      }

      async function handleAction(action) {
        const { demoSlug } = accessCtx();
        if (action === 'path-demo') {
          pendingAccess = { accessMethod: 'demo', orgSlug: demoSlug, tier: 'demo' };
          step = 'demo-email';
          render();
          return;
        }
        if (action === 'path-login') {
          pendingAccess = { accessMethod: 'website_login' };
          step = 'login';
          render();
          return;
        }
        if (action === 'path-demo-login') {
          pendingAccess = { accessMethod: 'demo_login' };
          step = 'demo-login';
          render();
          return;
        }
        if (action === 'goto-create-team') {
          step = 'create-team';
          render();
          return;
        }
        if (action === 'goto-join-team') {
          step = 'join-team';
          render();
          return;
        }
        if (action === 'goto-login') {
          step = 'login';
          render();
          return;
        }
        if (action === 'finish-create-team') {
          finishCreateTeam();
          return;
        }
        if (action === 'submit-demo-email') {
          if (busy) return;
          const emailEl = modalEl.querySelector('#denizen-visitor-email-input');
          const errEl = modalEl.querySelector('#denizen-vis-error');
          const email = String(emailEl?.value || '').trim().toLowerCase();
          if (!email || !email.includes('@')) {
            if (errEl) {
              errEl.textContent = 'Enter a valid email';
              errEl.hidden = false;
            }
            emailEl?.focus();
            return;
          }
          if (errEl) errEl.hidden = true;
          pendingAccess = { ...pendingAccess, email };
          step = 'name';
          render();
          return;
        }
        if (action === 'back') {
          if (step === 'name') {
            if (pendingAccess?.accessMethod === 'demo') step = 'demo-email';
            else step = 'login';
          } else if (step === 'demo-login') {
            step = pendingAccess?.accessMethod === 'demo' ? 'demo-email' : 'choose';
          } else if (step === 'join-team' || step === 'create-team' || step === 'team-created') {
            step = 'login';
          } else {
            step = 'choose';
          }
          render();
          return;
        }
        if (action === 'submit-login') {
          await submitLogin();
          return;
        }
        if (action === 'submit-demo-login') {
          await submitDemoLogin();
          return;
        }
        if (action === 'submit-join-team') {
          await submitJoinTeam();
          return;
        }
        if (action === 'submit-create-team') {
          await submitCreateTeam();
          return;
        }
        if (action === 'submit-name') {
          submitName();
        }
      }

      const onModalActivate = (btn) => {
        if (!btn || btn.disabled || busy) return;
        handleAction(btn.getAttribute('data-action'));
      };

      modalEl.addEventListener('click', (e) => {
        if (window.DenizenTouchBind?.bindPress) return;
        const btn = e.target.closest('[data-action]');
        if (!btn || btn.disabled || busy) return;
        e.preventDefault();
        e.stopPropagation();
        onModalActivate(btn);
      });

      modalEl.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const tag = e.target?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') return;
        e.preventDefault();
        if (step === 'demo-email') handleAction('submit-demo-email');
        else if (step === 'login') handleAction('submit-login');
        else if (step === 'demo-login') handleAction('submit-demo-login');
        else if (step === 'join-team') handleAction('submit-join-team');
        else if (step === 'create-team') handleAction('submit-create-team');
        else if (step === 'team-created') handleAction('finish-create-team');
        else if (step === 'name') handleAction('submit-name');
      });

      function wireStepControls() {
        stepUnbinds.forEach((fn) => fn());
        stepUnbinds = [];
        if (!window.DenizenTouchBind?.bindPress) return;
        modalEl.querySelectorAll('[data-action]').forEach((btn) => {
          const off = window.DenizenTouchBind.bindPress(
            btn,
            (e) => {
              e?.preventDefault?.();
              onModalActivate(btn);
            },
            { stop: true },
          );
          if (typeof off === 'function') stepUnbinds.push(off);
        });
      }

      function render() {
        document.body.appendChild(modalEl);

        let focusAfter = false;

        if (step === 'choose') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <h2>Welcome to Denizen</h2>
              <p>Sign in to your team workspace, or try the demo.</p>
              <div class="vis-paths">
                <button type="button" class="vis-path-btn" data-action="path-login"><span class="vis-path-title">Login</span><span class="vis-path-sub">Username, password, and team code or email</span></button>
                <button type="button" class="vis-path-btn" data-action="path-demo"><span class="vis-path-title">Demo</span><span class="vis-path-sub">Explore with your email — no team required</span></button>
              </div>
            </div>
          `;
        } else if (step === 'login') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <button type="button" class="vis-back" data-action="back">← Back</button>
              <h2>Login</h2>
              <p>Sign in with your username and password. Use your team code or email to find your workspace.</p>
              <p class="vis-error" id="denizen-vis-error" hidden></p>
              <input class="vis-input" id="denizen-visitor-username-input" type="text" maxlength="64" placeholder="Username" autocomplete="username" />
              <input class="vis-input" id="denizen-visitor-password-input" type="password" maxlength="128" placeholder="Password" autocomplete="current-password" />
              <input class="vis-input" id="denizen-visitor-team-code-input" type="text" maxlength="32" placeholder="Team code" autocomplete="off" />
              <p class="vis-or">or</p>
              <input class="vis-input" id="denizen-visitor-email-input" type="email" maxlength="120" placeholder="Email" autocomplete="email" inputmode="email" />
              <button type="button" id="denizen-visitor-name-continue" data-action="submit-login">Log in</button>
              <div class="vis-link-row">No team yet? <button type="button" class="vis-link" data-action="goto-create-team">Create a team</button></div>
              <div class="vis-link-row">Have a code but no account? <button type="button" class="vis-link" data-action="goto-join-team">Join a team</button></div>
              <div class="vis-link-row">On a demo account? <button type="button" class="vis-link" data-action="goto-join-team">Join your team</button></div>
            </div>
          `;
          focusAfter = true;
        } else if (step === 'create-team') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <button type="button" class="vis-back" data-action="back">← Back</button>
              <h2>Create your team</h2>
              <p>Start a new workspace. You'll get a team code to share with teammates.</p>
              <p class="vis-error" id="denizen-vis-error" hidden></p>
              <input class="vis-input" id="denizen-visitor-team-name-input" type="text" maxlength="120" placeholder="Team name" autocomplete="organization" />
              <input class="vis-input" id="denizen-visitor-username-input" type="text" maxlength="64" placeholder="Your username" autocomplete="username" />
              <input class="vis-input" id="denizen-visitor-email-input" type="email" maxlength="120" placeholder="Your email" autocomplete="email" inputmode="email" />
              <input class="vis-input" id="denizen-visitor-password-input" type="password" maxlength="128" placeholder="${passwordPlaceholder()}" autocomplete="new-password" />
              <button type="button" id="denizen-visitor-name-continue" data-action="submit-create-team">Create team</button>
              <div class="vis-link-row">Already have an account? <button type="button" class="vis-link" data-action="goto-login">Log in</button></div>
            </div>
          `;
          focusAfter = true;
        } else if (step === 'join-team') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <button type="button" class="vis-back" data-action="back">← Back</button>
              <h2>Join a team</h2>
              <p>${prefilledTeamCode
    ? 'You\'ve been invited to join the team. Pick a username, work email, and password (separate from any demo login).'
    : 'Enter the team code from your invite, then pick a username, work email, and password. Demo logins do not carry over — create team credentials here.'}</p>
              <p class="vis-error" id="denizen-vis-error" hidden></p>
              <input class="vis-input" id="denizen-visitor-team-code-input" type="text" maxlength="32" placeholder="Team code" autocomplete="off" value="${prefilledTeamCode ? String(prefilledTeamCode).replace(/"/g, '&quot;') : ''}" />
              <input class="vis-input" id="denizen-visitor-username-input" type="text" maxlength="64" placeholder="Username" autocomplete="username" />
              <input class="vis-input" id="denizen-visitor-email-input" type="email" maxlength="120" placeholder="Your email" autocomplete="email" inputmode="email" />
              <input class="vis-input" id="denizen-visitor-password-input" type="password" maxlength="128" placeholder="${passwordPlaceholder()}" autocomplete="new-password" />
              <button type="button" id="denizen-visitor-name-continue" data-action="submit-join-team">Join team</button>
              <div class="vis-link-row">Already registered? <button type="button" class="vis-link" data-action="goto-login">Log in</button></div>
            </div>
          `;
          focusAfter = true;
        } else if (step === 'team-created') {
          const code = pendingAccess?.teamCode || '------';
          const teamLabel = pendingAccess?.teamName || 'Your team';
          modalEl.innerHTML = `
            <div class="vis-card">
              <h2>${teamLabel} is ready</h2>
              <p>Share this team code so others can join. Save it somewhere safe.</p>
              <div class="vis-team-code-box">
                <span>Team code</span>
                <span class="code">${code}</span>
              </div>
              <button type="button" id="denizen-visitor-name-continue" data-action="finish-create-team">Enter Denizen</button>
            </div>
          `;
        } else if (step === 'demo-login') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <button type="button" class="vis-back" data-action="back">← Back</button>
              <h2>Demo login</h2>
              <p>Pick up your saved demo with the username and password you created.</p>
              <p class="vis-error" id="denizen-vis-error" hidden></p>
              <input class="vis-input" id="denizen-visitor-username-input" type="text" maxlength="64" placeholder="Username" autocomplete="username" />
              <input class="vis-input" id="denizen-visitor-password-input" type="password" maxlength="128" placeholder="Password" autocomplete="current-password" />
              <button type="button" id="denizen-visitor-name-continue" data-action="submit-demo-login">Log in</button>
            </div>
          `;
          focusAfter = true;
        } else if (step === 'demo-email') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <button type="button" class="vis-back" data-action="back">← Back</button>
              <h2>Demo</h2>
              <p>Enter your email so we can save your progress. After you explore a bit, you can create a username and password.</p>
              <p class="vis-error" id="denizen-vis-error" hidden></p>
              <input class="vis-input" id="denizen-visitor-email-input" type="email" maxlength="120" placeholder="you@email.com" autocomplete="email" inputmode="email" />
              <button type="button" id="denizen-visitor-name-continue" data-action="submit-demo-email">Continue</button>
              <div class="vis-link-row">Already created a demo account? <button type="button" class="vis-link" data-action="path-demo-login">Log in</button></div>
            </div>
          `;
          focusAfter = true;
        } else if (step === 'name') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <button type="button" class="vis-back" data-action="back">← Back</button>
              <h2>Welcome to Denizen</h2>
              <p>What's your name?</p>
              <input class="vis-input" id="denizen-visitor-name-input" type="text" maxlength="64" placeholder="Your name" autocomplete="name" />
              <p class="vis-error" id="denizen-vis-error" hidden></p>
              <button type="button" id="denizen-visitor-name-continue" data-action="submit-name">Continue</button>
            </div>
          `;
          focusAfter = true;
        }

        wireStepControls();
        applyPrefills();
        if (focusAfter) focusFirstInput();
      }

      render();
      fetchOfficeConfig().then(() => render());
    });
  }

  function showDemoAccountModal() {
    injectModalStyles();
    return fetchOfficeConfig().then(() => new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.id = 'denizen-demo-account-modal';
      overlay.innerHTML = `
        <div class="vis-card">
          <h2>Save your demo progress</h2>
          <p>Create a username and password so you can return to this profile anytime.</p>
          <p class="vis-error" id="denizen-demo-acct-error" hidden></p>
          <input class="vis-input" id="denizen-demo-username-input" type="text" maxlength="64" placeholder="Username" autocomplete="username" />
          <input class="vis-input" id="denizen-demo-password-input" type="password" maxlength="128" placeholder="${passwordPlaceholder()}" autocomplete="new-password" />
          <input class="vis-input" id="denizen-demo-password2-input" type="password" maxlength="128" placeholder="Confirm password" autocomplete="new-password" />
          <button type="button" id="denizen-visitor-name-continue">Create account</button>
          <div class="vis-link-row"><button type="button" class="vis-link" data-demo-skip>Not now</button></div>
        </div>
      `;
      document.body.appendChild(overlay);
      document.documentElement.dataset.denizenModal = 'open';

      let busy = false;
      const close = (result) => {
        delete document.documentElement.dataset.denizenModal;
        overlay.remove();
        resolve(result || null);
      };

      const errEl = overlay.querySelector('#denizen-demo-acct-error');
      const saveBtn = overlay.querySelector('#denizen-visitor-name-continue');
      const skipBtn = overlay.querySelector('[data-demo-skip]');

      const submit = async () => {
        if (busy) return;
        const username = String(overlay.querySelector('#denizen-demo-username-input')?.value || '').trim();
        const password = String(overlay.querySelector('#denizen-demo-password-input')?.value || '');
        const password2 = String(overlay.querySelector('#denizen-demo-password2-input')?.value || '');
        if (!username || password.length < minPasswordLen()) {
          if (errEl) {
            errEl.textContent = `Choose a username and password (${minPasswordLen()}+ characters).`;
            errEl.hidden = false;
          }
          return;
        }
        if (password !== password2) {
          if (errEl) {
            errEl.textContent = 'Passwords do not match.';
            errEl.hidden = false;
          }
          return;
        }
        busy = true;
        if (saveBtn) saveBtn.disabled = true;
        if (errEl) errEl.hidden = true;
        try {
          const data = await teamAuthRequest('/api/visitor/auth/register-demo', {
            session_id: sessionId,
            session_token: sessionToken,
            username,
            password,
          });
          displayName = data.display_name || username;
          writeStore({
            ...readStore(),
            display_name: displayName,
            demo_username: data.username || username,
          });
          try {
            document.dispatchEvent(new CustomEvent('denizen-demo-account-created', {
              detail: { username: data.username || username },
            }));
          } catch (_) {}
          close({ ok: true, username: data.username || username, display_name: displayName });
        } catch (err) {
          if (errEl) {
            errEl.textContent = err?.message || 'Could not create account';
            errEl.hidden = false;
          }
          if (saveBtn) saveBtn.disabled = false;
        } finally {
          busy = false;
        }
      };

      saveBtn?.addEventListener('click', submit);
      skipBtn?.addEventListener('click', () => close(null));
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') close(null);
      });
      setTimeout(() => overlay.querySelector('#denizen-demo-username-input')?.focus(), 60);
    }));
  }

  async function apiJson(url, opts = {}) {
    const headers = authHeaders(opts.headers || {});
    const res = await fetch(url, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  function requireSessionId() {
    if (!sessionId) throw new Error('Session not ready');
    return sessionId;
  }

  async function touchSession(name, opts = {}) {
    if (opts.freshPrincipal) {
      announceProfileSwitching({
        displayName: name,
        email: opts.email || null,
        tier: opts.tier || null,
        accessMethod: opts.accessMethod || null,
        orgSlug: opts.orgSlug || null,
      });
      clearActiveSessionMemory();
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    }
    const body = { display_name: name };
    if (sessionId) body.session_id = sessionId;
    if (sessionToken) body.session_token = sessionToken;
    if (opts.accessGrant) body.access_grant = opts.accessGrant;
    if (opts.email) body.email = opts.email;
    const meta = {};
    if (opts.accessMethod) meta.access_method = opts.accessMethod;
    if (Object.keys(meta).length) body.metadata = meta;
    if (opts.accessMethod === 'ceo' || isCeoPrincipalNow()) {
      const grant = readCeoGrant();
      if (grant) body.ceo_grant = grant;
    }
    if (opts.tier === 'demo' || opts.accessMethod === 'demo' || opts.accessMethod === 'demo_login') {
      body.demo = true;
      try { localStorage.removeItem('denizen-ceo-grant'); } catch (_) {}
    } else if (opts.orgSlug) {
      body.org_slug = opts.orgSlug;
    }
    let res;
    if (usesTunnelSafeTransport()) {
      const headers = authHeaders();
      headers['X-Display-Name'] = name;
      if (opts.accessGrant) headers['X-Access-Grant'] = opts.accessGrant;
      if (opts.email) headers['X-Email'] = opts.email;
      if (opts.orgSlug) headers['X-Org-Slug'] = opts.orgSlug;
      if (opts.accessMethod) headers['X-Access-Method'] = opts.accessMethod;
      if (opts.accessMethod === 'ceo') headers['X-Ceo-Principal'] = '1';
      if (opts.tier === 'demo' || opts.accessMethod === 'demo') headers['X-Demo'] = '1';
      if (sessionId) headers['X-Session-Id'] = sessionId;
      if (sessionToken) headers['X-Session-Token'] = sessionToken;
      res = await fetchWithTimeout('/api/visitor/session/open', {
        method: 'GET',
        headers,
      }, sessionFetchMs());
    } else {
      try {
        res = await fetchWithTimeout('/api/visitor/session', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(body),
        }, sessionFetchMs());
      } catch (err) {
        if (!isTransientSessionError(err)) throw err;
        const headers = authHeaders();
        headers['X-Display-Name'] = name;
        if (opts.accessGrant) headers['X-Access-Grant'] = opts.accessGrant;
        if (opts.email) headers['X-Email'] = opts.email;
        if (opts.orgSlug) headers['X-Org-Slug'] = opts.orgSlug;
        if (opts.accessMethod) headers['X-Access-Method'] = opts.accessMethod;
        if (opts.tier === 'demo' || opts.accessMethod === 'demo') headers['X-Demo'] = '1';
        if (sessionId) headers['X-Session-Id'] = sessionId;
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        res = await fetchWithTimeout('/api/visitor/session/open', {
          method: 'GET',
          headers,
        }, sessionFetchMs());
      }
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Session sync failed (${res.status})`);
    }
    const data = await res.json();
    const session = data.session || data;
    if (opts.accessMethod === 'ceo') {
      tier = 'ceo';
      displayName = String(name || session.display_name || opts.displayName || 'Dolonia').trim();
    } else {
      if (session.display_name) displayName = session.display_name;
      if (opts.tier) tier = opts.tier;
    }
    if (session.id) sessionId = session.id;
    if (data.session_token) sessionToken = data.session_token;
    if (data.ceo_grant) {
      try { localStorage.setItem('denizen-ceo-grant', data.ceo_grant); } catch (_) {}
    }
    if (opts.orgSlug) orgSlug = opts.orgSlug;
    if (opts.accessMethod) accessMethod = opts.accessMethod;
    if (data.identity?.id) identityId = data.identity.id;
    if (data.identity?.email) userEmail = data.identity.email;
    else if (opts.email) userEmail = opts.email;
    const store = {
      session_id: sessionId,
      session_token: sessionToken || null,
      display_name: displayName,
      tier: tier || opts.tier || null,
      org_slug: orgSlug || data.org?.slug || opts.orgSlug || null,
      access_method: accessMethod || opts.accessMethod || readStore().access_method || null,
      identity_id: identityId || data.identity?.id || null,
      email: userEmail || opts.email || null,
      demo_username: opts.demoUsername || data.identity?.username || readStore().demo_username || null,
    };
    writeStore(store);
    return session;
  }

  async function refreshSessionSettings() {
    if (!sessionId) return;
    try {
      const res = await fetchWithTimeout(
        `/api/visitor/settings?session_id=${encodeURIComponent(sessionId)}`,
        { headers: authHeaders() },
        SESSION_FETCH_MS,
      );
      if (!res.ok) return;
      const data = await res.json();
      const s = data.settings || {};
      teamRole = s.team_role || null;
      canApproveSkills = !!s.can_approve_skills;
      workPosition = s.work_position || null;
      if (s.is_ceo_principal || s.team_role === 'owner' || s.team_role === 'ceo' || s.tier === 'ceo') {
        teamRole = s.team_role === 'ceo' ? 'owner' : (teamRole || 'owner');
        canApproveSkills = true;
        applyOwnerPrincipalState({ isCeoPrincipal: true, ceoGrant: s.ceo_grant || null });
      }
      if (s.has_demo_account && s.demo_username) {
        writeStore({ ...readStore(), demo_username: s.demo_username });
      }
      try {
        document.dispatchEvent(new CustomEvent('denizen-visitor-profile-updated', {
          detail: DenizenVisitorSession.getProfile(),
        }));
      } catch (_) {}
    } catch (_) {}
  }

  const DenizenVisitorSession = {
    STORAGE_KEY,
    PROTECTED_NPC_KEYS,
    textureKeyToNpcKey,
    npcKeyToTextureKey,

    getSessionId() {
      return sessionId;
    },

    getSessionToken() {
      return sessionToken || null;
    },

    getDisplayName() {
      if (isCeoPrincipalNow()) return 'Dolonia';
      return displayName || readStore().display_name || 'Guest';
    },

    getMinPasswordLength() {
      return minPasswordLen();
    },

    getAssistant() {
      return assistant;
    },

    async refreshAssistant() {
      if (!sessionId) return null;
      try {
        const res = await fetchWithTimeout(
          `/api/visitor/assistant?session_id=${encodeURIComponent(sessionId)}`,
        );
        if (!res.ok) {
          assistant = null;
          return null;
        }
        const data = await res.json();
        assistant = data.assistant || null;
        return assistant;
      } catch (err) {
        console.warn('[DenizenVisitorSession] refreshAssistant failed:', err?.message || err);
        return assistant;
      }
    },

    async getNpcTeam() {
      const sid = requireSessionId();
      const res = await fetchWithTimeout(
        `/api/visitor/npc-team?session_id=${encodeURIComponent(sid)}`,
        { headers: authHeaders() },
        SESSION_FETCH_MS,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `NPC team request failed (${res.status})`);
      }
      return {
        team: data.team || null,
        orgTeam: data.org_team || null,
        canManageOrg: !!data.can_manage_org,
      };
    },

    async getOrgNpcTeam() {
      const sid = requireSessionId();
      const res = await fetchWithTimeout(
        `/api/visitor/org-npc-team?session_id=${encodeURIComponent(sid)}`,
        { headers: authHeaders() },
        SESSION_FETCH_MS,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Org NPC team request failed (${res.status})`);
      }
      return {
        orgTeam: data.org_team || null,
        canManage: !!data.can_manage,
      };
    },

    async saveOrgNpcTeam(payload = {}) {
      const sid = requireSessionId();
      const res = await fetchWithTimeout('/api/visitor/org-npc-team', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          session_id: sid,
          name: payload.name,
          purpose: payload.purpose,
          settings: payload.settings || undefined,
        }),
      }, SESSION_FETCH_MS);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Org NPC team save failed (${res.status})`);
      }
      return data.org_team || null;
    },

    async saveOrgNpcTeamMember(payload = {}) {
      const sid = requireSessionId();
      const res = await fetchWithTimeout('/api/visitor/org-npc-team', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          session_id: sid,
          action: 'member',
          npc_key: payload.npcKey || payload.npc_key,
          display_name: payload.displayName || payload.display_name,
          role: payload.role,
          job: payload.job,
          focus: payload.focus,
          instructions: payload.instructions,
          soul_snippet: payload.soulSnippet ?? payload.soul_snippet,
          personality: payload.personality,
          extra_skills: payload.extraSkills ?? payload.extra_skills,
          sort_order: payload.sortOrder ?? payload.sort_order,
          active: payload.active,
          remove: payload.remove,
          settings: payload.settings || undefined,
        }),
      }, SESSION_FETCH_MS);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Org NPC member save failed (${res.status})`);
      }
      return data.org_team || null;
    },

    async listChatThreads() {
      const sid = requireSessionId();
      const res = await fetchWithTimeout(
        `/api/visitor/chat/threads?session_id=${encodeURIComponent(sid)}`,
        { headers: authHeaders() },
        SESSION_FETCH_MS,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Chat threads request failed (${res.status})`);
      }
      return Array.isArray(data.threads) ? data.threads : [];
    },

    async getChatHistory(threadId) {
      const sid = requireSessionId();
      const res = await fetchWithTimeout(
        `/api/visitor/chat/history?session_id=${encodeURIComponent(sid)}&thread_id=${encodeURIComponent(threadId)}`,
        { headers: authHeaders() },
        SESSION_FETCH_MS,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Chat history request failed (${res.status})`);
      }
      return Array.isArray(data.messages) ? data.messages : [];
    },

    async createGroupChat(payload = {}) {
      const sid = requireSessionId();
      const res = await fetchWithTimeout('/api/visitor/chat/groups', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          session_id: sid,
          name: payload.name,
          member_npc_keys: payload.member_npc_keys || payload.memberNpcKeys || payload.npc_keys,
        }),
      }, SESSION_FETCH_MS);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Group chat API missing — restart the Denizen server, then hard-refresh (Ctrl+Shift+R).');
        }
        throw new Error(data.error || `Group chat create failed (${res.status})`);
      }
      return data;
    },

    async saveNpcTeam(payload = {}) {
      const sid = requireSessionId();
      const res = await fetchWithTimeout('/api/visitor/npc-team', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          session_id: sid,
          name: payload.name,
          purpose: payload.purpose,
          settings: payload.settings || undefined,
        }),
      }, SESSION_FETCH_MS);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `NPC team save failed (${res.status})`);
      }
      return data.team || null;
    },

    async saveNpcTeamMember(payload = {}) {
      const sid = requireSessionId();
      const res = await fetchWithTimeout('/api/visitor/npc-team/member', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          session_id: sid,
          npc_key: payload.npcKey || payload.npc_key,
          display_name: payload.displayName || payload.display_name,
          role: payload.role,
          job: payload.job,
          focus: payload.focus,
          instructions: payload.instructions,
          soul_snippet: payload.soulSnippet ?? payload.soul_snippet,
          personality: payload.personality,
          extra_skills: payload.extraSkills ?? payload.extra_skills,
          sort_order: payload.sortOrder ?? payload.sort_order,
          active: payload.active,
          remove: payload.remove,
          settings: payload.settings || undefined,
        }),
      }, SESSION_FETCH_MS);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `NPC team member save failed (${res.status})`);
      }
      return data.team || null;
    },

    async addNpcTeamMembers(npcKeys = [], opts = {}) {
      const keys = (Array.isArray(npcKeys) ? npcKeys : [])
        .map((k) => String(k || '').trim().toLowerCase())
        .filter(Boolean);
      if (!keys.length) {
        throw new Error('No NPCs selected');
      }

      async function addOneByOne() {
        const added = [];
        const errors = [];
        let team = null;
        for (const npcKey of keys) {
          try {
            team = await DenizenVisitorSession.saveNpcTeamMember({
              npcKey,
              role: opts.role || 'assistant',
              displayName: opts.displayName,
            });
            added.push(npcKey);
          } catch (err) {
            errors.push({ npc_key: npcKey, error: err?.message || String(err) });
          }
        }
        if (!added.length) {
          throw new Error(errors[0]?.error || 'Could not add NPCs to your team');
        }
        return {
          ok: true,
          added,
          errors,
          team: team || (await DenizenVisitorSession.getNpcTeam())?.team || null,
        };
      }

      // One NPC — use the member route directly (most reliable on desktop).
      if (keys.length === 1) {
        try {
          return await addOneByOne();
        } catch (singleErr) {
          // Fall through to batch attempts below.
          if (!usesTunnelSafeTransport()) throw singleErr;
        }
      }

      const sid = requireSessionId();
      const payload = {
        session_id: sid,
        npc_keys: keys,
        role: opts.role,
        display_name: opts.displayName,
        action: 'batch_add',
      };

      async function tryBatchPost(url) {
        const res = await fetchWithTimeout(url, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(payload),
        }, SESSION_FETCH_MS);
        const data = await res.json().catch(() => ({}));
        return { res, data };
      }

      const batchUrls = [
        '/api/visitor/npc-team',
        '/api/visitor/npc-team/members/batch',
        '/api/visitor/npc-team/member',
      ];
      let lastError = 'Batch add failed';
      for (const url of batchUrls) {
        const { res, data } = await tryBatchPost(url);
        if (res.ok && Array.isArray(data?.added)) {
          return data;
        }
        if (res.ok && data?.team && keys.length === 1) {
          const member = (data.team.members || []).find(
            (m) => String(m.npc_key).toLowerCase() === keys[0],
          );
          if (member) {
            return { ok: true, added: [keys[0]], errors: data.errors || [], team: data.team };
          }
        }
        lastError = data?.error || `Batch add failed (${res.status})`;
        if (res.status === 404 || res.status === 405) continue;
        if (res.status >= 400 && res.status < 500) break;
      }

      return addOneByOne();
    },

    async getNpcTeamMemberSoul(npcKey) {
      const sid = requireSessionId();
      const normKey = String(npcKey || '').trim().toLowerCase();
      const keyQ = encodeURIComponent(normKey);
      const sidQ = encodeURIComponent(sid);

      function pickSoul(data) {
        return (data?.soul && typeof data.soul === 'object') ? data.soul : null;
      }

      function soulGetHeaders() {
        return {
          ...authHeaders(),
          'X-Denizen-Npc-Soul': '1',
        };
      }

      async function tryGet(url) {
        const res = await fetchWithTimeout(url, { headers: soulGetHeaders() }, SESSION_FETCH_MS);
        const data = await res.json().catch(() => ({}));
        return { res, data, soul: pickSoul(data) };
      }

      async function tryPost(url, extra = {}) {
        const res = await fetchWithTimeout(url, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            session_id: sid,
            npc_key: normKey,
            ...extra,
          }),
        }, SESSION_FETCH_MS);
        const data = await res.json().catch(() => ({}));
        return { res, data, soul: pickSoul(data) };
      }

      const attempts = [
        () => tryPost('/api/visitor/npc-team/member', { action: 'soul' }),
        () => tryPost('/api/visitor/npc-team', { action: 'soul' }),
        () => tryGet(`/api/visitor/npc-team?session_id=${sidQ}&npc_key=${keyQ}&soul=1`),
        () => tryGet(`/api/visitor/npc-team/member/soul?session_id=${sidQ}&npc_key=${keyQ}`),
      ];

      let lastErr = 'Live SOUL/MEMORY unavailable — restart denizen/server.js';
      for (const attempt of attempts) {
        const { res, data, soul } = await attempt();
        if (soul) return soul;
        if (!res.ok) {
          lastErr = data?.error || `Soul view failed (${res.status})`;
          if (res.status === 404 || res.status === 405) continue;
          if (res.status >= 400 && res.status < 500) break;
        }
      }

      throw new Error(lastErr);
    },

    async claimNpc(npcKey, opts = {}) {
      if (!sessionId) throw new Error('Session not ready');
      const key = String(npcKey || '').toLowerCase();
      if (PROTECTED_NPC_KEYS.has(key)) {
        throw new Error(`${key} cannot be claimed`);
      }
      const res = await fetch('/api/visitor/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          npc_key: key,
          assistant_name: opts.assistantName || null,
          focus: opts.focus || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Claim failed (${res.status})`);
      }
      assistant = data.assistant || {
        npc_key: key,
        assistant_name: opts.assistantName || key,
        focus: opts.focus || null,
      };
      if (DenizenVisitorSession.isDemo()) {
        try { document.dispatchEvent(new CustomEvent('denizen-demo-engaged')); } catch (_) {}
      }
      return assistant;
    },

    async releaseAssistant() {
      if (!sessionId) throw new Error('Session not ready');
      const res = await fetch('/api/visitor/assistant', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Release failed (${res.status})`);
      }
      assistant = null;
      return data;
    },

    isMyAssistant(npcKeyOrTexture) {
      if (!assistant?.npc_key) return false;
      const mine = String(assistant.npc_key).toLowerCase();
      const other = String(npcKeyOrTexture || '').toLowerCase();
      if (other === mine) return true;
      if (other.startsWith('xp_')) {
        return textureKeyToNpcKey(other) === mine;
      }
      return npcKeyToTextureKey(mine) === other || mine === other;
    },

    isProtectedNpc(npcKeyOrTexture) {
      const key = npcKeyOrTexture?.startsWith?.('xp_')
        ? textureKeyToNpcKey(npcKeyOrTexture)
        : String(npcKeyOrTexture || '').toLowerCase();
      return PROTECTED_NPC_KEYS.has(key);
    },

    isCeoMode() {
      return isCeoPrincipalNow();
    },

    getTier() {
      if (isCeoPrincipalNow()) return 'ceo';
      return tier || readStore().tier || null;
    },

    isDemo() {
      return DenizenVisitorSession.getTier() === 'demo';
    },

    hasDemoAccount() {
      return !!(readStore().demo_username);
    },

    showDemoAccountModal() {
      return showDemoAccountModal();
    },

    isTeam() {
      return DenizenVisitorSession.getTier() === 'team';
    },

    getAccessMethod() {
      return accessMethod || readStore().access_method || null;
    },

    isCeoPrincipal() {
      return isCeoPrincipalNow();
    },

    authHeaders(extra = {}) {
      return authHeaders(extra);
    },

    getOrgSlug() {
      return orgSlug || readStore().org_slug || null;
    },

    getIdentityId() {
      return identityId || readStore().identity_id || null;
    },

    getOfficeId() {
      return officeId || window.__DenizenOfficeId || identityId || readStore().identity_id || null;
    },

    applyOfficeRegistration(msg = {}) {
      if (msg.office_id) {
        officeId = msg.office_id;
        window.__DenizenOfficeId = msg.office_id;
      }
      if (msg.identity_id) identityId = msg.identity_id;
      window.__DenizenIsOperatorOffice = !!msg.is_operator_office;
      try {
        document.dispatchEvent(new CustomEvent('denizen-office-registered', { detail: msg }));
      } catch (_) {}
    },

    getEmail() {
      return userEmail || readStore().email || null;
    },

    getProfile() {
      const ceo = isCeoPrincipalNow();
      const store = readStore();
      return {
        displayName: ceo ? (displayName || store.display_name || 'Dolonia') : (displayName || store.display_name || null),
        email: userEmail || store.email || null,
        demoUsername: store.demo_username || null,
        identityId: identityId || store.identity_id || null,
        officeId: DenizenVisitorSession.getOfficeId(),
        tier: ceo ? 'ceo' : (tier || store.tier || null),
        accessMethod: ceo ? 'ceo' : (accessMethod || store.access_method || null),
        orgSlug: orgSlug || store.org_slug || null,
        sessionId: sessionId || store.session_id || null,
        teamRole: teamRole || null,
        canApproveSkills: ceo || canApproveSkills,
        workPosition: workPosition || null,
        positionTitle: workPosition?.title || null,
      };
    },

    applyProfilePatch(patch = {}) {
      if (patch.displayName != null) displayName = String(patch.displayName).slice(0, 200);
      if (patch.email != null) userEmail = String(patch.email).slice(0, 320) || null;
      if (patch.workPosition !== undefined) workPosition = patch.workPosition || null;
      if (patch.positionTitle !== undefined) {
        workPosition = patch.positionTitle
          ? { ...(workPosition || {}), title: String(patch.positionTitle).slice(0, 120) }
          : workPosition;
      }
      const store = readStore();
      writeStore({
        ...store,
        display_name: displayName || store.display_name,
        email: userEmail || store.email || null,
      });
      try {
        document.dispatchEvent(new CustomEvent('denizen-visitor-profile-updated', {
          detail: DenizenVisitorSession.getProfile(),
        }));
      } catch (_) {}
      return DenizenVisitorSession.getProfile();
    },

    async refreshSettings() {
      await refreshSessionSettings();
      return DenizenVisitorSession.getProfile();
    },

    async logout() {
      announceProfileSwitching({ displayName: 'Signing out', tier: null });
      resetStoredSessionForSwitch();

      try {
        document.dispatchEvent(new CustomEvent('denizen-visitor-logged-out'));
      } catch (_) {}

      const welcome = await showWelcomeModal();
      return applyWelcomeSession(welcome);
    },

    async beginTeamJoinFlow(teamCode) {
      resetStoredSessionForSwitch();
      pendingJoinCode = teamCode ? String(teamCode).trim() : null;
      try {
        document.dispatchEvent(new CustomEvent('denizen-visitor-logged-out'));
      } catch (_) {}
      const welcome = await showWelcomeModal();
      return applyWelcomeSession(welcome);
    },

    registerWebSocket(ws) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const sid = sessionId;
      if (!sid) return;
      try {
        ws.send(JSON.stringify({
          type: 'visitor_register',
          session_id: sid,
          display_name: DenizenVisitorSession.getDisplayName(),
          identity_id: DenizenVisitorSession.getIdentityId(),
          is_ceo: isCeoPrincipalNow(),
        }));
      } catch (err) {
        console.warn('[DenizenVisitorSession] visitor_register failed:', err?.message || err);
      }
    },

    async listProjects() {
      const sid = requireSessionId();
      const data = await apiJson(
        `/api/visitor/projects?session_id=${encodeURIComponent(sid)}`,
      );
      return data.projects || [];
    },

    async addProject(name, opts = {}) {
      const sid = requireSessionId();
      const data = await apiJson('/api/visitor/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sid,
          name: String(name || '').trim(),
          notes: opts.notes ?? null,
          status: opts.status ?? 'active',
          priority: opts.priority ?? 'medium',
        }),
      });
      return data.project || data;
    },

    async updateProject(id, patch = {}) {
      const sid = requireSessionId();
      const data = await apiJson(`/api/visitor/projects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, ...patch }),
      });
      return data.project || data;
    },

    async deleteProject(id) {
      const sid = requireSessionId();
      await apiJson(`/api/visitor/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid }),
      });
      return true;
    },

    async listTeammates() {
      const sid = requireSessionId();
      const data = await apiJson(
        `/api/visitor/teammates?session_id=${encodeURIComponent(sid)}`,
      );
      return data.teammates || [];
    },

    async listConnections() {
      const sid = requireSessionId();
      const data = await apiJson(
        `/api/visitor/connections?session_id=${encodeURIComponent(sid)}`,
      );
      return data;
    },

    async requestConnection(payload = {}) {
      const sid = requireSessionId();
      const data = await apiJson('/api/visitor/connections/request', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          session_id: sid,
          target_email: payload.targetEmail || payload.target_email || payload.email,
          target_session_id: payload.targetSessionId || payload.target_session_id,
          message: payload.message,
        }),
      });
      return data.connection || data;
    },

    async respondConnection(connectionId, action) {
      const sid = requireSessionId();
      const data = await apiJson('/api/visitor/connections/respond', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          session_id: sid,
          connection_id: connectionId,
          action,
        }),
      });
      return data.connection || data;
    },

    async sendOfficeBus(payload = {}) {
      const sid = requireSessionId();
      const data = await apiJson('/api/visitor/office-bus', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          session_id: sid,
          to_office_id: payload.toOfficeId || payload.to_office_id,
          to_session_id: payload.toSessionId || payload.to_session_id,
          message: payload.message,
          intent: payload.intent || 'sync',
          from_npc: payload.fromNpc || payload.from_npc,
          metadata: payload.metadata,
        }),
      });
      return data.message || data;
    },

    async listTeamOffices() {
      const sid = requireSessionId();
      const data = await apiJson(
        `/api/visitor/offices?session_id=${encodeURIComponent(sid)}`,
      );
      return data;
    },

    async sendHandoff(payload = {}) {
      const sid = requireSessionId();
      const assistant = DenizenVisitorSession.getAssistant?.();
      const body = {
        session_id: sid,
        from_session_id: sid,
        message: String(payload.message || '').trim(),
        from_npc: assistant?.npc_key || 'assistant',
      };
      if (payload.toSessionId) body.to_session_id = payload.toSessionId;
      if (payload.toCeo) body.to_ceo = true;
      if (payload.toDisplayName) body.to_display_name = payload.toDisplayName;
      if (payload.toNpc) body.to_npc = payload.toNpc;
      if (!body.message) throw new Error('Message required');
      if (!body.to_session_id && !body.to_ceo && !body.to_display_name && !body.to_npc) {
        throw new Error('Choose a recipient');
      }
      const data = await apiJson('/api/visitor/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return data.handoff || data;
    },

    async sendCeoHandoff({ toSessionId, message, toCeo, toDisplayName, toNpc } = {}) {
      const body = {
        is_ceo: true,
        message: String(message || '').trim(),
        from_npc: 'ceo',
      };
      if (toSessionId) body.to_session_id = toSessionId;
      if (toCeo) body.to_ceo = true;
      if (toDisplayName) body.to_display_name = toDisplayName;
      if (toNpc) body.to_npc = toNpc;
      if (!body.message) throw new Error('Message required');
      if (!body.to_session_id && !body.to_ceo && !body.to_display_name && !body.to_npc) {
        throw new Error('Choose a recipient');
      }
      const data = await apiJson('/api/visitor/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return data.handoff || data;
    },

    async sendHandoffReply(handoff, message) {
      const replyTo = handoff?.from_session_id || handoff?.fromSessionId;
      if (!replyTo) throw new Error('No reply target on this handoff');
      const text = String(message || '').trim();
      if (!text) throw new Error('Message required');
      if (DenizenVisitorSession.isCeoMode()) {
        return DenizenVisitorSession.sendCeoHandoff({ toSessionId: replyTo, message: text });
      }
      return DenizenVisitorSession.sendHandoff({ toSessionId: replyTo, message: text });
    },

    async pollHandoffs() {
      const sid = requireSessionId();
      const data = await apiJson(
        `/api/visitor/handoffs?session_id=${encodeURIComponent(sid)}`,
      );
      return data.handoffs || data.pending || [];
    },

    async markHandoffRead(id) {
      if (DenizenVisitorSession.isCeoMode()) {
        const data = await apiJson(`/api/visitor/handoffs/${encodeURIComponent(id)}/delivered`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_ceo: true }),
        });
        return data.handoff || data;
      }
      const sid = requireSessionId();
      const data = await apiJson(`/api/visitor/handoffs/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid }),
      });
      return data.handoff || data;
    },

    init() {
      if (initPromise) return initPromise;

      initPromise = (async () => {
        clearCeoUiMode();
        await fetchOfficeConfig();

        const inviteCode = pendingJoinCode;
        if (inviteCode) {
          resetStoredSessionForSwitch();
          pendingJoinCode = inviteCode;
          const welcome = await showWelcomeModal();
          return applyWelcomeSession(welcome);
        }

        const stored = readStore();
        sessionId = stored.session_id || null;
        sessionToken = stored.session_token || null;
        displayName = stored.display_name || null;
        tier = stored.tier || null;
        orgSlug = stored.org_slug || null;
        accessMethod = stored.access_method || null;
        identityId = stored.identity_id || null;
        userEmail = stored.email || null;

        if (accessMethod === 'ceo' || (isCeoPrincipalNow() && String(tier || stored.tier || '').toLowerCase() !== 'demo')) {
          accessMethod = 'ceo';
          displayName = displayName || stored.display_name || 'Dolonia';
          tier = 'ceo';
          writeStore({
            ...stored,
            display_name: displayName,
            tier: 'ceo',
            access_method: 'ceo',
          });
        }

        if (!displayName || !tier) {
          const welcome = await showWelcomeModal();
          if (!welcome) {
            sessionId = null;
            sessionToken = null;
            displayName = null;
            return { sessionId: null, displayName: null, assistant: null };
          }
          return applyWelcomeSession(welcome);
        } else {
          try {
            const method = accessMethod || stored.access_method || (tier === 'demo' ? 'demo' : null);
            if (tier === 'demo') {
              await touchSession(displayName, {
                orgSlug: orgSlug || stored.org_slug,
                tier: 'demo',
                accessMethod: 'demo',
              });
            } else if ((accessMethod === 'ceo' || isCeoPrincipalNow()) && readCeoGrant()) {
              const cfg = await fetchOfficeConfig();
              const teamSlug = cfg?.visitorAccess?.teamOrgSlug || 'zion';
              await touchSession(displayName || 'Dolonia', {
                orgSlug: orgSlug || stored.org_slug || teamSlug,
                tier: 'ceo',
                accessMethod: 'ceo',
                email: userEmail || stored.email || null,
              });
            } else if (sessionId && sessionToken) {
              await touchSession(displayName, {
                orgSlug,
                tier,
                accessMethod: method,
                email: userEmail || stored.email || null,
              });
            } else if (sessionId && (accessMethod === 'ceo' || isCeoPrincipalNow())) {
              const cfg = await fetchOfficeConfig();
              const teamSlug = cfg?.visitorAccess?.teamOrgSlug || 'zion';
              await touchSession(displayName || 'Dolonia', {
                orgSlug: orgSlug || stored.org_slug || teamSlug,
                tier: tier || 'ceo',
                accessMethod: 'ceo',
                email: userEmail || stored.email || null,
              });
            } else {
              throw new Error('Team session expired — sign in again');
            }
          } catch (err) {
            // A returning user (reload / browser-back) must not be dumped on the
            // login screen because the re-validation call hiccuped on a slow DB.
            // Reuse the cached session on any transient error — demo included
            // (demo sessions may have no token, which is fine).
            const canUseCachedSession = isTransientSessionError(err)
              && stored.session_id
              && stored.tier
              && (stored.tier === 'demo' || stored.session_token);
            if (canUseCachedSession) {
              console.warn('[DenizenVisitorSession] session touch slow/failed — using cached session');
              sessionId = stored.session_id;
              sessionToken = stored.session_token || sessionToken;
              displayName = stored.display_name || displayName;
              tier = stored.tier;
              orgSlug = stored.org_slug || orgSlug;
              accessMethod = stored.access_method || accessMethod;
              identityId = stored.identity_id || identityId;
              userEmail = stored.email || userEmail;
            } else {
              console.warn('[DenizenVisitorSession] session touch failed:', err?.message || err);
              try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
              sessionId = null;
              sessionToken = null;
              displayName = null;
              tier = null;
              const welcome = await showWelcomeModal();
              if (!welcome) {
                return { sessionId: null, displayName: null, assistant: null };
              }
              return applyWelcomeSession(welcome);
            }
          }
        }

        if (!displayName) {
          return { sessionId: null, displayName: null, assistant: null };
        }

        await refreshSessionSettings().catch(() => null);
        if (isCeoPrincipalNow()) {
          tier = 'ceo';
          accessMethod = 'ceo';
        }

        try {
          document.dispatchEvent(new CustomEvent('denizen-visitor-session-ready', {
            detail: {
              sessionId,
              tier,
              accessMethod,
              identityId,
            },
          }));
        } catch (_) {}
        DenizenVisitorSession.refreshAssistant().catch(() => null);
        return { sessionId, displayName, assistant };
      })();

      return initPromise;
    },
  };

  globalThis.DenizenVisitorSession = DenizenVisitorSession;
})();
