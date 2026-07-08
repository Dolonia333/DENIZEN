'use strict';

const denizenDb = require('../intelligence/denizen-db');
const { sendResendEmail } = require('../visitors/visitor-notify');
const teamInviteLinks = require('../auth/denizen-team-invite-links');
const invitePlatform = require('../integrations/denizen-invite-platform');

async function inviteTeamMember(orgId, orgSlug, { email, displayName, platform = 'windows' }, inviterName) {
  const to = String(email || '').trim().toLowerCase();
  const name = String(displayName || '').trim() || to.split('@')[0];
  if (!to || !to.includes('@')) return { ok: false, error: 'valid_email_required' };

  const normalizedPlatform = invitePlatform.normalizeInvitePlatform(platform);

  const existing = await denizenDb._get(
    `denizen_team_accounts?select=id&org_id=eq.${encodeURIComponent(orgId)}&email=eq.${encodeURIComponent(to)}&limit=1`,
  ).catch(() => []);
  if (existing?.length) return { ok: false, error: 'already_member' };

  const orgRows = orgId
    ? await denizenDb._get(
      `denizen_organizations?select=id,slug,display_name,settings&id=eq.${encodeURIComponent(orgId)}&limit=1`,
    ).catch(() => [])
    : [];
  const org = orgRows?.[0] || { slug: orgSlug, display_name: orgSlug };
  const teamCode = await teamInviteLinks.resolveTeamCodeForOrg(org);
  const joinUrl = teamInviteLinks.buildShortJoinUrl(teamCode);
  const teamLabel = org.display_name || orgSlug || 'Denizen';
  const text = teamInviteLinks.buildInviteEmailText({
    name,
    inviterName,
    orgSlug: org.slug || orgSlug,
    orgDisplayName: teamLabel,
    teamCode,
    platform: normalizedPlatform,
  });

  const sent = await sendResendEmail({
    to,
    subject: invitePlatform.inviteEmailSubject({ orgDisplayName: teamLabel, platform: normalizedPlatform }),
    text,
  });

  const downloadPayload = {
    joinUrl,
    team_code: teamCode,
    platform: normalizedPlatform,
    windows_desktop_url: teamInviteLinks.WINDOWS_DESKTOP_EXE_URL,
    macos_desktop_url: teamInviteLinks.MACOS_DESKTOP_DMG_URL,
    linux_desktop_url: teamInviteLinks.LINUX_DESKTOP_APPIMAGE_URL,
    desktop_download_url: teamInviteLinks.desktopDownloadUrl(),
    installer_url: invitePlatform.desktopInstallerUrl(normalizedPlatform),
  };

  if (sent.skipped) {
    return {
      ok: true,
      emailed: false,
      ...downloadPayload,
      email_draft: text,
      message: 'Resend not configured — use mailto or copy the draft below',
    };
  }
  if (!sent.ok) return { ok: false, error: sent.error || 'email_failed' };
  return { ok: true, emailed: true, ...downloadPayload };
}

module.exports = { inviteTeamMember };
