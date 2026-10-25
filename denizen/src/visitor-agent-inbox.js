/**
 * Visitor agent inbox — team users see NPC-to-NPC DMs addressed to their claimed assistant.
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-agent-inbox-style';
  const TOAST_ID = 'denizen-agent-inbox-toast';
  const MAX_SEEN = 200;

  let hideTimer = null;
  const seenIds = new Set();
  const inbox = [];

  function caps() {
    return globalThis.DenizenVisitorCapabilities || {};
  }

  function isTeam() {
    return !!caps().isTeam?.() || !!caps().isCeo?.();
  }

  function assistantName() {
    const profile = globalThis.DenizenVisitorSession?.getProfile?.() || {};
    const assistant = profile.assistant || profile.claimedAssistant || {};
    return assistant.display_name || assistant.assistant_name || assistant.npcName || assistant.npc_key || null;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${TOAST_ID} {
        position: fixed;
        left: max(12px, env(safe-area-inset-left));
        right: max(12px, env(safe-area-inset-right));
        bottom: calc(var(--denizen-dock-height, 56px) + 128px + env(safe-area-inset-bottom));
        z-index: 100130;
        display: none;
        max-width: min(420px, calc(100vw - 24px));
        margin: 0 auto;
        background: rgba(15, 23, 42, 0.97);
        border: 1px solid rgba(96, 165, 250, 0.45);
        border-radius: 10px;
        padding: 10px 12px;
        font: 11px/1.45 ui-monospace, Menlo, monospace;
        color: #e2e8f0;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
        pointer-events: auto;
      }
    `;
    document.head.appendChild(s);
  }

  function ensureToast() {
    injectStyles();
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    return el;
  }

  function showMessage(msg) {
    if (!isTeam()) return;
    const mine = assistantName();
    if (!mine || !msg?.to) return;
    if (String(msg.to).toLowerCase() !== String(mine).toLowerCase()) return;
    if (msg.id && seenIds.has(msg.id)) return;
    if (msg.id) {
      seenIds.add(msg.id);
      if (seenIds.size > MAX_SEEN) {
        const drop = [...seenIds].slice(0, seenIds.size - MAX_SEEN);
        drop.forEach((id) => seenIds.delete(id));
      }
    }

    inbox.unshift(msg);
    if (inbox.length > 20) inbox.length = 20;

    const from = msg.from || 'peer';
    const text = String(msg.text || '').slice(0, 140);
    const el = ensureToast();
    globalThis.DenizenSafeDom.setSafeHtml(el, `<b>Agent message for ${mine}</b><br><span style="color:#93c5fd">${from}</span>: ${text}`);
    el.style.display = 'block';
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { el.style.display = 'none'; }, 14000);

    try {
      document.dispatchEvent(new CustomEvent('denizen-agent-inbox', { detail: { message: msg, inbox } }));
    } catch (_) {}
  }

  function onAgentBus(ev) {
    const messages = ev.detail?.messages;
    if (!Array.isArray(messages)) return;
    for (const msg of messages) showMessage(msg);
  }

  function init() {
    document.addEventListener('denizen-agent-bus', onAgentBus);
    document.addEventListener('denizen-visitor-session-ready', () => {
      if (inbox.length && isTeam()) {
        const last = inbox[0];
        if (last) showMessage({ ...last, id: null });
      }
    });
  }

  globalThis.DenizenVisitorAgentInbox = {
    getInbox: () => [...inbox],
    getAssistantName: assistantName,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
