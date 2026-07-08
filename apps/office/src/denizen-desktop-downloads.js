'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Public download URLs for Denizen Desktop (mirror preferred, GitHub fallback). */
const RELEASE_BASE = String(
  process.env.DENIZEN_DESKTOP_RELEASE_BASE
  || 'https://github.com/Dolonia333/DENIZEN/releases/latest/download',
).replace(/\/+$/, '');

const ROOT = path.resolve(__dirname, '..');
const RELEASES_DIR = path.join(ROOT, 'desktop', 'releases');

function mirrorBase(env = process.env) {
  const explicit = String(env.DENIZEN_DESKTOP_MIRROR_BASE || '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const publicUrl = String(env.DENIZEN_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  return publicUrl ? `${publicUrl}/desktop/releases` : '';
}

function localReleaseFile(name) {
  try {
    const file = path.join(RELEASES_DIR, name);
    return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

function resolvePlatformUrl(filename, envUrl, env = process.env) {
  const configured = String(envUrl || '').trim();
  if (configured) return configured;

  const mirror = mirrorBase(env);
  if (mirror && localReleaseFile(filename)) {
    return `${mirror}/${filename}`;
  }
  return `${RELEASE_BASE}/${filename}`;
}

const WINDOWS_DESKTOP_URL = resolvePlatformUrl(
  'Denizen-Setup.exe',
  process.env.DENIZEN_WINDOWS_DESKTOP_URL,
);

const MACOS_DESKTOP_URL = resolvePlatformUrl(
  'Denizen.dmg',
  process.env.DENIZEN_MACOS_DESKTOP_URL,
);

const LINUX_DESKTOP_URL = resolvePlatformUrl(
  'Denizen.AppImage',
  process.env.DENIZEN_LINUX_DESKTOP_URL,
);

function desktopDownloadUrlForPlatform(platform, env = process.env) {
  const p = String(platform || '').trim().toLowerCase();
  if (p === 'mac' || p === 'macos' || p === 'darwin') {
    return resolvePlatformUrl('Denizen.dmg', env.DENIZEN_MACOS_DESKTOP_URL, env);
  }
  if (p === 'linux') {
    return resolvePlatformUrl('Denizen.AppImage', env.DENIZEN_LINUX_DESKTOP_URL, env);
  }
  return resolvePlatformUrl('Denizen-Setup.exe', env.DENIZEN_WINDOWS_DESKTOP_URL, env);
}

function getDesktopDownloadsPayload(env = process.env) {
  const mirror = mirrorBase(env);
  const hasLocalWindows = !!localReleaseFile('Denizen-Setup.exe');
  const hasLocalMac = !!localReleaseFile('Denizen.dmg');
  const hasLocalLinux = !!localReleaseFile('Denizen.AppImage');
  return {
    ok: true,
    windows: desktopDownloadUrlForPlatform('windows', env),
    mac: desktopDownloadUrlForPlatform('mac', env),
    macos: desktopDownloadUrlForPlatform('mac', env),
    linux: desktopDownloadUrlForPlatform('linux', env),
    download_page: '/desktop/download.html',
    release_base: RELEASE_BASE,
    mirror_base: mirror || null,
    local_mirror: {
      windows: hasLocalWindows,
      mac: hasLocalMac,
      linux: hasLocalLinux,
    },
    github: {
      windows: `${RELEASE_BASE}/Denizen-Setup.exe`,
      mac: `${RELEASE_BASE}/Denizen.dmg`,
      linux: `${RELEASE_BASE}/Denizen.AppImage`,
    },
  };
}

module.exports = {
  RELEASE_BASE,
  RELEASES_DIR,
  mirrorBase,
  WINDOWS_DESKTOP_URL,
  MACOS_DESKTOP_URL,
  LINUX_DESKTOP_URL,
  desktopDownloadUrlForPlatform,
  getDesktopDownloadsPayload,
};
