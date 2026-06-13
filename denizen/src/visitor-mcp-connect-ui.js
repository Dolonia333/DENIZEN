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
    `;
    document.head.appendChild(s);
  }

  function sessionAuthHeaders() {
    const sess = globalThis.DenizenVisitorSession;
    const token = sess?.getSessionToken?.();
    if (!token) return {};
    return { 'X-Session-Token': token };
  }

  async function createToken(npcKey) {
    const sess = globalThis.DenizenVisitorSession;
    const sessionId = sess?.getSessionId?.();
    if (!sessionId) throw new Error('No visitor session');

    const res = await fetch('/api/mcp/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...sessionAuthHeaders(),
      },
      body: JSON.stringify({
        session_id: sessionId,
        npc_key: npcKey,
        label: 'visitor-ui',
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
    const openapiUrl = payload.rest_sync?.openapi_url || payload.chatgpt?.openapi_url || '';
    const gptInstructions = payload.chatgpt?.gpt_instructions || '';
    const chatgptSteps = (payload.chatgpt?.steps || []).map((s) => `<li>${s}</li>`).join('');
    const claudeSteps = (payload.claude_ai?.steps || []).map((s) => `<li>${s}</li>`).join('');

    const mcpUrl = payload.mcp_url || '';
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="mcp-card">
        <h3>Connect your AI to ${displayName}</h3>
        <p>Use your existing AI subscription — paste one URL and approve. No token to copy.</p>
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
          <div class="mcp-actions">
            <button type="button" class="mcp-copy" data-copy="url" data-label="URL">Copy URL</button>
            <button type="button" class="mcp-copy" data-copy="token" data-label="token">Copy token</button>
            <button type="button" class="mcp-copy" data-copy="config" data-label="config">Copy config</button>
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
          <button type="button" class="mcp-close">Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const texts = {
      url: payload.mcp_url || '',
      token: payload.token || '',
      config: configJson,
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

  async function openConnectFlow(npcKey, displayName) {
    try {
      const payload = await createToken(npcKey);
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
  }

  const DenizenVisitorMcpConnectUI = {
    attach() {
      injectStyles();
      refreshButton();
      setInterval(refreshButton, 2000);
      console.log('[DenizenVisitorMcpConnectUI] attached');
    },

    offerAfterClaim(npcKey, displayName) {
      refreshButton();
      setTimeout(() => {
        if (confirm(`Connect an external AI to ${displayName}? (ChatGPT, Claude, or Cursor)`)) {
          openConnectFlow(npcKey, displayName);
        }
      }, 400);
    },
  };

  globalThis.DenizenVisitorMcpConnectUI = DenizenVisitorMcpConnectUI;
})();
