'use strict';

importScripts('lib/sync-client.js');

const MENU_ID = 'denizen-send-selection';
const STORAGE_KEY = 'credentials';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Send selection to Denizen NPC',
    contexts: ['selection'],
  });
});

async function getCredentials() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || null;
}

async function requireCredentials() {
  const creds = await getCredentials();
  if (!creds?.token || !creds?.baseUrl) {
    throw new Error('Not connected — open Denizen, claim an NPC, and use Connect AI');
  }
  return creds;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'SAVE_CREDS' && msg.creds) {
      await chrome.storage.local.set({ [STORAGE_KEY]: msg.creds });
      return { ok: true };
    }
    if (msg.type === 'GET_CREDS') {
      return { ok: true, credentials: await getCredentials() };
    }
    if (msg.type === 'CLEAR_CREDS') {
      await chrome.storage.local.remove(STORAGE_KEY);
      return { ok: true };
    }
    if (msg.type === 'GET_STATUS') {
      const creds = await requireCredentials();
      const status = await DenizenSyncClient.getNpcStatus(creds, msg.limit || 8);
      return { ok: true, status };
    }
    if (msg.type === 'PUSH_MEMORY') {
      const creds = await requireCredentials();
      const result = await DenizenSyncClient.pushMemory(creds, msg.text, msg.opts || {});
      return { ok: true, result };
    }
    if (msg.type === 'LOG_ACTIVITY') {
      const creds = await requireCredentials();
      const result = await DenizenSyncClient.logActivity(creds, msg.note, msg.opts || {});
      return { ok: true, result };
    }
    return { ok: false, error: 'unknown message' };
  })()
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true;
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText?.trim()) return;
  try {
    const creds = await requireCredentials();
    await DenizenSyncClient.pushMemory(creds, info.selectionText.trim(), { topic: 'selection' });
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#4ade80' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
  } catch (err) {
    console.warn('[DenizenCompanion]', err);
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#f87171' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'push-clipboard') return;
  try {
    const creds = await requireCredentials();
    const text = await navigator.clipboard.readText();
    if (!text?.trim()) throw new Error('Clipboard empty');
    await DenizenSyncClient.pushMemory(creds, text.trim(), { topic: 'clipboard' });
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#4ade80' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
  } catch (err) {
    console.warn('[DenizenCompanion] clipboard push failed:', err);
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#f87171' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
  }
});
