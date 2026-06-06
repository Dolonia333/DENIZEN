'use strict';

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
}

function $(id) { return document.getElementById(id); }

function showToast(text, kind = 'ok') {
  const el = $('toast');
  el.textContent = text;
  el.className = `toast ${kind}`;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 2800);
}

function formatStatus(status) {
  if (!status?.ok) return JSON.stringify(status, null, 2);
  const mems = (status.recent_mcp_memories || []).slice(0, 3)
    .map((m) => `• ${m.body?.slice(0, 80) || ''}`)
    .join('\n');
  const work = (status.recent_work || []).slice(0, 3)
    .map((w) => `• ${w.note?.slice(0, 80) || ''}`)
    .join('\n');
  return [
    `NPC: ${status.npc?.display_name || status.npc?.npc_key || '?'}`,
    mems ? `\nMemories:\n${mems}` : '',
    work ? `\nWork:\n${work}` : '',
  ].filter(Boolean).join('\n');
}

async function refreshUi() {
  const res = await send('GET_CREDS');
  const creds = res?.credentials;
  const connected = !!(creds?.token && creds?.baseUrl);

  $('conn-status').textContent = connected
    ? `Connected to ${creds.baseUrl}`
    : 'Not connected';

  $('connected-panel').classList.toggle('hidden', !connected);
  $('setup-panel').classList.toggle('hidden', connected);

  if (connected) {
    $('npc-label').textContent = creds.displayName
      ? `${creds.displayName} (${creds.npcKey})`
      : creds.npcKey;
    $('base-url').value = creds.baseUrl || '';
    $('npc-key').value = creds.npcKey || '';
    $('display-name').value = creds.displayName || '';
  } else {
    $('base-url').value = $('base-url').value || 'http://localhost:8080';
  }
}

async function loadStatus() {
  const res = await send('GET_STATUS', { limit: 6 });
  if (!res?.ok) {
    showToast(res?.error || 'Status failed', 'err');
    return;
  }
  $('status-preview').textContent = formatStatus(res.status);
}

$('btn-refresh').addEventListener('click', () => loadStatus().catch((e) => showToast(e.message, 'err')));

$('btn-clipboard').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    const res = await send('PUSH_MEMORY', { text, opts: { topic: 'clipboard' } });
    if (!res?.ok) throw new Error(res?.error || 'Failed');
    showToast('Clipboard sent to NPC');
    await loadStatus();
  } catch (err) {
    showToast(err?.message || 'Clipboard failed', 'err');
  }
});

$('btn-send-memory').addEventListener('click', async () => {
  const text = $('memory-input').value.trim();
  if (!text) return showToast('Enter memory text', 'err');
  const res = await send('PUSH_MEMORY', { text });
  if (!res?.ok) return showToast(res?.error || 'Failed', 'err');
  $('memory-input').value = '';
  showToast('Memory saved');
  await loadStatus();
});

$('btn-activity').addEventListener('click', async () => {
  const note = $('memory-input').value.trim() || 'Companion activity logged';
  const res = await send('LOG_ACTIVITY', { note, opts: { phase: 'companion' } });
  if (!res?.ok) return showToast(res?.error || 'Failed', 'err');
  showToast('Activity logged');
  await loadStatus();
});

$('btn-disconnect').addEventListener('click', async () => {
  await send('CLEAR_CREDS');
  showToast('Disconnected');
  await refreshUi();
});

$('btn-save-manual').addEventListener('click', async () => {
  const creds = {
    baseUrl: $('base-url').value.trim().replace(/\/$/, ''),
    npcKey: $('npc-key').value.trim().toLowerCase(),
    displayName: $('display-name').value.trim() || $('npc-key').value.trim(),
    token: $('token').value.trim(),
    savedAt: Date.now(),
  };
  if (!creds.baseUrl || !creds.npcKey || !creds.token) {
    return showToast('URL, NPC key, and token required', 'err');
  }
  await send('SAVE_CREDS', { creds });
  showToast('Connection saved');
  await refreshUi();
  await loadStatus();
});

refreshUi().then(() => {
  if (!$('connected-panel').classList.contains('hidden')) {
    return loadStatus();
  }
  return null;
}).catch(() => {});
