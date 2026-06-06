'use strict';

/**
 * Runs on Denizen office pages — picks up companion credentials from sessionStorage.
 */
const STORAGE_KEY = 'denizen.companion.v1';

function pushCreds(creds) {
  if (!creds?.token) return;
  chrome.runtime.sendMessage({ type: 'SAVE_CREDS', creds }).catch(() => {});
}

function syncFromStorage() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) pushCreds(JSON.parse(raw));
  } catch (_) { /* ignore */ }
}

window.addEventListener('denizen:companion-credentials', (event) => {
  if (event?.detail) pushCreds(event.detail);
});

syncFromStorage();
setInterval(syncFromStorage, 4000);
