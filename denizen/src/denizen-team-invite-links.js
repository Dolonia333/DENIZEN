'use strict';

const denizenDb = require('./denizen-db.js');
const promptTuning = require('./prompt-tuning.js');
const desktopDownloads = require('./denizen-desktop-downloads.js');

function publicBaseUrl() {
  return String(
    process.env.DENIZEN_PUBLIC_URL
    || process.env.DENIZEN_URL
    || 'http://localhost:8081',
  ).replace(/\/+$/, '');
}

function normalizeTeamCode(code) {
  return String(code || '').trim();
}

function buildJoinUrl(teamCode, baseUrl = publicBaseUrl()) {
  const code = normalizeTeamCode(teamCode);
  const base = String(baseUrl || publicBaseUrl()).replace(/\/+$/, '');
  if (!code) return `${base}/`;
  return `${base}/?join=${encodeURIComponent(code)}`;
}

function buildShortJoinUrl(teamCode, baseUrl = publicBaseUrl()) {
  const code = normalizeTeamCode(teamCode);
  const base = String(baseUrl || publicBaseUrl()).replace(/\/+$/, '');
  if (!code) return `${base}/`;
  return `${base}/invite/${encodeURIComponent(code)}`;
}

function buildPairDesktopUrl(baseUrl = publicBaseUrl()) {
  const base = String(baseUrl || publicBaseUrl()).replace(/\/+$/, '');
  return `${base}/?pair_desktop=1`;
}

function desktopDownloadUrl(baseUrl = publicBaseUrl()) {
  const base = String(baseUrl || publicBaseUrl()).replace(/\/+$/, '');
  return `${base}/desktop/download.html`;
}

const WINDOWS_DESKTOP_EXE_URL = desktopDownloads.WINDOWS_DESKTOP_URL;
const MACOS_DESKTOP_DMG_URL = desktopDownloads.MACOS_DESKTOP_URL;
const LINUX_DESKTOP_APPIMAGE_URL = desktopDownloads.LINUX_DESKTOP_URL;

function buildInviteEmailText({
  name,
  inviterName,
  orgSlug,
  orgDisplayName,
  teamCode,
  baseUrl = publicBaseUrl(),
  platform = 'windows',
} = {}) {
  const who = String(name || 'there').trim();
  const teamLabel = orgDisplayName || orgSlug || 'Denizen';
  const joinUrl = buildShortJoinUrl(teamCode, baseUrl);
  const downloadPage = desktopDownloadUrl(baseUrl);
  const code = normalizeTeamCode(teamCode);
  const inviter = inviterName || 'Your teammate';

  if (platform === 'windows') {
    return [
      `Hi ${who},`,
      '',
      `${inviter} invited you to join ${teamLabel} on Denizen.`,
      '',
      'STEP 1 — Create your account (in your web browser)',
      `Open this link on your Windows PC: ${joinUrl}`,
      'Choose a username, your email, and a password.',
      code ? `(Team code ${code} is already filled in.)` : '',
      '',
      'STEP 2 — Install Denizen Desktop for Windows',
      `Download and run: ${WINDOWS_DESKTOP_EXE_URL}`,
      `More help: ${downloadPage}`,
      '',
      'STEP 3 — Connect your computer',
      'Launch Denizen from the Start menu. It opens your browser — log in with the same account you just created.',
      'Your PC is now your Denizen station.',
      '',
      'Optional: open City Power in Denizen and turn on "Power the city" when you want to contribute.',
      '',
      `Questions? Reply to ${inviter}.`,
    ].filter(Boolean).join('\n');
  }

  if (platform === 'mac' || platform === 'macos') {
    return [
      `Hi ${who},`,
      '',
      `${inviter} invited you to join ${teamLabel} on Denizen.`,
      '',
      'STEP 1 — Create your account (in your web browser)',
      `Open this link on your Mac: ${joinUrl}`,
      'Choose a username, your email, and a password.',
      code ? `(Team code ${code} is already filled in.)` : '',
      '',
      'STEP 2 — Install Denizen Desktop for macOS',
      `Download: ${MACOS_DESKTOP_DMG_URL}`,
      'Open the .dmg file, drag Denizen into Applications, then open Denizen from Applications.',
      `More help: ${downloadPage}`,
      '',
      'STEP 3 — Connect your Mac',
      'Denizen opens your browser — log in with the same account you just created.',
      'Your Mac is now your Denizen station.',
      '',
      'macOS may ask for Accessibility or Screen Recording the first time Denizen needs them — allow when prompted.',
      '',
      `Questions? Reply to ${inviter}.`,
    ].filter(Boolean).join('\n');
  }

  if (platform === 'linux') {
    return [
      `Hi ${who},`,
      '',
      `${inviter} invited you to join ${teamLabel} on Denizen.`,
      '',
      'STEP 1 — Create your account',
      `Open: ${joinUrl}`,
      code ? `(Team code ${code} is already filled in.)` : '',
      '',
      'STEP 2 — Install Denizen Desktop for Linux',
      `Download: ${LINUX_DESKTOP_APPIMAGE_URL}`,
      'Make it executable (chmod +x Denizen.AppImage) and run it.',
      `More help: ${downloadPage}`,
      '',
      'STEP 3 — Log in when the browser opens to pair this computer.',
      '',
      `Questions? Reply to ${inviter}.`,
    ].filter(Boolean).join('\n');
  }

  const pairUrl = buildPairDesktopUrl(baseUrl);
  return [
    `Hi ${who},`,
    '',
    `${inviter} invited you to join ${teamLabel} on Denizen.`,
    '',
    '--- Create your account (2 minutes) ---',
    `1. Open this link on your computer: ${joinUrl}`,
    '2. Pick a username, your email, and a password.',
    code ? `   (Team code ${code} is already filled in from the link.)` : '',
    '3. Enter the city and claim your Citizen ID.',
    '',
    '--- Add your computer as a station ---',
    `4. Download Denizen Desktop: ${downloadPage}`,
    '5. Install and run it — log in with the same account when the browser opens.',
    `   Or open: ${pairUrl}`,
    '6. In City Power, turn on "Power the city" if you want to contribute compute.',
    '',
    'You stay on your own account with your own station. Shared team tools sync automatically.',
    '',
    `Questions? Reply to ${inviter} — they can help from the city.`,
  ].filter(Boolean).join('\n');
}

