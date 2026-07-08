'use strict';

(function initVisitorCrmBridge(global) {
  function buildCrmOpenUrl(action) {
    if (action?.url) return action.url;
    const base = '/crm/';
    const params = new URLSearchParams();
    if (action?.tab) params.set('tab', action.tab);
    const sub = action?.subTab || action?.sub;
    if (sub) params.set('sub', sub);
    if (action?.prefill && typeof action.prefill === 'object') {
      for (const [k, v] of Object.entries(action.prefill)) {
        if (v != null && String(v).trim()) params.set(k, String(v).slice(0, 200));
      }
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  async function copyText(text) {
    const value = String(text || '');
    if (!value) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

  function flashCopied(label) {
    const playerChat = global.__DenizenPlayerChat
      || global.__DenizenAgentManager?.scene?._playerChat;
    playerChat?._addToLog?.('System', `${label || 'Link'} copied to clipboard.`);
  }

  async function executeCrmAction(action) {
    if (!action || typeof action !== 'object') return;
    if (action.type === 'copy_link' || action.type === 'copy_text') {
      const ok = await copyText(action.url || action.text || '');
      if (ok) flashCopied(action.label);
      else {
        const playerChat = global.__DenizenPlayerChat
          || global.__DenizenAgentManager?.scene?._playerChat;
        playerChat?._addToLog?.('System', `Copy failed — select manually: ${action.url || action.text || ''}`);
      }
      return;
    }
    if (action.type === 'mailto' && action.href) {
      window.location.href = action.href;
      return;
    }
    if (action.type === 'ask_npc') {
      const playerChat = global.__DenizenPlayerChat
        || global.__DenizenAgentManager?.scene?._playerChat;
      if (playerChat && action.message) {
        playerChat.sendMessage?.(action.message, action.npc || null);
      }
      return;
    }
    if (action.type === 'open_url' && action.url) {
      window.open(action.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action.type === 'open_tab' || action.tab || action.action === 'open_crm') {
      const url = buildCrmOpenUrl(action);
      if (action.prefill) {
        try {
          sessionStorage.setItem('denizen-crm-prefill', JSON.stringify(action.prefill));
        } catch (_) {}
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  function handleCrmActions(actions, { autoOnly = false } = {}) {
    if (!Array.isArray(actions) || !actions.length) return;
    for (const action of actions) {
      if (!action || typeof action !== 'object') continue;
      if (autoOnly && !action.autoOpen) continue;
      void executeCrmAction(action);
    }
  }

  function handlePlayerChatResponse(msg) {
    const crmActions = msg?.crm_actions
      || (Array.isArray(msg?.actions)
        ? msg.actions.filter((a) => a && (a.action === 'open_crm' || a.type === 'open_tab' || a.type === 'open_url' || a.type === 'copy_link'))
        : null);
    if (!crmActions?.length) return;
    if (msg?.crm_auto_open) {
      handleCrmActions(crmActions, { autoOnly: true });
    }
  }

  global.DenizenCrmBridge = {
    buildCrmOpenUrl,
    executeCrmAction,
    handleCrmActions,
    handlePlayerChatResponse,
    copyText,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
