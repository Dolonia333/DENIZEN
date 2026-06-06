/**
 * Visitor briefing + commitments panel — morning digest and open promises.
 * Attaches to globalThis.DenizenVisitorBriefingUI (no imports).
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-visitor-briefing-style';
  const BTN_ID = 'denizen-visitor-briefing-btn';
  const PANEL_ID = 'denizen-visitor-briefing-panel';

  let panelEl = null;
  let wsBound = false;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${BTN_ID} {
        margin-left: 6px;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(251, 191, 36, 0.12);
        border: 1px solid rgba(251, 191, 36, 0.35);
        color: #fcd34d;
        font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        font-weight: bold;
        cursor: pointer;
      }
      #${BTN_ID}:hover { background: rgba(251, 191, 36, 0.22); }
      #${PANEL_ID} {
        position: fixed;
        top: 48px;
        right: 12px;
        z-index: 100540;
        width: min(360px, 92vw);
        max-height: 50vh;
        overflow: auto;
        background: rgba(2, 6, 23, 0.95);
        border: 1px solid #334155;
        border-radius: 10px;
        padding: 12px 14px;
        font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
        color: #e2e8f0;
        display: none;
        box-shadow: 0 12px 28px rgba(0,0,0,0.45);
      }
      #${PANEL_ID}.open { display: block; }
      #${PANEL_ID} h3 { margin: 0 0 8px; font-size: 12px; color: #fcd34d; }
      #${PANEL_ID} .brief-text { white-space: pre-wrap; color: #cbd5e1; margin-bottom: 10px; }
      #${PANEL_ID} .commit-item {
        padding: 6px 8px;
        margin: 4px 0;
        border-radius: 6px;
        background: rgba(30, 41, 59, 0.6);
        border: 1px solid #475569;
      }
      #${PANEL_ID} .commit-item button {
        margin-top: 4px;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid #64748b;
        background: #1e293b;
        color: #94a3b8;
        cursor: pointer;
      }
    `;
    document.head.appendChild(s);
  }

  function sessionId() {
    return globalThis.DenizenVisitorSession?.getSessionId?.() || null;
  }

  function isCeo() {
    return globalThis.__DenizenCeoMode === true;
  }

  function authHeaders(extra = {}) {
    const sess = globalThis.DenizenVisitorSession;
    if (sess?.authHeaders) return sess.authHeaders(extra);
    return { 'Content-Type': 'application/json', ...extra };
  }

  async function fetchBriefing() {
    const sid = sessionId();
    if (!sid) return null;
    const res = await fetch(`/api/visitor/briefing?session_id=${encodeURIComponent(sid)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.briefing || null;
  }

  async function fetchCommitments() {
    const sid = sessionId();
    if (!sid) return [];
    const res = await fetch(`/api/visitor/commitments?session_id=${encodeURIComponent(sid)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return [];
    const j = await res.json();
    return j.commitments || [];
  }

  function renderPanel(briefing, commitments) {
    if (!panelEl) {
      panelEl = document.createElement('div');
      panelEl.id = PANEL_ID;
      document.body.appendChild(panelEl);
    }
    const text = briefing?.content?.text || 'No briefing yet — check back after 8am.';
    const commitHtml = (commitments || []).slice(0, 8).map((c) => `
      <div class="commit-item" data-id="${c.id}">
        ${c.text}${c.npc_key ? ` <span style="color:#64748b">(${c.npc_key})</span>` : ''}
        <button type="button" data-done="${c.id}">Done</button>
      </div>
    `).join('') || '<div style="color:#64748b">No open commitments.</div>';

    panelEl.innerHTML = `
      <h3>Morning briefing</h3>
      <div class="brief-text">${text.replace(/</g, '&lt;')}</div>
      <h3>Open commitments</h3>
      ${commitHtml}
    `;

    panelEl.querySelectorAll('[data-done]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-done');
        const sid = sessionId();
        if (!id || !sid) return;
        await fetch(`/api/visitor/commitments/${id}/resolve`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ session_id: sid }),
        });
        refresh();
      });
    });
  }

  async function refresh() {
    if (isCeo()) return;
    const [briefing, commitments] = await Promise.all([fetchBriefing(), fetchCommitments()]);
    renderPanel(briefing, commitments);
  }

  function togglePanel() {
    if (!panelEl) refresh();
    panelEl?.classList.toggle('open');
  }

  function showToast(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:72px;left:50%;transform:translateX(-50%);z-index:100600;padding:8px 14px;border-radius:8px;background:#1e293b;border:1px solid #475569;color:#e2e8f0;font:11px ui-monospace,monospace;';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  function handleWsMessage(msg) {
    if (!msg) return;
    if (msg.type === 'visitor_briefing') {
      renderPanel(msg.briefing, null);
      panelEl?.classList.add('open');
      showToast('Morning briefing ready');
    } else if (msg.type === 'visitor_commitment_nudge') {
      showToast(`${(msg.commitments || []).length} commitment(s) need follow-up`);
      refresh();
    } else if (msg.type === 'visitor_proactive') {
      showToast(msg.event?.title || 'Proactive alert');
    }
  }

  function bindWs() {
    if (wsBound) return;
    const attach = (ws) => {
      if (!ws || ws._denizenBriefingListener) return;
      ws._denizenBriefingListener = true;
      ws.addEventListener('message', (evt) => {
        try {
          handleWsMessage(JSON.parse(evt.data));
        } catch (_) {}
      });
    };
    attach(window.__DenizenAgentWs);
    wsBound = true;
    const origConnect = window.AgentOfficeManager?.prototype?.connect;
    if (typeof origConnect === 'function' && !origConnect._briefingPatched) {
      window.AgentOfficeManager.prototype.connect = function patchedConnect(...args) {
        origConnect.apply(this, args);
        if (this.ws) attach(this.ws);
      };
      window.AgentOfficeManager.prototype.connect._briefingPatched = true;
    }
  }

  function mountBtn() {
    if (isCeo()) return;
    const chatHeader = document.querySelector('#player-chat-header, .player-chat-header');
    if (!chatHeader || document.getElementById(BTN_ID)) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = 'Briefing';
    btn.title = 'Morning briefing & commitments';
    btn.addEventListener('click', togglePanel);
    chatHeader.appendChild(btn);
  }

  function canUseBriefing() {
    if (isCeo()) return false;
    const caps = globalThis.DenizenVisitorCapabilities;
    if (caps?.canUseBriefingPanel) return caps.canUseBriefingPanel();
    const sess = globalThis.DenizenVisitorSession;
    return !sess?.isDemo?.();
  }

  function init() {
    if (!canUseBriefing()) return;
    injectStyles();
    bindWs();
    const tryMount = () => {
      mountBtn();
      if (!document.getElementById(BTN_ID)) setTimeout(tryMount, 1200);
    };
    tryMount();
    setTimeout(refresh, 2000);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  globalThis.DenizenVisitorBriefingUI = { refresh, togglePanel };
})();
