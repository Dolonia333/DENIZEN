'use strict';

const desktopDownloads = require('./denizen-desktop-downloads.js');

function normalizeInvitePlatform(raw) {
  const p = String(raw || '').trim().toLowerCase();
  if (p === 'mac' || p === 'macos' || p === 'darwin') return 'mac';
  if (p === 'linux') return 'linux';
  if (p === 'win' || p === 'windows' || p === 'win32') return 'windows';
  return 'windows';
}

function inviteEmailSubject({ orgDisplayName, platform = 'windows' } = {}) {
  const teamLabel = orgDisplayName || 'Denizen';
  const p = normalizeInvitePlatform(platform);
  if (p === 'mac') return `Join ${teamLabel} on Denizen — Mac setup`;
  if (p === 'linux') return `Join ${teamLabel} on Denizen — Linux setup`;
  return `Join ${teamLabel} on Denizen — Windows setup`;
}

function desktopInstallerUrl(platform) {
  return desktopDownloads.desktopDownloadUrlForPlatform(normalizeInvitePlatform(platform));
}

module.exports = {
  normalizeInvitePlatform,
  inviteEmailSubject,
  desktopInstallerUrl,
};
