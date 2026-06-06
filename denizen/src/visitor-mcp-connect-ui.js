/**
 * MCP connect UI — let teammates link Claude/Cursor to their claimed NPC.
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
        width: min(520px, calc(100vw - 32px));
        max-height: calc(100vh - 48px);
        overflow: auto;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
      }
      #${MODAL_ID} h3 { margin: 0 0 8px; color: #e2e8f0; font-size: 14px; }
      #${MODAL_ID} p { margin: 0 0 10px; color: #94a3b8; font-size: 11px; line-height: 1.45; }
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
      #${MODAL_ID} .mcp-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        flex-wrap: wrap;
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
    `;
    document.head.appendChild(s);
  }

  function sessionAuthHeaders() {
    const sess = globalThis.DenizenVisitorSession;
    const token = sess?.getSessionToken?.();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
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

  function showTokenModal(npcKey, displayName, payload) {
    injectStyles();
    closeModal();

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const configJson = JSON.stringify(payload.cursor_config || payload.claude_desktop_config, null, 2);
    modal.innerHTML = `
      <div class="mcp-card">
        <h3>Connect your AI to ${displayName}</h3>
        <p class="mcp-warn">${payload.warning || 'Save this token now — it cannot be retrieved again.'}</p>
        <p>MCP URL:</p>
        <pre id="denizen-mcp-url">${payload.mcp_url || ''}</pre>
        <p>Bearer token:</p>
        <pre id="denizen-mcp-token">${payload.token || ''}</pre>
        <p>Cursor / Claude Desktop config snippet:</p>
        <pre id="denizen-mcp-config">${configJson}</pre>
        <div class="mcp-actions">
          <button type="button" class="mcp-copy" data-copy="url">Copy URL</button>
          <button type="button" class="mcp-copy" data-copy="token">Copy token</button>
          <button type="button" class="mcp-copy" data-copy="config">Copy config</button>
          <button type="button" class="mcp-close">Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.mcp-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
    modal.querySelectorAll('.mcp-copy').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const kind = btn.getAttribute('data-copy');
        let text = '';
        if (kind === 'url') text = payload.mcp_url || '';
        if (kind === 'token') text = payload.token || '';
        if (kind === 'config') text = configJson;
        await copyText(text);
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = `Copy ${kind}`; }, 1500);
      });
    });
  }

  async function openConnectFlow(npcKey, displayName) {
    try {
      const payload = await createToken(npcKey);
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
        if (confirm(`Connect Claude or Cursor to ${displayName}?`)) {
          openConnectFlow(npcKey, displayName);
        }
      }, 400);
    },
  };

  globalThis.DenizenVisitorMcpConnectUI = DenizenVisitorMcpConnectUI;
})();
