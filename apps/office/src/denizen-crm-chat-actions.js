'use strict';

function publicBaseUrl() {
  return String(
    process.env.DENIZEN_PUBLIC_URL
    || process.env.DENIZEN_URL
    || 'http://localhost:8081',
  ).replace(/\/+$/, '');
}

function buildCrmUrl(tab, { subTab, prefill } = {}) {
  const base = `${publicBaseUrl()}/crm/`;
  const params = new URLSearchParams();
  if (tab) params.set('tab', tab);
  if (subTab) params.set('sub', subTab);
  if (prefill && typeof prefill === 'object') {
    for (const [k, v] of Object.entries(prefill)) {
      if (v != null && String(v).trim()) params.set(k, String(v).slice(0, 200));
    }
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function copyLinkAction(url, label = 'Copy link') {
  return {
    type: 'copy_link',
    url: String(url || ''),
    label,
  };
}

function copyTextAction(text, label = 'Copy text') {
  return {
    type: 'copy_text',
    text: String(text || ''),
    label,
  };
}

function openTabAction(tab, label, extra = {}) {
  return {
    type: 'open_tab',
    tab,
    label: label || `Open ${tab}`,
    autoOpen: false,
    url: buildCrmUrl(tab, extra),
    ...extra,
  };
}

function openUrlAction(url, label, { autoOpen = false } = {}) {
  return {
    type: 'open_url',
    url: String(url || ''),
    label: label || 'Open link',
    autoOpen,
  };
}

function mailtoAction({ to, subject, body, label = 'Email draft' }) {
  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  const qs = params.toString();
  const href = `mailto:${encodeURIComponent(to || '')}${qs ? `?${qs}` : ''}`;
  return { type: 'mailto', href, label, to, subject };
}

function askNpcAction(npc, message, label) {
  return {
    type: 'ask_npc',
    npc: String(npc || 'Lucy'),
    message: String(message || ''),
    label: label || `Ask ${npc}`,
  };
}

function normalizeCrmActions(actions, { autoOpen = false, preferCopy = true } = {}) {
  if (!Array.isArray(actions)) return [];
  return actions.map((action) => {
    if (!action || typeof action !== 'object') return action;
    const next = { ...action, autoOpen: action.autoOpen ?? autoOpen };
    if (preferCopy && next.type === 'open_url' && next.url && !next.label?.includes('Open')) {
      return copyLinkAction(next.url, next.label || 'Copy link');
    }
    if (next.type === 'open_tab' || next.tab) {
      next.autoOpen = next.autoOpen ?? false;
      if (!next.url && next.tab) {
        next.url = buildCrmUrl(next.tab, { subTab: next.subTab || next.sub, prefill: next.prefill });
      }
    }
    return next;
  }).slice(0, 8);
}

function shouldAutoOpenCrm(message) {
  return /\b(open|show me|take me to|launch|go to)\b/i.test(String(message || ''));
}

module.exports = {
  publicBaseUrl,
  buildCrmUrl,
  copyLinkAction,
  copyTextAction,
  openTabAction,
  openUrlAction,
  mailtoAction,
  askNpcAction,
  normalizeCrmActions,
  shouldAutoOpenCrm,
};
