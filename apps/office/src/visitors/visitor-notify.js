'use strict';

/**
 * Visitor notifications — email + Discord foundation for platform outreach.
 * Logs every attempt to denizen_notification_log; sends when API keys are configured.
 */

const denizenDb = require('../intelligence/denizen-db');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.DENIZEN_EMAIL_FROM || 'Denizen <onboarding@resend.dev>';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_VISITOR_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL || '';

async function logNotification({
  identityId,
  channel,
  template,
  recipient,
  subject,
  bodyPreview,
  status,
  error,
  metadata,
}) {
  if (!denizenDb.enabled) return null;
  try {
    const rows = await denizenDb._post(
      'denizen_notification_log',
      {
        identity_id: identityId || null,
        channel,
        template,
        recipient: recipient || null,
        subject: subject || null,
        body_preview: bodyPreview ? String(bodyPreview).slice(0, 500) : null,
        status,
        error: error || null,
        metadata: metadata || {},
        sent_at: status === 'sent' ? new Date().toISOString() : null,
      },
      { prefer: 'return=representation' },
    );
    return rows?.[0] || null;
  } catch (err) {
    console.warn('[VisitorNotify] log failed:', err?.message || err);
    return null;
  }
}

async function sendResendEmail({ to, subject, text, html, attachments }) {
  if (!RESEND_API_KEY || !to) return { ok: false, skipped: true, reason: 'no_api_key' };
  const att = Array.isArray(attachments)
    ? attachments
      .map((a) => ({
        filename: String(a?.filename || 'attachment').trim() || 'attachment',
        content: String(a?.content || '').trim(),
      }))
      .filter((a) => a.content)
    : [];
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject,
      text,
      html: html || undefined,
      attachments: att.length ? att : undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Resend ${res.status}`);
  }
  return { ok: true, id: data?.id };
}

async function sendDiscordWebhook(text) {
  if (!DISCORD_WEBHOOK_URL) return { ok: false, skipped: true, reason: 'no_webhook' };
  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: String(text).slice(0, 1900) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord webhook ${res.status}: ${body.slice(0, 200)}`);
  }
  return { ok: true };
}

async function notifyWelcomeLogin(identity, { tier, returning } = {}) {
  if (!identity?.email_normalized && !identity?.email) return null;
  const email = identity.email_normalized || identity.email;
  const name = identity.display_name || 'there';
  const subject = returning
    ? `Welcome back to Denizen, ${name}`
    : `Welcome to Denizen, ${name}`;
  const text = returning
    ? `Hi ${name},\n\nGood to see you again. Your office and assistants remember you.\n\n— Denizen`
    : `Hi ${name},\n\nThanks for trying Denizen. Your personal office and AI team are ready.\n\n— Denizen`;

  if (!identity.notify_email) {
    return logNotification({
      identityId: identity.id,
      channel: 'email',
      template: 'welcome_login',
      recipient: email,
      subject,
      bodyPreview: text,
      status: 'skipped',
      metadata: { tier, returning, reason: 'opt_out' },
    });
  }

  let status = 'queued';
  let error = null;
  try {
    const result = await sendResendEmail({ to: email, subject, text });
    status = result.skipped ? 'skipped' : 'sent';
  } catch (err) {
    status = 'failed';
    error = err?.message || String(err);
    console.warn('[VisitorNotify] welcome email failed:', error);
  }

  return logNotification({
    identityId: identity.id,
    channel: 'email',
    template: 'welcome_login',
    recipient: email,
    subject,
    bodyPreview: text,
    status,
    error,
    metadata: { tier, returning, resend: Boolean(RESEND_API_KEY) },
  });
}

async function notifyDiscordNewUser(identity, { tier } = {}) {
  if (!DISCORD_WEBHOOK_URL || !identity) return null;
  const text = `🆕 **Denizen ${tier || identity.tier} user** — ${identity.display_name} (\`${identity.email_normalized || identity.email}\`) login #${identity.login_count || 1}`;
  let status = 'queued';
  let error = null;
  try {
    await sendDiscordWebhook(text);
    status = 'sent';
  } catch (err) {
    status = 'failed';
    error = err?.message || String(err);
  }
  return logNotification({
    identityId: identity.id,
    channel: 'discord',
    template: 'new_user_alert',
    recipient: 'discord_webhook',
    bodyPreview: text,
    status,
    error,
    metadata: { tier: tier || identity.tier },
  });
}

module.exports = {
  logNotification,
  notifyWelcomeLogin,
  notifyDiscordNewUser,
  sendResendEmail,
};
