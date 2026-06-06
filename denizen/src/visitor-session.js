/**
 * Denizen visitor session — persistent browser identity + personal assistant claim.
 * Attaches to globalThis.DenizenVisitorSession (no imports).
 */
(function () {
  'use strict';

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

  function setCeoMode(persist) {
    globalThis.__DenizenCeoMode = true;
    if (persist) {
      try {
        localStorage.setItem(ROLE_STORAGE_KEY, 'ceo');
      } catch (_) {}
    }
    if (typeof globalThis.DenizenMobileControls?.setCeoMode === 'function') {
      globalThis.DenizenMobileControls.setCeoMode(true);
    }
  }

  if (readRole() === 'ceo') {
    setCeoMode(false);
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
        ceoAccessRequired: false,
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

  function authHeaders(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    if (sessionToken) headers['X-Session-Token'] = sessionToken;
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
        z-index: 100500;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(2, 6, 23, 0.88);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      #denizen-visitor-name-modal .vis-card {
        background: #020617;
        border: 1px solid #1f2937;
        border-radius: 10px;
        padding: 24px 28px;
        width: min(360px, calc(100vw - 32px));
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
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
      #denizen-visitor-name-input {
        width: 100%;
        box-sizing: border-box;
        background: #1e293b;
        border: 1px solid #1f2937;
        border-radius: 6px;
        color: #e2e8f0;
        padding: 10px 12px;
        font: inherit;
        font-size: 13px;
        outline: none;
        margin-bottom: 14px;
      }
      #denizen-visitor-name-input:focus {
        border-color: #4ade80;
      }
      #denizen-visitor-name-continue {
        width: 100%;
        background: #4ade80;
        color: #0f172a;
        border: none;
        border-radius: 6px;
        padding: 10px 16px;
        font: inherit;
        font-weight: bold;
        font-size: 12px;
        cursor: pointer;
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
        border-radius: 6px;
        padding: 12px 16px;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        text-align: left;
      }
      #denizen-visitor-name-modal .vis-path-btn:hover {
        border-color: #4ade80;
        background: #0f172a;
      }
      #denizen-visitor-name-modal .vis-path-btn small {
        display: block;
        margin-top: 4px;
        font-weight: 400;
        color: #64748b;
        font-size: 11px;
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
      #denizen-visitor-name-modal .vis-ceo-link {
        margin-top: 14px;
        background: transparent;
        border: none;
        color: #64748b;
        font: inherit;
        font-size: 11px;
        cursor: pointer;
        text-decoration: underline;
        padding: 0;
        width: 100%;
        text-align: center;
      }
      #denizen-visitor-name-modal .vis-ceo-link:hover { color: #94a3b8; }
    `;
    document.head.appendChild(s);
  }

  async function verifyAccessCode(code, type) {
    const res = await fetch('/api/visitor/access/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, type }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Access denied (${res.status})`);
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

      let step = 'choose';
      let pendingAccess = null;

      function closeModal(result) {
        modalEl.remove();
        modalEl = null;
        resolve(result);
      }

      function render() {
        const access = officeConfig?.visitorAccess || {};
        const demoSlug = access.demoOrgSlug || 'acme';
        const teamSlug = access.teamOrgSlug || 'zion';
        const ceoRequired = !!access.ceoAccessRequired;

        if (step === 'choose') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <h2>Welcome to Denizen</h2>
              <p>How would you like to enter the office?</p>
              <div class="vis-paths">
                <button type="button" class="vis-path-btn" data-path="demo">
                  Try demo
                  <small>Explore ${demoSlug} — no code needed</small>
                </button>
                <button type="button" class="vis-path-btn" data-path="team">
                  Team access
                  <small>Enter your team code for ${teamSlug}</small>
                </button>
                <button type="button" class="vis-path-btn" data-path="website">
                  Team email login
                  <small>Register or sign in with work email + code</small>
                </button>
              </div>
              ${ceoRequired ? '<button type="button" class="vis-ceo-link" id="denizen-visitor-ceo-link">CEO access</button>' : ''}
            </div>
          `;
          modalEl.querySelector('[data-path="demo"]').addEventListener('click', () => {
            pendingAccess = {
              orgSlug: demoSlug,
              tier: 'demo',
              accessMethod: 'demo',
            };
            step = 'name';
            render();
          });
          modalEl.querySelector('[data-path="team"]').addEventListener('click', () => {
            pendingAccess = { accessMethod: 'team' };
            step = 'team-code';
            render();
          });
          modalEl.querySelector('[data-path="website"]')?.addEventListener('click', () => {
            pendingAccess = { accessMethod: 'website' };
            step = 'website-auth';
            render();
          });
          const ceoLink = modalEl.querySelector('#denizen-visitor-ceo-link');
          ceoLink?.addEventListener('click', () => {
            if (ceoRequired) {
              pendingAccess = { accessMethod: 'ceo' };
              step = 'ceo-code';
              render();
            } else {
              setCeoMode(true);
              closeModal(null);
            }
          });
          return;
        }

        if (step === 'team-code') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <button type="button" class="vis-back" id="denizen-vis-back">← Back</button>
              <h2>Team access</h2>
              <p>Enter your team code to join ${teamSlug}.</p>
              <p class="vis-error" id="denizen-vis-error" hidden></p>
              <input id="denizen-visitor-code-input" type="text" maxlength="32" placeholder="Team code" autocomplete="off" />
              <button type="button" id="denizen-visitor-name-continue">Continue</button>
            </div>
          `;
          const input = modalEl.querySelector('#denizen-visitor-code-input');
          const btn = modalEl.querySelector('#denizen-visitor-name-continue');
          const errEl = modalEl.querySelector('#denizen-vis-error');
          modalEl.querySelector('#denizen-vis-back').addEventListener('click', () => {
            step = 'choose';
            render();
          });
          async function submitCode() {
            const code = String(input.value || '').trim();
            if (!code) {
              input.focus();
              return;
            }
            btn.disabled = true;
            errEl.hidden = true;
            try {
              const verified = await verifyAccessCode(code, 'team');
              pendingAccess = {
                orgSlug: verified.org_slug || teamSlug,
                tier: verified.tier || 'team',
                accessMethod: 'team',
                accessGrant: verified.access_grant || null,
              };
              step = 'name';
              render();
            } catch (err) {
              errEl.textContent = err?.message || 'Invalid team code';
              errEl.hidden = false;
              btn.disabled = false;
              input.focus();
            }
          }
          btn.addEventListener('click', submitCode);
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitCode();
          });
          setTimeout(() => input.focus(), 50);
          return;
        }

        if (step === 'website-auth') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <button type="button" class="vis-back" id="denizen-vis-back">← Back</button>
              <h2>Team email</h2>
              <p>Register or sign in with your work email and team code.</p>
              <p class="vis-error" id="denizen-vis-error" hidden></p>
              <input id="denizen-visitor-email-input" type="email" maxlength="120" placeholder="you@company.com" autocomplete="email" />
              <input id="denizen-visitor-code-input" type="text" maxlength="32" placeholder="Team code (1921)" autocomplete="off" style="margin-top:10px" />
              <button type="button" id="denizen-visitor-register" style="margin-top:10px">Register</button>
              <button type="button" id="denizen-visitor-login" style="margin-top:8px;background:#1e293b;color:#e2e8f0">Sign in</button>
            </div>
          `;
          const emailInput = modalEl.querySelector('#denizen-visitor-email-input');
          const codeInput = modalEl.querySelector('#denizen-visitor-code-input');
          const errEl = modalEl.querySelector('#denizen-vis-error');
          modalEl.querySelector('#denizen-vis-back').addEventListener('click', () => {
            step = 'choose';
            render();
          });
          async function submitWebsite(mode) {
            const email = String(emailInput.value || '').trim();
            const teamCode = String(codeInput.value || '').trim();
            if (!email) { emailInput.focus(); return; }
            errEl.hidden = true;
            const path = mode === 'register' ? '/api/visitor/auth/register' : '/api/visitor/auth/login';
            const body = mode === 'register'
              ? { email, display_name: email.split('@')[0], team_code: teamCode }
              : { email, team_code: teamCode || undefined };
            try {
              const res = await fetch(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok || !data.ok) throw new Error(data.error || 'Auth failed');
              pendingAccess = {
                orgSlug: data.org_slug || teamSlug,
                tier: 'team',
                accessMethod: mode === 'register' ? 'website_register' : 'website_login',
                accessGrant: data.access_grant,
                displayName: data.display_name || email.split('@')[0],
              };
              step = 'name';
              render();
            } catch (err) {
              errEl.textContent = err?.message || 'Auth failed';
              errEl.hidden = false;
            }
          }
          modalEl.querySelector('#denizen-visitor-register').addEventListener('click', () => submitWebsite('register'));
          modalEl.querySelector('#denizen-visitor-login').addEventListener('click', () => submitWebsite('login'));
          setTimeout(() => emailInput.focus(), 50);
          return;
        }

        if (step === 'ceo-code') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <button type="button" class="vis-back" id="denizen-vis-back">← Back</button>
              <h2>CEO access</h2>
              <p>Enter your CEO access code.</p>
              <p class="vis-error" id="denizen-vis-error" hidden></p>
              <input id="denizen-visitor-code-input" type="password" maxlength="32" placeholder="CEO code" autocomplete="off" />
              <button type="button" id="denizen-visitor-name-continue">Continue</button>
            </div>
          `;
          const input = modalEl.querySelector('#denizen-visitor-code-input');
          const btn = modalEl.querySelector('#denizen-visitor-name-continue');
          const errEl = modalEl.querySelector('#denizen-vis-error');
          modalEl.querySelector('#denizen-vis-back').addEventListener('click', () => {
            step = 'choose';
            render();
          });
          async function submitCeoCode() {
            const code = String(input.value || '').trim();
            if (!code) {
              input.focus();
              return;
            }
            btn.disabled = true;
            errEl.hidden = true;
            try {
              const verified = await verifyAccessCode(code, 'ceo');
              if (verified.ceo_grant) {
                try { localStorage.setItem('denizen-ceo-grant', verified.ceo_grant); } catch (_) {}
              }
              setCeoMode(true);
              closeModal(null);
            } catch (err) {
              errEl.textContent = err?.message || 'Invalid CEO code';
              errEl.hidden = false;
              btn.disabled = false;
              input.focus();
            }
          }
          btn.addEventListener('click', submitCeoCode);
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitCeoCode();
          });
          setTimeout(() => input.focus(), 50);
          return;
        }

        if (step === 'name') {
          modalEl.innerHTML = `
            <div class="vis-card">
              <button type="button" class="vis-back" id="denizen-vis-back">← Back</button>
              <h2>Welcome to Denizen</h2>
              <p>What's your name?</p>
              <input id="denizen-visitor-name-input" type="text" maxlength="64" placeholder="Your name" autocomplete="name" />
              <button type="button" id="denizen-visitor-name-continue">Continue</button>
            </div>
          `;
          const input = modalEl.querySelector('#denizen-visitor-name-input');
          const btn = modalEl.querySelector('#denizen-visitor-name-continue');
          modalEl.querySelector('#denizen-vis-back').addEventListener('click', () => {
            step = pendingAccess?.accessMethod === 'team' ? 'team-code' : 'choose';
            render();
          });
          function submitName() {
            const name = String(input.value || '').trim();
            if (!name) {
              input.focus();
              return;
            }
            btn.disabled = true;
            closeModal({
              displayName: pendingAccess.displayName || name,
              orgSlug: pendingAccess.orgSlug,
              tier: pendingAccess.tier,
              accessMethod: pendingAccess.accessMethod,
              accessGrant: pendingAccess.accessGrant || null,
            });
          }
          btn.addEventListener('click', submitName);
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitName();
          });
          setTimeout(() => input.focus(), 50);
        }
      }

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
    if (opts.tier === 'demo' || opts.accessMethod === 'demo') {
      body.demo = true;
    } else if (opts.orgSlug) {
      body.org_slug = opts.orgSlug;
    }
    const res = await fetch('/api/visitor/session', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Session sync failed (${res.status})`);
    }
    const data = await res.json();
    const session = data.session || data;
    if (session.display_name) displayName = session.display_name;
    if (session.id) sessionId = session.id;
    if (data.session_token) sessionToken = data.session_token;
    if (opts.tier) tier = opts.tier;
    if (opts.orgSlug) orgSlug = opts.orgSlug;
    const store = {
      session_id: sessionId,
      session_token: sessionToken || null,
      display_name: displayName,
      tier: tier || opts.tier || null,
      org_slug: orgSlug || data.org?.slug || opts.orgSlug || null,
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
      return displayName || 'Guest';
    },

    getAssistant() {
      return assistant;
    },

    async refreshAssistant() {
      if (!sessionId) return null;
      try {
        const res = await fetch(
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
      return !!globalThis.__DenizenCeoMode;
    },

    getTier() {
      return tier || readStore().tier || null;
    },

    isDemo() {
      return DenizenVisitorSession.getTier() === 'demo';
    },

    isTeam() {
      return DenizenVisitorSession.getTier() === 'team';
    },

    authHeaders(extra = {}) {
      return authHeaders(extra);
    },

    getOrgSlug() {
      return orgSlug || readStore().org_slug || null;
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
        if (DenizenVisitorSession.isCeoMode()) {
          return { sessionId: null, displayName: null, assistant: null };
        }

        const stored = readStore();
        sessionId = stored.session_id || null;
        sessionToken = stored.session_token || null;
        displayName = stored.display_name || null;
        tier = stored.tier || null;
        orgSlug = stored.org_slug || null;

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
          });
        } else {
          try {
            if (sessionId && sessionToken) {
              await touchSession(displayName, { orgSlug, tier, accessMethod: tier });
            }
          } catch (err) {
            console.warn('[DenizenVisitorSession] session touch failed:', err?.message || err);
          }
        }

        if (!displayName || DenizenVisitorSession.isCeoMode()) {
          return { sessionId: null, displayName: null, assistant: null };
        }

        await DenizenVisitorSession.refreshAssistant();
        return { sessionId, displayName, assistant };
      })();

      return initPromise;
    },
  };

  globalThis.DenizenVisitorSession = DenizenVisitorSession;
})();
