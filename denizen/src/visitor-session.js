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
  let userEmail = null;
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
      },
    };
    return officeConfig;
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

  function isCeoPrincipalNow() {
    if (accessMethod === 'ceo') return true;
    try {
      return !!localStorage.getItem('denizen-ceo-grant');
    } catch (_) {
      return false;
    }
  }

  function authHeaders(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    if (sessionId) headers['X-Session-Id'] = sessionId;
    if (sessionToken) headers['X-Session-Token'] = sessionToken;
    if (isCeoPrincipalNow()) {
      headers['X-Ceo-Principal'] = '1';
      headers['X-Denizen-Client'] = 'host';
      headers['X-Denizen-Local-Client'] = '1';
      headers['X-Access-Method'] = 'ceo';
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
      #denizen-visitor-name-modal {
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
        padding: 14px 16px;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        text-align: center;
        min-height: 48px;
        touch-action: manipulation;
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
      html[data-denizen-modal="open"] #game-container,
      html[data-denizen-modal="open"] #game-container canvas,
      html[data-denizen-modal="open"] #denizen-bottom-dock,
      html[data-denizen-modal="open"] #player-chat-fab,
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
      html[data-denizen-modal="open"] #denizen-visitor-name-modal {
        z-index: 2147483000;
      }
    `;
    document.head.appendChild(s);
  }

  const SESSION_FETCH_MS = 10000;
  const API_FETCH_MS = 8000;

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

  function fetchAbortMessage() {
    const port = String(window.location?.port || '');
    if (port === '8081') {
      return 'Port 8081 is not Denizen (often Cursor). Open http://localhost:8080/?layout=openplan instead.';
    }
    if (usesTunnelSafeTransport()) {
      return 'Denizen cloud login timed out — deploy the latest server (GET verify fallback) and reload.';
    }
    const origin = window.location?.origin || 'this page';
    return `Denizen server timed out (${origin}) — restart with npm start and reload.`;
  }

  function normalizeFetchError(err) {
    const msg = String(err?.message || err || '');
    if (err?.name === 'AbortError' || /aborted|abort/i.test(msg)) {
      return new Error(fetchAbortMessage());
    }
    if (/failed to fetch|network|load failed/i.test(msg)) {
      return new Error('Cannot reach Denizen server — is it running on http://localhost:8080 ?');
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
      return 'Denizen server timed out — restart the server and use http://localhost:8080.';
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
    const res = await fetchWithTimeout(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
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

      let step = 'choose';
      let pendingAccess = null;
      let busy = false;
      let unbindPress = null;
      let stepUnbinds = [];

      function setGameInputBlocked(block) {
        try {
          if (window.game?.input) window.game.input.enabled = !block;
        } catch (_) {}
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
        const input = modalEl.querySelector('.vis-input, #denizen-visitor-name-input');
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
        busy = true;
        if (btn) btn.disabled = true;
        closeModal({
          displayName: pendingAccess?.displayName || name,
          orgSlug: pendingAccess?.orgSlug,
          tier: pendingAccess?.tier,
          accessMethod: pendingAccess?.accessMethod,
          accessGrant: pendingAccess?.accessGrant || null,
          email: pendingAccess?.email || null,
        });
      }

      function finishTeamAuth(data, fallbackName, accessMethod = 'website_login') {
        const { teamSlug } = accessCtx();
        const name = String(data.display_name || fallbackName || '').trim();
        if (!name) {
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
        closeModal({
          displayName: name,
          orgSlug: data.org_slug || teamSlug,
          tier: data.tier || 'team',
          accessMethod,
          accessGrant: data.access_grant || null,
          email: data.identity?.email || email,
        });
      }

      async function submitTeamLogin() {
        if (busy) return;
        const emailEl = modalEl.querySelector('#denizen-visitor-email-input');
        const codeEl = modalEl.querySelector('#denizen-visitor-team-code-input');
        const btn = modalEl.querySelector('#denizen-visitor-name-continue');
        const errEl = modalEl.querySelector('#denizen-vis-error');
        const email = String(emailEl?.value || '').trim().toLowerCase();
        const teamCode = String(codeEl?.value || '').trim();
        if (!email) {
          emailEl?.focus();
          return;
        }
        busy = true;
        if (btn) btn.disabled = true;
        if (errEl) errEl.hidden = true;
        try {
          const data = await teamAuthRequest('/api/visitor/auth/login', {
            email,
            team_code: teamCode || undefined,
          });
          finishTeamAuth(data, email.split('@')[0]);
        } catch (err) {
          if (errEl) {
            errEl.textContent = err?.message || 'Login failed';
            errEl.hidden = false;
          }
          if (btn) btn.disabled = false;
          emailEl?.focus();
        } finally {
          busy = false;
        }
      }

      async function submitTeamRegister() {
        if (busy) return;
        const emailEl = modalEl.querySelector('#denizen-visitor-email-input');
        const nameEl = modalEl.querySelector('#denizen-visitor-display-input');
        const codeEl = modalEl.querySelector('#denizen-visitor-team-code-input');
        const btn = modalEl.querySelector('#denizen-visitor-name-continue');
        const errEl = modalEl.querySelector('#denizen-vis-error');
        const email = String(emailEl?.value || '').trim().toLowerCase();
        const displayName = String(nameEl?.value || '').trim();
        const teamCode = String(codeEl?.value || '').trim();
        if (!email || !displayName || !teamCode) {
          if (!email) emailEl?.focus();
          else if (!displayName) nameEl?.focus();
          else codeEl?.focus();
          return;
        }
        busy = true;
        if (btn) btn.disabled = true;
        if (errEl) errEl.hidden = true;
        try {
          const data = await teamAuthRequest('/api/visitor/auth/register', {
            email,
            display_name: displayName,
            team_code: teamCode,
          });
          finishTeamAuth(data, displayName, 'website_register');
        } catch (err) {
          if (errEl) {
            errEl.textContent = err?.message || 'Registration failed';
            errEl.hidden = false;
          }
          if (btn) btn.disabled = false;
        } finally {
          busy = false;
        }
      }

      async function handleAction(action) {
        const { demoSlug } = accessCtx();
        if (action === 'path-demo') {
          pendingAccess = { orgSlug: demoSlug, tier: 'demo', accessMethod: 'demo' };
          step = 'demo-email';
          render();
          return;
        }
        if (action === 'path-team') {
          pendingAccess = { accessMethod: 'team' };
          step = 'team-code';
          render();
          return;
        }
        if (action === 'path-team-email') {
          pendingAccess = { accessMethod: 'website_login' };
          step = 'team-email';
          render();
          return;
        }
        if (action === 'goto-team-register') {
          step = 'team-register';
          render();
          return;
        }
        if (action === 'goto-team-login') {
          step = 'team-email';
          render();
          return;
        }
        if (action === 'path-ceo') {
          pendingAccess = { accessMethod: 'ceo' };
          step = 'ceo-code';
          render();
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
            if (pendingAccess?.accessMethod === 'team') step = 'team-code';
            else if (pendingAccess?.accessMethod === 'website_login') step = 'team-email';
            else if (pendingAccess?.accessMethod === 'demo') step = 'demo-email';
            else if (pendingAccess?.accessMethod === 'ceo') step = 'ceo-code';
            else step = 'choose';
          } else if (step === 'team-register') {
            step = 'team-email';
          } else {
            step = 'choose';
          }
          render();
          return;
        }
        if (action === 'submit-team-code') {
          await submitAccessCode('team');
          return;
        }
        if (action === 'submit-team-login') {
          await submitTeamLogin();
          return;
        }
        if (action === 'submit-team-register') {
          await submitTeamRegister();
          return;
        }
        if (action === 'submit-ceo-code') {
          await submitAccessCode('ceo');
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
        else if (step === 'team-code') handleAction('submit-team-code');
        else if (step === 'team-email') handleAction('submit-team-login');
        else if (step === 'team-register') handleAction('submit-team-register');
        else if (step === 'ceo-code') handleAction('submit-ceo-code');
        else if (step === 'name') handleAction('submit-name');
      });

      function wireStepControls() {
        stepUnbinds.forEach((fn) => fn());
        stepUnbinds = [];
        if (!window.DenizenTouchBind?.bindPress) return;
        modalEl.querySelectorAll('[data-action]').forEach((btn) => {
          const off = window.DenizenTouchBind.bindPress(
            btn,
            () => onModalActivate(btn),
            { stop: true },
          );
          if (typeof off === 'function') stepUnbinds.push(off);
        });
      }

      function render() {
        document.body.appendChild(modalEl);
        const { teamSlug } = accessCtx();

        let focusAfter = false;

        if (step === 'choose') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <h2>Welcome to Denizen</h2>
              <p>How would you like to enter?</p>
              <div class="vis-paths">
                <button type="button" class="vis-path-btn" data-action="path-demo">Try demo</button>
                <button type="button" class="vis-path-btn" data-action="path-team">Team code</button>
                <button type="button" class="vis-path-btn" data-action="path-team-email">Team email login</button>
                <button type="button" class="vis-path-btn ceo" data-action="path-ceo">CEO access</button>
              </div>
            </div>
          `;
        } else if (step === 'demo-email') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <button type="button" class="vis-back" data-action="back">← Back</button>
              <h2>Try the demo</h2>
              <p>Enter your email so we can save your progress and welcome you back.</p>
              <p class="vis-error" id="denizen-vis-error" hidden></p>
              <input class="vis-input" id="denizen-visitor-email-input" type="email" maxlength="120" placeholder="you@email.com" autocomplete="email" inputmode="email" />
              <button type="button" id="denizen-visitor-name-continue" data-action="submit-demo-email">Continue</button>
            </div>
          `;
          focusAfter = true;
        } else if (step === 'team-code') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <button type="button" class="vis-back" data-action="back">← Back</button>
              <h2>Team code</h2>
              <p>Enter team code for ${teamSlug}.</p>
              <p class="vis-error" id="denizen-vis-error" hidden></p>
              <input class="vis-input" id="denizen-visitor-code-input" type="text" maxlength="32" placeholder="1921" autocomplete="off" inputmode="numeric" />
              <button type="button" id="denizen-visitor-name-continue" data-action="submit-team-code">Continue</button>
            </div>
          `;
          focusAfter = true;
        } else if (step === 'team-email') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <button type="button" class="vis-back" data-action="back">← Back</button>
              <h2>Team email login</h2>
              <p>Sign in with your work email for ${teamSlug}.</p>
              <p class="vis-error" id="denizen-vis-error" hidden></p>
              <input class="vis-input" id="denizen-visitor-email-input" type="email" maxlength="120" placeholder="you@company.com" autocomplete="email" inputmode="email" />
              <p class="vis-hint">First time? Add team code below (same as register).</p>
              <input class="vis-input" id="denizen-visitor-team-code-input" type="text" maxlength="32" placeholder="Team code (optional)" autocomplete="off" inputmode="numeric" />
              <button type="button" id="denizen-visitor-name-continue" data-action="submit-team-login">Log in</button>
              <div class="vis-link-row">New here? <button type="button" class="vis-link" data-action="goto-team-register">Register with team code</button></div>
            </div>
          `;
          focusAfter = true;
        } else if (step === 'team-register') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <button type="button" class="vis-back" data-action="back">← Back</button>
              <h2>Team register</h2>
              <p>Create your ${teamSlug} account.</p>
              <p class="vis-error" id="denizen-vis-error" hidden></p>
              <input class="vis-input" id="denizen-visitor-email-input" type="email" maxlength="120" placeholder="you@company.com" autocomplete="email" inputmode="email" />
              <input class="vis-input" id="denizen-visitor-display-input" type="text" maxlength="64" placeholder="Display name" autocomplete="name" />
              <input class="vis-input" id="denizen-visitor-team-code-input" type="text" maxlength="32" placeholder="Team code" autocomplete="off" inputmode="numeric" />
              <button type="button" id="denizen-visitor-name-continue" data-action="submit-team-register">Register</button>
              <div class="vis-link-row">Already registered? <button type="button" class="vis-link" data-action="goto-team-login">Log in</button></div>
            </div>
          `;
          focusAfter = true;
        } else if (step === 'ceo-code') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <button type="button" class="vis-back" data-action="back">← Back</button>
              <h2>CEO access</h2>
              <p>Enter CEO code.</p>
              <p class="vis-error" id="denizen-vis-error" hidden></p>
              <input class="vis-input" id="denizen-visitor-code-input" type="text" maxlength="32" placeholder="Dolonia" autocomplete="off" autocapitalize="words" />
              <button type="button" id="denizen-visitor-name-continue" data-action="submit-ceo-code">Continue</button>
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
              <button type="button" id="denizen-visitor-name-continue" data-action="submit-name">Continue</button>
            </div>
          `;
          focusAfter = true;
        }

        wireStepControls();
        if (focusAfter) focusFirstInput();
      }

      render();
      fetchOfficeConfig().then(() => render());
    });
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
    const body = { display_name: name };
    if (sessionId) body.session_id = sessionId;
    if (sessionToken) body.session_token = sessionToken;
    if (opts.accessGrant) body.access_grant = opts.accessGrant;
    if (opts.email) body.email = opts.email;
    const meta = {};
    if (opts.accessMethod) meta.access_method = opts.accessMethod;
    if (opts.accessMethod === 'ceo') meta.is_ceo_principal = true;
    if (Object.keys(meta).length) body.metadata = meta;
    if (opts.tier === 'demo' || opts.accessMethod === 'demo') {
      body.demo = true;
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
      }, SESSION_FETCH_MS);
    } else {
      try {
        res = await fetchWithTimeout('/api/visitor/session', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(body),
        }, SESSION_FETCH_MS);
      } catch (err) {
        if (!isTransientSessionError(err)) throw err;
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
        }, SESSION_FETCH_MS);
      }
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Session sync failed (${res.status})`);
    }
    const data = await res.json();
    const session = data.session || data;
    if (opts.accessMethod === 'ceo') {
      displayName = 'Dolonia';
      tier = 'ceo';
    } else {
      if (session.display_name) displayName = session.display_name;
      if (opts.tier) tier = opts.tier;
    }
    if (session.id) sessionId = session.id;
    if (data.session_token) sessionToken = data.session_token;
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
    };
    writeStore(store);
    return session;
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
      return assistant;
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
      return false;
    },

    getTier() {
      if (isCeoPrincipalNow()) return 'ceo';
      return tier || readStore().tier || null;
    },

    isDemo() {
      return DenizenVisitorSession.getTier() === 'demo';
    },

    isTeam() {
      return DenizenVisitorSession.getTier() === 'team';
    },

    getAccessMethod() {
      return accessMethod || readStore().access_method || null;
    },

    isCeoPrincipal() {
      if (DenizenVisitorSession.getAccessMethod() === 'ceo') return true;
      try {
        return !!localStorage.getItem('denizen-ceo-grant');
      } catch (_) {
        return false;
      }
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

    getEmail() {
      return userEmail || readStore().email || null;
    },

    getProfile() {
      const ceo = isCeoPrincipalNow();
      return {
        displayName: ceo ? 'Dolonia' : (displayName || readStore().display_name || null),
        email: userEmail || readStore().email || null,
        identityId: identityId || readStore().identity_id || null,
        tier: ceo ? 'ceo' : (tier || readStore().tier || null),
        accessMethod: accessMethod || readStore().access_method || null,
        sessionId: sessionId || readStore().session_id || null,
      };
    },

    async logout() {
      sessionId = null;
      sessionToken = null;
      displayName = null;
      assistant = null;
      tier = null;
      orgSlug = null;
      accessMethod = null;
      identityId = null;
      userEmail = null;
      initPromise = null;

      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(ROLE_STORAGE_KEY);
        localStorage.removeItem('denizen-onboarding-seen');
        localStorage.removeItem('denizen-ceo-grant');
      } catch (_) {}

      clearCeoUiMode();

      try {
        document.dispatchEvent(new CustomEvent('denizen-visitor-logged-out'));
      } catch (_) {}

      const welcome = await showWelcomeModal();
      if (!welcome) {
        return { sessionId: null, displayName: null, assistant: null };
      }
      displayName = welcome.displayName;
      tier = welcome.tier;
      orgSlug = welcome.orgSlug;
      accessMethod = welcome.accessMethod;
      await touchSession(displayName, {
        orgSlug: welcome.orgSlug,
        tier: welcome.tier,
        accessMethod: welcome.accessMethod,
        accessGrant: welcome.accessGrant,
        email: welcome.email || null,
      });
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
          is_ceo: false,
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

        const stored = readStore();
        sessionId = stored.session_id || null;
        sessionToken = stored.session_token || null;
        displayName = stored.display_name || null;
        tier = stored.tier || null;
        orgSlug = stored.org_slug || null;
        accessMethod = stored.access_method || null;
        identityId = stored.identity_id || null;
        userEmail = stored.email || null;

        if (accessMethod === 'ceo' || isCeoPrincipalNow()) {
          accessMethod = 'ceo';
          displayName = 'Dolonia';
          tier = 'ceo';
          writeStore({
            ...stored,
            display_name: 'Dolonia',
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
          displayName = welcome.displayName;
          tier = welcome.tier;
          orgSlug = welcome.orgSlug;
          await touchSession(displayName, {
            orgSlug: welcome.orgSlug,
            tier: welcome.tier,
            accessMethod: welcome.accessMethod,
            accessGrant: welcome.accessGrant,
            email: welcome.email || null,
          });
        } else {
          try {
            const method = accessMethod || stored.access_method || (tier === 'demo' ? 'demo' : null);
            if (tier === 'demo') {
              await touchSession(displayName, {
                orgSlug: orgSlug || stored.org_slug,
                tier: 'demo',
                accessMethod: 'demo',
              });
            } else if (sessionId && sessionToken) {
              await touchSession(displayName, {
                orgSlug,
                tier,
                accessMethod: method,
              });
            } else {
              throw new Error('Team session expired — sign in again');
            }
          } catch (err) {
            const canUseCachedTeamSession = isTransientSessionError(err)
              && stored.session_id
              && stored.session_token
              && stored.tier
              && stored.tier !== 'demo';
            if (canUseCachedTeamSession) {
              console.warn('[DenizenVisitorSession] session touch slow/failed — using cached session');
              sessionId = stored.session_id;
              sessionToken = stored.session_token;
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
              displayName = welcome.displayName;
              tier = welcome.tier;
              orgSlug = welcome.orgSlug;
              accessMethod = welcome.accessMethod;
              await touchSession(displayName, {
                orgSlug: welcome.orgSlug,
                tier: welcome.tier,
                accessMethod: welcome.accessMethod,
                accessGrant: welcome.accessGrant,
                email: welcome.email || null,
              });
            }
          }
        }

        if (!displayName) {
          return { sessionId: null, displayName: null, assistant: null };
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
