(function () {
  'use strict';

  const FALLBACK = {
    windows: '/desktop/releases/Denizen-Setup.exe',
    mac: '/desktop/releases/Denizen.dmg',
    linux: '/desktop/releases/Denizen.AppImage',
  };

  let cached = null;
  let loadPromise = null;

  function detect() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows';
    if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) return 'mac';
    if (/Linux/i.test(platform) || /Linux/i.test(ua)) return 'linux';
    return 'windows';
  }

  function urls() {
    return cached || FALLBACK;
  }

  function directDownloadUrl(platform) {
    const p = platform || detect();
    const map = urls();
    return map[p] || '/desktop/download.html';
  }

  function label(platform) {
    const p = platform || detect();
    if (p === 'mac') return 'macOS';
    if (p === 'linux') return 'Linux';
    return 'Windows';
  }

  function loadDownloads() {
    if (cached) return Promise.resolve(cached);
    if (loadPromise) return loadPromise;
    loadPromise = fetch('/api/visitor/desktop-downloads', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.ok) {
          cached = {
            windows: data.windows,
            mac: data.mac || data.macos,
            linux: data.linux,
            github: data.github || null,
          };
        }
        return cached || FALLBACK;
      })
      .catch(() => FALLBACK)
      .finally(() => {
        loadPromise = null;
      });
    return loadPromise;
  }

  globalThis.DenizenClientPlatform = {
    detect,
    directDownloadUrl,
    label,
    loadDownloads,
    urls,
    FALLBACK,
  };

  loadDownloads();
})();
