(function () {
  'use strict';

  function detect() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows';
    if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) return 'mac';
    if (/Linux/i.test(platform) || /Linux/i.test(ua)) return 'linux';
    return 'windows';
  }

  const DIRECT = {
    windows: 'https://github.com/Dolonia333/DENIZEN/releases/latest/download/Denizen-Setup.exe',
    mac: 'https://github.com/Dolonia333/DENIZEN/releases/latest/download/Denizen.dmg',
    linux: 'https://github.com/Dolonia333/DENIZEN/releases/latest/download/Denizen.AppImage',
  };

  function directDownloadUrl(platform) {
    const p = platform || detect();
    return DIRECT[p] || '/desktop/download.html';
  }

  function label(platform) {
    const p = platform || detect();
    if (p === 'mac') return 'macOS';
    if (p === 'linux') return 'Linux';
    return 'Windows';
  }

  globalThis.DenizenClientPlatform = { detect, directDownloadUrl, label, DIRECT };
})();
