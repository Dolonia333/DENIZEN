'use strict';

const denizenDb = require('./denizen-db');
const { sendResendEmail } = require('./visitor-notify');

function publicBaseUrl() {
  return String(process.env.DENIZEN_PUBLIC_URL || process.env.DENIZEN_URL || 'http://localhost:8080').replace(/\/$/, '');
}

async function inviteTeamMember(orgId, orgSlug, { email, displayName }, inviterName) {
  const to = String(email || '').trim().toLowerCase();
  const name = String(displayName || '').trim() || to.split('@')[0];
  if (!to || !to.includes('@')) return { ok: false, error: 'valid_email_required' };

  const existing = await denizenDb._get(
    `denizen_team_accounts?select=id&org_id=eq.${encodeURIComponent(orgId)}&email=eq.${encodeURIComponent(to)}&limit=1`,
  ).catch(() => []);
  if (existing?.length) return { ok: false, error: 'already_member' };

  const joinUrl = `${publicBaseUrl()}/`;
  const text = [
    `Hi ${name},`,
    '',
    `${inviterName || 'A teammate'} invited you to join ${orgSlug || 'their team'} on Denizen CRM.`,
    '',
    `1. Open ${joinUrl}`,
    '2. Sign in with team access (use your org team code if prompted)',
    `3. Open CRM from the phone app or ${publicBaseUrl()}/crm/`,
    '',
    'Once you are in the same organization, shared contacts, deals, and pipeline sync automatically.',
  ].join('\n');

  const sent = await sendResendEmail({
    to,
    subject: `You're invited to ${orgSlug || 'Denizen'} CRM`,
    text,
  });

  if (sent.skipped) {
    return { ok: true, emailed: false, joinUrl, message: 'Resend not configured — share join link manually' };
  }
  if (!sent.ok) return { ok: false, error: sent.error || 'email_failed' };
  return { ok: true, emailed: true, joinUrl };
}

module.exports = { inviteTeamMember };