async function resolveTeamCodeForOrg(org) {
  if (!org) return null;
  const settings = org.settings && typeof org.settings === 'object' ? org.settings : {};
  if (settings.team_code) return String(settings.team_code).trim();
  if (org.slug === promptTuning.teamOrgSlug) return promptTuning.teamCode;
  return null;
}

async function getTeamCodeByOrgId(orgId) {
  if (!orgId || !denizenDb.enabled) {
    return orgId ? null : promptTuning.teamCode;
  }
  const rows = await denizenDb._get(
    `denizen_organizations?select=id,slug,display_name,settings&id=eq.${encodeURIComponent(orgId)}&limit=1`,
  ).catch(() => []);
  return resolveTeamCodeForOrg(rows?.[0] || null);
}

async function buildInvitePayloadForOrg(org, { inviterName = null } = {}) {
  const teamCode = await resolveTeamCodeForOrg(org);
  const base = publicBaseUrl();
  return {
    ok: true,
    team_code: teamCode,
    org_slug: org?.slug || null,
    org_display_name: org?.display_name || org?.slug || null,
    join_url: buildJoinUrl(teamCode, base),
    short_join_url: buildShortJoinUrl(teamCode, base),
    pair_desktop_url: buildPairDesktopUrl(base),
    desktop_download_url: desktopDownloadUrl(base),
    windows_desktop_url: WINDOWS_DESKTOP_EXE_URL,
    macos_desktop_url: MACOS_DESKTOP_DMG_URL,
    linux_desktop_url: LINUX_DESKTOP_APPIMAGE_URL,
    public_url: base,
    invite_steps: [
      'Open the invite link and create an account',
      'Download Denizen Desktop for your computer (Windows, Mac, or Linux)',
      'Log in when the desktop app opens your browser — pairing is automatic',
      'Turn on City Power when ready (optional)',
    ],
    inviter_name: inviterName || null,
  };
}

module.exports = {
  publicBaseUrl,
  buildJoinUrl,
  buildShortJoinUrl,
  buildPairDesktopUrl,
  desktopDownloadUrl,
  WINDOWS_DESKTOP_EXE_URL,
  MACOS_DESKTOP_DMG_URL,
  LINUX_DESKTOP_APPIMAGE_URL,
  resolveTeamCodeForOrg,
  getTeamCodeByOrgId,
  buildInviteEmailText,
  buildInvitePayloadForOrg,
};
