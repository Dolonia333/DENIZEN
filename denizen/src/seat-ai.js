/**
 * Seat an AI — detect Cursor / Claude / Grok / LM Studio and MCP-connect
 * them to the matching desk. Reuses DenizenVisitorMcpConnectUI.
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-seat-ai-style';
  const MODAL_ID = 'denizen-seat-ai-modal';

  let overlay = null;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${MODAL_ID} {
        position: fixed; inset: 0; z-index: 100800;
        display: flex; align-items: center; justify-content: center;
        background: rgba(2, 6, 23, 0.88);
        font-family: "IBM Plex Sans", system-ui, sans-serif;
      }
      #${MODAL_ID} .seat-card {
        width: min(640px, calc(100vw - 28px));
        max-height: calc(100vh - 40px);
        overflow: auto;
        background: #071018;
        border: 1px solid rgba(163,230,53,0.28);
        border-radius: 16px;
        padding: 18px 18px 14px;
        color: #e2e8f0;
      }
      #${MODAL_ID} h3 { margin: 0 0 6px; font-size: 16px; color: #f8fafc; }
      #${MODAL_ID} .seat-lead { margin: 0 0 14px; color: #94a3b8; font-size: 13px; line-height: 1.45; }
      #${MODAL_ID} .seat-grid { display: grid; gap: 8px; }
      #${MODAL_ID} .seat-row {
        display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center;
        border: 1px solid #1e293b; border-radius: 12px; padding: 10px 12px; background: #020617;
      }
      #${MODAL_ID} .seat-row b { display: block; color: #f8fafc; font-size: 13px; }
      #${MODAL_ID} .seat-row small { color: #94a3b8; font-size: 11px; line-height: 1.4; }
      #${MODAL_ID} .seat-row .seat-state { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; }
      #${MODAL_ID} .seat-row.is-seated { border-color: rgba(163,230,53,0.4); }
      #${MODAL_ID} .seat-row.is-seated .seat-state { color: #a3e635; }
      #${MODAL_ID} .seat-row button, #${MODAL_ID} .seat-close {
        border: 0; border-radius: 999px; padding: 7px 12px; cursor: pointer; font-weight: 700;
      }
      #${MODAL_ID} .seat-row button { background: #a3e635; color: #052e16; }
      #${MODAL_ID} .seat-row button[disabled] { opacity: 0.45; cursor: default; }
      #${MODAL_ID} .seat-close { background: transparent; color: #94a3b8; float: right; }
    `;
    document.head.appendChild(s);
  }

  function sessionAuthHeaders() {
    const sess = globalThis.DenizenVisitorSession;
    const token = sess?.getSessionToken?.();
    if (!token) return {};
    return { 'X-Session-Token': token };
  }

  async function loadStatus() {
    const sess = globalThis.DenizenVisitorSession;
    const sid = sess?.getSessionId?.();
    const u = new URL('/api/seat-ai', window.location.origin);
    if (sid) u.searchParams.set('session_id', sid);
    const res = await fetch(u.toString(), { headers: sessionAuthHeaders() });
    const json = await res.json().catch(() => ({}));
    let detected = {};
    if (globalThis.DenizenDesktop?.detectSeatAi) {
      try { detected = await globalThis.DenizenDesktop.detectSeatAi(); } catch (_) {}
    }
    if (json.ok && Array.isArray(json.providers) && detected && typeof detected === 'object') {
      json.providers = json.providers.map((p) => {
        const found = !!(detected[p.id] || (p.id === 'lmstudio' && detected.lmStudio));
        return { ...p, detected: p.detected || found };
      });
    }
    return json;
  }

  function seatProvider(provider) {
    const mcp = globalThis.DenizenVisitorMcpConnectUI;
    if (!mcp) {
      alert('Connect AI is still loading. Try again in a moment.');
      return;
    }
    if (provider.connect === 'team' || provider.id === 'cursor' || provider.id === 'chatgpt') {
      mcp.openTeamConnect();
      return;
    }
    if (provider.connect === 'npc') {
      mcp.openConnect(provider.id, provider.label);
      return;
    }
    if (provider.connect === 'local') {
      alert('Start LM Studio on this machine (port 1234). Named staff use it when the office can reach it — no extra subscription.');
    }
  }

  function render(status) {
    injectStyles();
    overlay?.remove();
    overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Seat an AI');
    const providers = status?.providers || [];
    overlay.innerHTML = `
      <div class="seat-card">
        <button type="button" class="seat-close" data-seat="close">Close</button>
        <h3>Seat the AIs you already pay for</h3>
        <p class="seat-lead">Nothing new to buy. Detect what is on this machine, then connect it to a desk. Abby keeps routing; spend and destructive work still wait for you.</p>
        <div class="seat-grid">
          ${providers.map((p) => {
            const seated = p.seated ? 'Seated' : (p.detected ? 'Found on this machine' : 'Not seated');
            const action = p.connect === 'later'
              ? '<button type="button" disabled>Coming</button>'
              : p.seated
                ? '<button type="button" data-seat-id="' + p.id + '">Manage</button>'
                : '<button type="button" data-seat-id="' + p.id + '">Seat</button>';
            return `<div class="seat-row${p.seated ? ' is-seated' : ''}">
              <div>
                <b>${p.label}</b>
                <small>${p.desk} · ${p.hint}</small>
                <div class="seat-state">${seated}</div>
              </div>
              ${action}
            </div>`;
          }).join('')}
        </div>
      </div>
    `;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-seat="close"]')) {
        close();
        return;
      }
      const btn = e.target.closest('[data-seat-id]');
      if (!btn) return;
      const provider = providers.find((p) => p.id === btn.dataset.seatId);
      if (provider) seatProvider(provider);
    });
    document.body.appendChild(overlay);
  }

  async function open() {
    injectStyles();
    try {
      const status = await loadStatus();
      render(status.ok ? status : { providers: [] });
    } catch (err) {
      render({
        providers: [
          { id: 'cursor', label: 'Cursor', desk: 'Cursor work queue', connect: 'team', hint: err.message || 'Could not load seats', seated: false },
          { id: 'claude', label: 'Claude', desk: 'Claude', connect: 'npc', hint: 'Connect anyway', seated: false },
          { id: 'chatgpt', label: 'ChatGPT', desk: 'Team inbox', connect: 'team', hint: 'Custom GPT', seated: false },
          { id: 'grok', label: 'Grok', desk: 'Grok', connect: 'npc', hint: 'Grok CLI', seated: false },
          { id: 'lmstudio', label: 'LM Studio', desk: 'Local models', connect: 'local', hint: 'Port 1234', seated: false },
        ],
      });
    }
  }

  function close() {
    overlay?.remove();
    overlay = null;
  }

  function boot() {
    try {
      if (new URL(window.location.href).searchParams.get('seat') === '1') {
        setTimeout(() => open(), 900);
      }
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  globalThis.DenizenSeatAI = { open, close };
})();
