/**
 * MCP connect UI — three onboarding paths: Cursor/API, ChatGPT GPT, Claude.ai.
 * Attaches to globalThis.DenizenVisitorMcpConnectUI (no imports).
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-visitor-mcp-connect-style';
  const BTN_ID = 'denizen-visitor-mcp-connect-btn';
  const MODAL_ID = 'denizen-visitor-mcp-connect-modal';

  let connectBtn = null;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${BTN_ID} {
        display: none;
        margin-left: 6px;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(96, 165, 250, 0.15);
        border: 1px solid rgba(96, 165, 250, 0.45);
        color: #93c5fd;
        font: 10px ui-monospace, monospace;
        font-weight: bold;
        cursor: pointer;
        vertical-align: middle;
      }
      #${BTN_ID}:hover { background: rgba(96, 165, 250, 0.28); }
      #${MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 100700;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(2, 6, 23, 0.9);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      #${MODAL_ID} .mcp-card {
        background: #020617;
        border: 1px solid #1f2937;
        border-radius: 10px;
        padding: 20px 22px;
        width: min(560px, calc(100vw - 32px));
        max-height: calc(100vh - 48px);
        overflow: auto;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
      }
      #${MODAL_ID} h3 { margin: 0 0 8px; color: #e2e8f0; font-size: 14px; }
      #${MODAL_ID} p, #${MODAL_ID} li { margin: 0 0 8px; color: #94a3b8; font-size: 11px; line-height: 1.45; }
      #${MODAL_ID} ol { margin: 0 0 10px 18px; padding: 0; }
      #${MODAL_ID} pre {
        background: #0f172a;
        border: 1px solid #1f2937;
        border-radius: 6px;
        padding: 10px;
        color: #cbd5e1;
        font-size: 10px;
        white-space: pre-wrap;
        word-break: break-all;
        margin: 8px 0 12px;
      }
      #${MODAL_ID} .mcp-tabs {
        display: flex;
        gap: 6px;
        margin-bottom: 14px;
        flex-wrap: wrap;
      }
      #${MODAL_ID} .mcp-tab {
        font: inherit;
        font-size: 10px;
        font-weight: bold;
        border-radius: 999px;
        padding: 6px 12px;
        cursor: pointer;
        border: 1px solid #1f2937;
        background: #1e293b;
        color: #94a3b8;
      }
      #${MODAL_ID} .mcp-tab.active {
        background: rgba(96, 165, 250, 0.2);
        border-color: rgba(96, 165, 250, 0.5);
        color: #93c5fd;
      }
      #${MODAL_ID} .mcp-panel { display: none; }
      #${MODAL_ID} .mcp-panel.active { display: block; }
      #${MODAL_ID} .mcp-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        flex-wrap: wrap;
        margin-top: 8px;
      }
      #${MODAL_ID} button {
        font: inherit;
        font-size: 11px;
        font-weight: bold;
        border-radius: 6px;
        padding: 8px 14px;
        cursor: pointer;
        border: 1px solid #1f2937;
      }
      #${MODAL_ID} .mcp-copy {
        background: #1e293b;
        color: #93c5fd;
      }
      #${MODAL_ID} .mcp-close {
        background: #4ade80;
        color: #0f172a;
        border-color: transparent;
      }
      #${MODAL_ID} .mcp-warn {
        color: #fbbf24;
        font-size: 10px;
        margin-bottom: 8px;
      }
      #${MODAL_ID} .mcp-badge {
        display: inline-block;
        font-size: 9px;
        padding: 2px 6px;
        border-radius: 4px;
        background: rgba(74, 222, 128, 0.12);
        color: #4ade80;
        margin-left: 6px;
      }
      #${MODAL_ID} .mcp-badge.blue {
        background: rgba(96, 165, 250, 0.12);
        color: #93c5fd;
      }
      .mcp-set { display: flex; flex-direction: column; gap: 10px; }
      .mcp-set-hint {
        margin: 0 0 4px;
        color: #94a3b8;
        font-size: 11px;
        line-height: 1.45;
      }
      .mcp-set-card {
        border: 1px solid #1e293b;
        border-radius: 12px;
        padding: 10px 12px;
        background: rgba(15, 23, 42, 0.55);
      }
      .mcp-set-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 6px;
      }
      .mcp-set-head strong {
        color: #e2e8f0;
        font-size: 12px;
        font-weight: 700;
      }
      .mcp-set-tag {
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #93c5fd;
        border: 1px solid rgba(96, 165, 250, 0.35);
        border-radius: 999px;
        padding: 2px 7px;
      }
      .mcp-set-tag.ext { color: #fbbf24; border-color: rgba(251, 191, 36, 0.35); }
      .mcp-set-sub { color: #64748b; font-size: 10px; margin-bottom: 6px; }
      .mcp-set-url {
        color: #cbd5e1;
        font: 10px/1.4 ui-monospace, monospace;
        word-break: break-all;
        margin-bottom: 6px;
      }
      .mcp-set-meta { color: #64748b; font-size: 10px; margin-bottom: 8px; }
      .mcp-set-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .mcp-set-actions button {
        border: 1px solid #334155;
        background: #0f172a;
        color: #cbd5e1;
        border-radius: 10px;
        cursor: pointer;
        font: 600 11px/1.2 system-ui, sans-serif;
        padding: 7px 12px;
        touch-action: manipulation;
      }
      .mcp-set-actions button.primary {
        border-color: rgba(96, 165, 250, 0.45);
        color: #93c5fd;
      }
      .mcp-set-actions button:hover { border-color: #60a5fa; color: #dbeafe; }
      .mcp-set-empty { color: #94a3b8; font-size: 11px; line-height: 1.45; margin: 0; }
      .mcp-set-scope {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 8px;
        font-size: 10px;
        color: #94a3b8;
      }
      .mcp-set-scope select {
        border: 1px solid #334155;
        background: #0f172a;
        color: #cbd5e1;
        border-radius: 8px;
        padding: 6px 8px;
        font: 11px system-ui, sans-serif;
      }
      .mcp-set-scope-hint { color: #64748b; font-size: 9px; }
      .mcp-set-jobs {
        color: #93c5fd;
        font-size: 10px;
        line-height: 1.45;
        margin-bottom: 8px;
      }
      .mcp-set-jobs strong { color: #cbd5e1; font-weight: 600; }
      .mcp-addon-title { margin-top: 12px; margin-bottom: 2px; }
      .mcp-addon-note { margin-bottom: 8px; }
      .mcp-addon-prominent {
        border-color: rgba(251, 191, 36, 0.35);
        background: rgba(251, 191, 36, 0.06);
      }
      .mcp-addon-section-title {
        margin: 0 0 6px;
        color: #fbbf24;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .mcp-token-row {
        border-top: 1px solid #1e293b;
        padding-top: 8px;
        margin-top: 8px;
        font-size: 10px;
      }
      .mcp-token-row .mcp-set-meta { margin-bottom: 6px; }
      #${MODAL_ID} .mcp-test {
        background: #1e293b;
        color: #93c5fd;
        border: 1px solid rgba(96, 165, 250, 0.35);
      }
      #${MODAL_ID} .mcp-rotate {
        background: transparent;
        color: #94a3b8;
      }
      #${MODAL_ID} .mcp-scope-line {
        color: #64748b;
        font-size: 10px;
        margin: 0 0 10px;
      }
    `;
    document.head.appendChild(s);
  }

  const JOB_CATEGORIES = [
    { label: 'CRM', tools: ['crm_working_set', 'crm_pipeline_brief', 'business_context_brief', 'crm_list_tasks', 'crm_draft_email', 'mail_policy_status', 'send_draft', 'crm_park_deal'] },
    { label: 'Coding & skills', tools: ['run_skill', 'list_skills'] },
    {
      label: 'Team & tasks',
      tools: [
        'team_standup', 'list_team', 'send_handoff',
        'list_pending_handoffs', 'acknowledge_handoff',
        'team_status', 'run_as_npc', 'broadcast_task',
        'delegate_task', 'assign_task', 'announce_in_office',
      ],
    },
    {
      label: 'Market',
      tools: [
        'get_market_quote', 'get_market_portfolio', 'market_watch',
        'list_trade_suggestions', 'get_watchlist',
      ],
    },
    { label: 'Memory & status', tools: ['get_status', 'update_memory', 'log_activity'] },
    {
      label: 'Mesh & City Power',
      tools: ['enqueue_compute_job', 'get_job_status', 'get_inference_nodes'],
    },
    {
      label: 'Cursor bridge',
      tools: [
        'enqueue_cursor_work', 'list_cursor_work',
        'claim_cursor_work', 'complete_cursor_work',
      ],
    },
  ];

  const OPTIONAL_ADDONS = [
    {
      id: 'robinhood',
      title: 'Robinhood (trading only)',
      subtitle: 'Optional second MCP in Cursor — live quotes & portfolio. CRM, coding, and research stay on your Denizen URL via run_skill.',
      url: 'https://agent.robinhood.com/mcp/trading',
    },
  ];

  function formatJobSummary(tools) {
    if (!Array.isArray(tools) || !tools.length) {
      return 'CRM · coding · research · team handoffs';
    }
    const set = new Set(tools);
    const labels = JOB_CATEGORIES
      .filter((c) => c.tools.some((t) => set.has(t)))
      .map((c) => c.label);
    return labels.length ? labels.join(' · ') : `${tools.length} MCP tools`;
  }

  const SCOPE_PRESET_OPTIONS = [
    { id: 'full', label: 'Full access', hint: 'read · skills · CRM · handoffs · delegate · compute' },
    { id: 'standard', label: 'Standard', hint: 'read · skills · handoffs' },
    { id: 'read', label: 'Read only', hint: 'status · memory sync · no skills' },
  ];

  function scopeSelectHtml(selected = 'full') {
    const opts = SCOPE_PRESET_OPTIONS.map((p) => (
      `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${p.label}</option>`
    )).join('');
    return `<label class="mcp-set-scope">Access
      <select data-scope-preset>${opts}</select>
      <span class="mcp-set-scope-hint">${SCOPE_PRESET_OPTIONS.find((p) => p.id === selected)?.hint || ''}</span>
    </label>`;
  }

  function readScopePreset(el) {
    return el?.querySelector?.('[data-scope-preset]')?.value || 'full';
  }

  function sessionAuthHeaders() {
    const sess = globalThis.DenizenVisitorSession;
    const token = sess?.getSessionToken?.();
    if (!token) return {};
    return { 'X-Session-Token': token };
  }

  async function createTeamToken(opts = {}) {
    const sess = globalThis.DenizenVisitorSession;
    const sessionId = sess?.getSessionId?.();
    if (!sessionId) throw new Error('No visitor session');

    const res = await fetch('/api/mcp/team-tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...sessionAuthHeaders(),
      },
      body: JSON.stringify({
        session_id: sessionId,
        label: opts.label || 'team-operator',
        scope_preset: opts.scopePreset || opts.scope_preset || 'full',
        scopes: opts.scopes,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  async function fetchConnectInfo({ npcKey, team } = {}) {
    const u = new URL('/api/mcp/connect-info', window.location.origin);
    if (team) u.searchParams.set('team', '1');
    else if (npcKey) u.searchParams.set('npc_key', npcKey);
    const sess = globalThis.DenizenVisitorSession;
    const sid = sess?.getSessionId?.();
    if (sid) u.searchParams.set('session_id', sid);
    const res = await fetch(u.toString(), { headers: sessionAuthHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function canUseTeamMcp() {
    const sess = globalThis.DenizenVisitorSession;
    const tier = sess?.getAccessTier?.() || sess?.getTier?.();
    return tier === 'team' || tier === 'owner' || sess?.isTeamSession?.();
  }

  function getAssistantConnection() {
    const sess = globalThis.DenizenVisitorSession;
    const asst = sess?.getAssistant?.();
    if (!asst?.npc_key || sess?.isProtectedNpc?.(asst.npc_key)) return null;
    return {
      id: 'assistant',
      npcKey: asst.npc_key,
      title: asst.assistant_name || asst.npc_key,
      tag: 'Assistant',
    };
  }

  async function renderSettingsPanel(hostEl) {
    if (!hostEl) return;
    injectStyles();
    hostEl.innerHTML = '<p class="mcp-set-empty">Loading connections…</p>';

    const cards = [];
    const assistant = getAssistantConnection();
    if (assistant) cards.push({ ...assistant, team: false });
    if (canUseTeamMcp()) {
      cards.push({
        id: 'team',
        npcKey: '_team',
        title: 'Team operator',
        tag: 'Whole office',
        team: true,
      });
    }

    if (!cards.length) {
      hostEl.innerHTML = `
        <p class="mcp-set-hint">Connect Cursor or Claude to Denizen for CRM, coding, research, and office jobs — one MCP URL.</p>
        <p class="mcp-set-empty">Claim an assistant in chat first, then return here to connect.</p>`;
      renderOptionalAddons(hostEl, { prominent: true });
      return;
    }

    const infos = await Promise.all(cards.map(async (c) => {
      try {
        const info = await fetchConnectInfo({ npcKey: c.team ? null : c.npcKey, team: c.team });
        return { ...c, info, error: null };
      } catch (err) {
        return { ...c, info: null, error: err?.message || 'Unavailable' };
      }
    }));

    hostEl.innerHTML = `
      <p class="mcp-set-hint">Your Denizen URL runs CRM, coding-agent, research, mockups, and team jobs via <code>run_skill</code> — connect once in Cursor or Claude.</p>
      <div class="mcp-set" id="mcp-set-denizen"></div>
      <div id="mcp-set-addons"></div>`;
    const denizenHost = hostEl.querySelector('#mcp-set-denizen');
    const addonsHost = hostEl.querySelector('#mcp-set-addons');

    for (const row of infos) {
      const card = document.createElement('div');
      card.className = 'mcp-set-card';
      card.dataset.mcpId = row.id;
      const url = row.info?.mcp_url || '—';
      const tools = row.info?.tools || [];
      const jobs = formatJobSummary(tools);
      const meta = row.error
        ? row.error
        : (tools.length ? `${tools.length} tools` : 'Ready to connect');
      card.innerHTML = `
        <div class="mcp-set-head">
          <strong>${escHtml(row.title)}</strong>
          <span class="mcp-set-tag">${escHtml(row.tag)}</span>
        </div>
        <div class="mcp-set-url">${escHtml(url)}</div>
        <div class="mcp-set-jobs"><strong>Jobs:</strong> ${escHtml(jobs)}</div>
        <div class="mcp-set-meta">${escHtml(meta)}</div>
        ${scopeSelectHtml('full')}
        <div class="mcp-set-actions">
          <button type="button" class="primary" data-act="connect">Connect</button>
          <button type="button" data-act="copy-url" ${row.info?.mcp_url ? '' : 'disabled'}>Copy URL</button>
        </div>`;
      const scopeSelect = card.querySelector('[data-scope-preset]');
      scopeSelect?.addEventListener('change', () => {
        const hint = card.querySelector('.mcp-set-scope-hint');
        const preset = SCOPE_PRESET_OPTIONS.find((p) => p.id === scopeSelect.value);
        if (hint && preset) hint.textContent = preset.hint;
      });
      card.querySelector('[data-act="connect"]')?.addEventListener('click', () => {
        const preset = readScopePreset(card);
        if (row.team) openTeamConnectFlow(preset);
        else openConnectFlow(row.npcKey, row.title, preset);
      });
      card.querySelector('[data-act="copy-url"]')?.addEventListener('click', async (e) => {
        if (!row.info?.mcp_url) return;
        await copyText(row.info.mcp_url);
        const btn = e.currentTarget;
        const prev = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = prev; }, 1500);
      });
      denizenHost.appendChild(card);
    }

    renderOptionalAddons(addonsHost, { prominent: true });
    await renderActiveTokens(hostEl);
  }

  async function listTokens() {
    const sess = globalThis.DenizenVisitorSession;
    const sessionId = sess?.getSessionId?.();
    if (!sessionId) return { ok: false, tokens: [] };
    const u = new URL('/api/mcp/tokens', window.location.origin);
    u.searchParams.set('session_id', sessionId);
    const res = await fetch(u.toString(), { headers: sessionAuthHeaders() });
    return res.json().catch(() => ({ ok: false, tokens: [] }));
  }

  async function revokeToken(tokenId) {
    const sess = globalThis.DenizenVisitorSession;
    const sessionId = sess?.getSessionId?.();
    if (!sessionId || !tokenId) throw new Error('Missing session or token');
    const res = await fetch('/api/mcp/tokens/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
      body: JSON.stringify({ session_id: sessionId, token_id: tokenId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function testMcpConnection(payload) {
    const sess = globalThis.DenizenVisitorSession;
    const sessionId = sess?.getSessionId?.();
    if (!sessionId || !payload?.token) throw new Error('No session or token');
    const res = await fetch('/api/mcp/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
      body: JSON.stringify({
        session_id: sessionId,
        token: payload.token,
        team: payload.npc_key === '_team',
      }),
    });
    return res.json().catch(() => ({ ok: false, error: 'test_failed' }));
  }

  function formatTokenWhen(iso) {
    if (!iso) return 'never';
    try {
      return new Date(iso).toLocaleString();
    } catch (_) {
      return String(iso);
    }
  }

  async function renderActiveTokens(hostEl) {
    const listed = await listTokens();
    if (!listed.ok || !listed.tokens?.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'mcp-set';
    wrap.innerHTML = '<p class="mcp-set-hint" style="margin-top:10px">Active tokens — revoke any connection you no longer trust.</p>';
    for (const t of listed.tokens) {
      const row = document.createElement('div');
      row.className = 'mcp-set-card mcp-token-row';
      const scopes = Array.isArray(t.scopes) ? t.scopes.join(', ') : 'full';
      const label = t.label || t.npc_key;
      row.innerHTML = `
        <div class="mcp-set-head">
          <strong>${escHtml(label)}</strong>
          <span class="mcp-set-tag">${escHtml(t.npc_key === '_team' ? 'Team' : 'NPC')}</span>
        </div>
        <div class="mcp-set-meta">Scopes: ${escHtml(scopes)} · last used ${escHtml(formatTokenWhen(t.last_used_at))}</div>
        <div class="mcp-set-actions">
          <button type="button" data-act="revoke">Revoke</button>
        </div>`;
      row.querySelector('[data-act="revoke"]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (!confirm(`Revoke token for ${label}? Connected AIs will stop working.`)) return;
        btn.disabled = true;
        try {
          await revokeToken(t.id);
          row.remove();
        } catch (err) {
          alert(err?.message || 'Could not revoke');
          btn.disabled = false;
        }
      });
      wrap.appendChild(row);
    }
    hostEl.appendChild(wrap);
  }

  function renderOptionalAddons(hostEl, { prominent = false } = {}) {
    if (!OPTIONAL_ADDONS.length) return;
    const title = document.createElement('p');
    title.className = prominent ? 'mcp-addon-section-title' : 'mcp-set-hint mcp-addon-title';
    title.textContent = prominent ? 'Optional: Robinhood trading MCP' : 'Optional add-ons';
    hostEl.appendChild(title);
    const note = document.createElement('p');
    note.className = 'mcp-set-sub mcp-addon-note';
    note.textContent = prominent
      ? 'Separate from Denizen above — live quotes & portfolio for Roki. CRM, coding, and office work stay on your Denizen URL.'
      : 'Robinhood is separate — trading quotes only. CRM, coding, and office work use your Denizen URL above.';
    hostEl.appendChild(note);
    const wrap = document.createElement('div');
    wrap.className = 'mcp-set';
    for (const ext of OPTIONAL_ADDONS) {
      const card = document.createElement('div');
      card.className = prominent ? 'mcp-set-card mcp-addon-prominent' : 'mcp-set-card';
      card.innerHTML = `
        <div class="mcp-set-head">
          <strong>${escHtml(ext.title)}</strong>
          <span class="mcp-set-tag ext">Trading</span>
        </div>
        <div class="mcp-set-sub">${escHtml(ext.subtitle)}</div>
        <div class="mcp-set-url">${escHtml(ext.url)}</div>
        <div class="mcp-set-actions">
          <button type="button" data-act="copy-url">Copy URL</button>
        </div>`;
      card.querySelector('[data-act="copy-url"]')?.addEventListener('click', async (e) => {
        await copyText(ext.url);
        const btn = e.currentTarget;
        const prev = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = prev; }, 1500);
      });
      wrap.appendChild(card);
    }
    hostEl.appendChild(wrap);
  }

  async function createToken(npcKey, opts = {}) {
    const sess = globalThis.DenizenVisitorSession;
    const sessionId = sess?.getSessionId?.();
    if (!sessionId) throw new Error('No visitor session');

    const clientType = opts.clientType || opts.client_type || null;
    const label = opts.label
      || (clientType === 'chatgpt' ? 'chatgpt' : 'visitor-ui');

    const res = await fetch('/api/mcp/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...sessionAuthHeaders(),
      },
      body: JSON.stringify({
        session_id: sessionId,
        npc_key: npcKey,
        label,
        scope_preset: opts.scopePreset || opts.scope_preset || 'full',
        scopes: opts.scopes,
        client_type: clientType,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text);
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return Promise.resolve();
  }

  function closeModal() {
    const el = document.getElementById(MODAL_ID);
    if (el) el.remove();
  }

  function bindCopyButtons(root, getText) {
    root.querySelectorAll('.mcp-copy').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const key = btn.getAttribute('data-copy');
        const text = getText(key);
        await copyText(text);
        const label = btn.getAttribute('data-label') || key;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = `Copy ${label}`; }, 1500);
      });
    });
  }

  function showTokenModal(npcKey, displayName, payload) {
    injectStyles();
    closeModal();

    const configJson = JSON.stringify(payload.cursor_config || payload.claude_desktop_config, null, 2);
    const uiInspectConfig = JSON.stringify({
      mcpServers: {
        'denizen-ui-inspect': {
          command: 'node',
          args: ['denizen/mcp-ui-inspect/start.cjs'],
        },
      },
    }, null, 2);
    const openapiUrl = payload.rest_sync?.openapi_url || payload.chatgpt?.openapi_url || '';
    const gptInstructions = payload.chatgpt?.gpt_instructions || '';
    const chatgptSteps = (payload.chatgpt?.steps || []).map((s) => `<li>${s}</li>`).join('');
    const claudeSteps = (payload.claude_ai?.steps || []).map((s) => `<li>${s}</li>`).join('');

    const mcpUrl = payload.mcp_url || '';
    const scopeLine = Array.isArray(payload.scopes) && payload.scopes.length
      ? payload.scopes.join(', ')
      : 'full';
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="mcp-card">
        <h3>Connect your AI to ${displayName}</h3>
        <p class="mcp-scope-line">Token scopes: ${escHtml(scopeLine)}</p>
        <p>CRM, coding, research, and team jobs run through this connection (<code>run_skill</code>, CRM tools).</p>
        <div class="mcp-rh-box" style="margin:10px 0;padding:10px 12px;border:1px solid rgba(251,191,36,0.35);border-radius:10px;background:rgba(251,191,36,0.06);">
          <strong style="color:#fbbf24;">Robinhood (optional, separate)</strong>
          <p style="margin:6px 0 8px;color:#94a3b8;font-size:12px;line-height:1.45;">Trading-only second MCP for live quotes &amp; portfolio (Roki). Not included in the Denizen URL — add manually in Cursor if you want it.</p>
          <code style="font-size:11px;word-break:break-all;">https://agent.robinhood.com/mcp/trading</code>
        </div>
        <div class="mcp-tabs">
          <button type="button" class="mcp-tab active" data-tab="oauth">1-Click<span class="mcp-badge">Easiest</span></button>
          <button type="button" class="mcp-tab" data-tab="companion">Companion</button>
          <button type="button" class="mcp-tab" data-tab="cursor">Cursor / API</button>
          <button type="button" class="mcp-tab" data-tab="chatgpt">ChatGPT GPT<span class="mcp-badge">Plus OK</span></button>
          <button type="button" class="mcp-tab" data-tab="claude">Claude.ai</button>
        </div>

        <div class="mcp-panel active" data-panel="oauth">
          <p>Works with <strong>Claude.ai</strong>, <strong>ChatGPT</strong> (Pro/Business connectors), <strong>Cursor</strong>, and Claude Desktop. Paste this URL — your AI opens a Denizen sign-in to authorize, then connects itself.</p>
          <p>MCP URL:</p>
          <pre>${mcpUrl}</pre>
          <ol>
            <li><strong>Claude.ai</strong>: Settings → Connectors → Add custom connector → paste URL → Connect → Authorize</li>
            <li><strong>ChatGPT</strong>: Settings → Connectors → Add → paste URL → Authorize</li>
            <li><strong>Cursor</strong>: Settings → MCP → Add → paste URL → it opens the sign-in</li>
          </ol>
          <p class="mcp-warn">No bearer token needed — authorization happens in your browser.</p>
          <div class="mcp-actions">
            <button type="button" class="mcp-copy" data-copy="url" data-label="URL">Copy URL</button>
          </div>
        </div>

        <div class="mcp-panel" data-panel="companion">
          <p>Browser extension — provider-agnostic. Works with any AI; no MCP or API config.</p>
          <ol>
            <li>Install <code>denizen/companion-extension</code> in Chrome (Load unpacked)</li>
            <li>Credentials sync automatically from this page</li>
            <li>Right-click text → <strong>Send to Denizen NPC</strong></li>
            <li>Or use <strong>Ctrl+Shift+D</strong> to push clipboard</li>
          </ol>
          <p>Extension popup: refresh status, send memory, log activity.</p>
          <p class="mcp-warn">Token saved to extension storage on this device only.</p>
          <div class="mcp-actions">
            <button type="button" class="mcp-copy" data-copy="token" data-label="token">Copy token (manual fallback)</button>
          </div>
        </div>

        <div class="mcp-panel" data-panel="cursor">
          <p>For Cursor, Cline, Claude Desktop, or any MCP client with an API key.</p>
          <p>MCP URL:</p>
          <pre>${payload.mcp_url || ''}</pre>
          <p>Bearer token:</p>
          <pre>${payload.token || ''}</pre>
          <p>Config snippet:</p>
          <pre>${configJson}</pre>
          <p><strong>Phone UI inspect (local stdio MCP):</strong> tool <code>capture_denizen_phone_app</code> — see <code>denizen/mcp-ui-inspect/README.md</code>.</p>
          <pre>${uiInspectConfig}</pre>
          <div class="mcp-actions">
            <button type="button" class="mcp-copy" data-copy="url" data-label="URL">Copy URL</button>
            <button type="button" class="mcp-copy" data-copy="token" data-label="token">Copy token</button>
            <button type="button" class="mcp-copy" data-copy="config" data-label="config">Copy config</button>
            <button type="button" class="mcp-copy" data-copy="ui-inspect" data-label="UI inspect config">Copy UI inspect</button>
          </div>
        </div>

        <div class="mcp-panel" data-panel="chatgpt">
          <p>ChatGPT Plus Custom GPT — no API key on your side. Stays within OpenAI ToS.</p>
          <ol>${chatgptSteps}</ol>
          <p>OpenAPI URL (import in GPT Actions):</p>
          <pre>${openapiUrl}</pre>
          <p>Bearer token (GPT Action auth):</p>
          <pre>${payload.token || ''}</pre>
          <p>Suggested GPT instructions:</p>
          <pre>${gptInstructions}</pre>
          <div class="mcp-actions">
            <button type="button" class="mcp-copy" data-copy="openapi" data-label="OpenAPI URL">Copy OpenAPI URL</button>
            <button type="button" class="mcp-copy" data-copy="token" data-label="token">Copy token</button>
            <button type="button" class="mcp-copy" data-copy="gpt" data-label="instructions">Copy instructions</button>
          </div>
        </div>

        <div class="mcp-panel" data-panel="claude">
          <p>Claude.ai MCP connector — Pro subscription, no API billing.</p>
          <ol>${claudeSteps}</ol>
          <p>Connector URL:</p>
          <pre>${payload.claude_ai?.connector_url || payload.mcp_url || ''}</pre>
          <p>Authorization header:</p>
          <pre>Bearer ${payload.token || ''}</pre>
          <p class="mcp-warn">If MCP connector is unavailable, use the ChatGPT tab REST path or Cursor/API instead.</p>
          <div class="mcp-actions">
            <button type="button" class="mcp-copy" data-copy="claude-url" data-label="connector URL">Copy connector URL</button>
            <button type="button" class="mcp-copy" data-copy="claude-auth" data-label="auth header">Copy auth header</button>
          </div>
        </div>

        <div class="mcp-actions">
          <button type="button" class="mcp-test">Test connection</button>
          <button type="button" class="mcp-rotate">Rotate token</button>
          <button type="button" class="mcp-close">Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const texts = {
      url: payload.mcp_url || '',
      token: payload.token || '',
      config: configJson,
      'ui-inspect': uiInspectConfig,
      openapi: openapiUrl,
      gpt: gptInstructions,
      'claude-url': payload.claude_ai?.connector_url || payload.mcp_url || '',
      'claude-auth': `Bearer ${payload.token || ''}`,
    };

    modal.querySelectorAll('.mcp-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const id = tab.getAttribute('data-tab');
        modal.querySelectorAll('.mcp-tab').forEach((t) => t.classList.toggle('active', t === tab));
        modal.querySelectorAll('.mcp-panel').forEach((p) => {
          p.classList.toggle('active', p.getAttribute('data-panel') === id);
        });
      });
    });

    bindCopyButtons(modal, (key) => texts[key] || '');
    const testBtn = modal.querySelector('.mcp-test');
    testBtn?.addEventListener('click', async () => {
      testBtn.disabled = true;
      const prev = testBtn.textContent;
      testBtn.textContent = 'Testing…';
      try {
        const out = await testMcpConnection(payload);
        testBtn.textContent = out.ok ? 'Connected ✓' : `Failed: ${out.result?.error || out.error || 'unknown'}`;
      } catch (err) {
        testBtn.textContent = `Failed: ${err?.message || 'error'}`;
      }
      setTimeout(() => {
        testBtn.textContent = prev;
        testBtn.disabled = false;
      }, 3500);
    });
    modal.querySelector('.mcp-rotate')?.addEventListener('click', async () => {
      if (!confirm('Create a new token and revoke this one? Update Cursor/ChatGPT with the new bearer token.')) return;
      try {
        if (payload.token_id) await revokeToken(payload.token_id);
        const activeTab = modal.querySelector('.mcp-tab.active')?.getAttribute('data-tab');
        const clientType = activeTab === 'chatgpt' ? 'chatgpt' : null;
        const fresh = npcKey === '_team'
          ? await createTeamToken({ scopes: payload.scopes })
          : await createToken(npcKey, {
            scopes: payload.scopes,
            clientType,
            label: clientType === 'chatgpt' ? 'chatgpt' : 'visitor-ui',
          });
        if (npcKey !== '_team') syncCompanion(fresh, displayName);
        showTokenModal(npcKey, displayName, fresh);
      } catch (err) {
        alert(err?.message || 'Could not rotate token');
      }
    });
    modal.querySelector('.mcp-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  function syncCompanion(payload, displayName) {
    try {
      globalThis.DenizenCompanionBridge?.saveCredentials?.(payload, displayName);
    } catch (_) { /* extension optional */ }
  }

  async function openTeamConnectFlow(scopePreset = 'full') {
    try {
      const payload = await createTeamToken({ scopePreset });
      showTokenModal('_team', 'Team Operator', payload);
    } catch (err) {
      console.warn('[DenizenVisitorMcpConnectUI]', err);
      alert(err?.message || 'Could not create team MCP token');
    }
  }

  async function openConnectFlow(npcKey, displayName, scopePreset = 'full') {
    try {
      const payload = await createToken(npcKey, { scopePreset });
      syncCompanion(payload, displayName);
      showTokenModal(npcKey, displayName, payload);
    } catch (err) {
      console.warn('[DenizenVisitorMcpConnectUI]', err);
      alert(err?.message || 'Could not create MCP token');
    }
  }

  function ensureConnectBtn() {
    if (connectBtn) return connectBtn;
    injectStyles();
    const chip = document.getElementById('denizen-visitor-assistant-chip');
    connectBtn = document.createElement('button');
    connectBtn.id = BTN_ID;
    connectBtn.type = 'button';
    connectBtn.textContent = 'Connect AI';
    chip?.parentNode?.insertBefore(connectBtn, chip?.nextSibling);
    return connectBtn;
  }

  function refreshButton() {
    const sess = globalThis.DenizenVisitorSession;
    const btn = ensureConnectBtn();
    const asst = sess?.getAssistant?.();
    if (!asst?.npc_key || sess?.isProtectedNpc?.(asst.npc_key)) {
      btn.style.display = 'none';
      return;
    }
    const name = asst.assistant_name || asst.npc_key;
    btn.style.display = 'inline';
    btn.onclick = () => openConnectFlow(asst.npc_key, name);

    let teamBtn = document.getElementById('denizen-visitor-team-mcp-btn');
    if (!teamBtn) {
      teamBtn = document.createElement('button');
      teamBtn.id = 'denizen-visitor-team-mcp-btn';
      teamBtn.type = 'button';
      teamBtn.textContent = 'Team MCP';
      teamBtn.title = 'Connect Cursor/Claude to operate the whole office';
      teamBtn.style.marginLeft = '6px';
      btn.parentNode?.insertBefore(teamBtn, btn.nextSibling);
    }
    const tier = sess?.getAccessTier?.() || sess?.getTier?.();
    const showTeam = tier === 'team' || tier === 'owner' || sess?.isTeamSession?.();
    teamBtn.style.display = showTeam ? 'inline' : 'none';
    teamBtn.onclick = () => openTeamConnectFlow();
  }

  const OFFER_ID = 'denizen-visitor-mcp-offer';

  function escHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function injectOfferStyles() {
    if (document.getElementById(`${OFFER_ID}-style`)) return;
    const s = document.createElement('style');
    s.id = `${OFFER_ID}-style`;
    s.textContent = `
      #${OFFER_ID} {
        position: fixed;
        inset: 0;
        z-index: 100700;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(2, 6, 23, 0.82);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        touch-action: manipulation;
      }
      #${OFFER_ID} .mcp-offer-card {
        background: #020617;
        border: 1px solid #1f2937;
        border-radius: 10px;
        padding: 20px 22px;
        width: min(380px, calc(100vw - 32px));
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
      }
      #${OFFER_ID} h3 { margin: 0 0 8px; color: #e2e8f0; font-size: 14px; }
      #${OFFER_ID} p { margin: 0 0 14px; color: #94a3b8; font-size: 11px; line-height: 1.5; }
      #${OFFER_ID} .mcp-offer-actions { display: flex; gap: 8px; justify-content: flex-end; }
      #${OFFER_ID} .mcp-offer-actions button {
        font: inherit;
        font-size: 11px;
        font-weight: bold;
        border-radius: 6px;
        padding: 8px 14px;
        cursor: pointer;
        border: 1px solid #1f2937;
        min-height: 40px;
        touch-action: manipulation;
      }
      #${OFFER_ID} .mcp-offer-skip { background: #1e293b; color: #94a3b8; }
      #${OFFER_ID} .mcp-offer-connect { background: #4ade80; color: #0f172a; border-color: transparent; }
    `;
    document.head.appendChild(s);
  }

  // Replaces a blocking window.confirm() — a dismissible, in-app, themed prompt
  // that doesn't trap the user and matches the rest of the claim flow.
  function showOfferCard(npcKey, displayName) {
    injectOfferStyles();
    document.getElementById(OFFER_ID)?.remove();
    const name = escHtml(displayName || 'your assistant');
    const overlay = document.createElement('div');
    overlay.id = OFFER_ID;
    overlay.innerHTML = `
      <div class="mcp-offer-card" role="dialog" aria-label="Connect an external AI">
        <h3>Connect an external AI to ${name}?</h3>
        <p>Optional — let ChatGPT, Claude, or Cursor work through ${name}. You can do this anytime from the <strong>Connect AI</strong> button in the chat header.</p>
        <div class="mcp-offer-actions">
          <button type="button" class="mcp-offer-skip">Not now</button>
          <button type="button" class="mcp-offer-connect">Connect</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    const skip = overlay.querySelector('.mcp-offer-skip');
    const connect = overlay.querySelector('.mcp-offer-connect');
    const onConnect = () => { close(); openConnectFlow(npcKey, displayName); };
    // Bind via ONE mechanism only (avoid double-firing onConnect → two modals).
    const bind = globalThis.DenizenTouchBind?.bindPress;
    if (bind) {
      if (skip) bind(skip, close, { stop: true });
      if (connect) bind(connect, onConnect, { stop: true });
    } else {
      skip?.addEventListener('click', close);
      connect?.addEventListener('click', onConnect);
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  const DenizenVisitorMcpConnectUI = {
    attach() {
      injectStyles();
      refreshButton();
      setInterval(refreshButton, 2000);
      console.log('[DenizenVisitorMcpConnectUI] attached');
    },

    openConnect(npcKey = null, displayName = null) {
      const asst = globalThis.DenizenVisitorSession?.getAssistant?.();
      const key = npcKey || asst?.npc_key;
      const name = displayName || asst?.assistant_name || key;
      if (!key) {
        alert('Claim an assistant first, then connect MCP.');
        return;
      }
      openConnectFlow(key, name);
    },

    /** Open MCP connect for whoever is currently in player chat (avatar letter click). */
    openConnectForActiveChat() {
      const pc = globalThis.playerChat || globalThis.DenizenPlayerChat;
      const name = pc?._currentChatTargetName;
      if (!name) {
        alert('Click an NPC first, then tap their letter avatar to open MCP connect.');
        return;
      }
      const display = typeof pc._displayNpcName === 'function'
        ? pc._displayNpcName(name)
        : name;
      const folder = typeof pc._folderForNpcName === 'function'
        ? pc._folderForNpcName(display)
        : String(display).toLowerCase();
      this.openConnect(folder, display);
    },

    openTeamConnect() {
      openTeamConnectFlow();
    },

    renderSettingsPanel(hostEl) {
      return renderSettingsPanel(hostEl);
    },

    offerAfterClaim(npcKey, displayName) {
      refreshButton();
      setTimeout(() => showOfferCard(npcKey, displayName), 400);
    },
  };

  globalThis.DenizenVisitorMcpConnectUI = DenizenVisitorMcpConnectUI;
})();
