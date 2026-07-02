'use strict';

/** Public download URLs for Denizen Desktop (GitHub Releases). */
const RELEASE_BASE = String(
  process.env.DENIZEN_DESKTOP_RELEASE_BASE
  || 'https://github.com/Dolonia333/DENIZEN/releases/latest/download',
).replace(/\/+$/, '');

const WINDOWS_DESKTOP_URL = String(
  process.env.DENIZEN_WINDOWS_DESKTOP_URL
  || `${RELEASE_BASE}/Denizen-Setup.exe`,
).trim();

const MACOS_DESKTOP_URL = String(
  process.env.DENIZEN_MACOS_DESKTOP_URL
  || `${RELEASE_BASE}/Denizen.dmg`,
).trim();

const LINUX_DESKTOP_URL = String(
  process.env.DENIZEN_LINUX_DESKTOP_URL
  || `${RELEASE_BASE}/Denizen.AppImage`,
).trim();

function desktopDownloadUrlForPlatform(platform) {
  const p = String(platform || '').trim().toLowerCase();
  if (p === 'mac' || p === 'macos' || p === 'darwin') return MACOS_DESKTOP_URL;
  if (p === 'linux') return LINUX_DESKTOP_URL;
  return WINDOWS_DESKTOP_URL;
}

module.exports = {
  RELEASE_BASE,
  WINDOWS_DESKTOP_URL,
  MACOS_DESKTOP_URL,
  LINUX_DESKTOP_URL,
  desktopDownloadUrlForPlatform,
};
