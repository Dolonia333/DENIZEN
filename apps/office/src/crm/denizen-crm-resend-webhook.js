'use strict';

const crypto = require('node:crypto');
const crmStore = require('./denizen-crm-store');
const denizenDb = require('../intelligence/denizen-db');

const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || '';

function verifyResendSignature(rawBody, headers) {
  // No secret configured = signature verification is opt-in (Resend events only
  // carry open/click tracking, never money or access). Once a secret IS set we
  // always require a valid signature — see handleResendWebhook for the gate.
  if (!RESEND_WEBHOOK_SECRET) return true;
  const svixId = headers['svix-id'] || headers['Svix-Id'];
  const svixTs = headers['svix-timestamp'] || headers['Svix-Timestamp'];
  const svixSig = headers['svix-signature'] || headers['Svix-Signature'];
  if (!svixId || !svixTs || !svixSig) return false;
  const payload = `${svixId}.${svixTs}.${rawBody}`;
  const secret = RESEND_WEBHOOK_SECRET.startsWith('whsec_')
    ? Buffer.from(RESEND_WEBHOOK_SECRET.slice(6), 'base64')
    : Buffer.from(RESEND_WEBHOOK_SECRET, 'utf8');
  const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('base64');
  const candidates = String(svixSig).split(' ').map((p) => p.split(',')[1]).filter(Boolean);
  return candidates.some((sig) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

/**
 * Handle Resend email event webhooks (opened, clicked, delivered).
 * Configure Resend dashboard → Webhooks → POST /api/crm/resend-webhook
 */
async function handleResendWebhook(payload, options = {}) {
  // When a secret is configured we require the raw body AND a valid signature —
  // a missing rawBody can no longer slip past verification.
  if (RESEND_WEBHOOK_SECRET) {
    if (!options.rawBody || !verifyResendSignature(options.rawBody, options.headers || {})) {
      return { ok: false, error: 'invalid_signature' };
    }
  }
  const type = String(payload?.type || '').toLowerCase();
  const emailId = payload?.data?.email_id || payload?.data?.id;
  const to = payload?.data?.to?.[0] || payload?.data?.email;
  if (!emailId && !to) return { ok: true, skipped: true };

  if (!denizenDb.enabled) return { ok: true, skipped: true };

  const rows = await denizenDb._get(
    'denizen_crm_workspaces?select=org_id,state,updated_at&limit=200',
  ).catch(() => []);

  let updated = 0;
  for (const row of rows || []) {
    const state = row?.state || {};
    const emailLog = Array.isArray(state.emailLog) ? [...state.emailLog] : [];
    let changed = false;

    for (let i = 0; i < emailLog.length; i += 1) {
      const entry = emailLog[i];
      const match = (emailId && entry.providerId === emailId)
        || (to && String(entry.toEmail || '').toLowerCase() === String(to).toLowerCase());
      if (!match) continue;

      if (type.includes('open')) {
        const opens = Array.isArray(entry.opens) ? [...entry.opens] : [];
        opens.push({ at: new Date().toISOString() });
        emailLog[i] = { ...entry, opens, tracked: true };
        changed = true;
      } else if (type.includes('click')) {
        emailLog[i] = { ...entry, clicks: (Number(entry.clicks) || 0) + 1, tracked: true };
        changed = true;
      } else if (type.includes('delivered')) {
        emailLog[i] = { ...entry, status: 'sent', tracked: true };
        changed = true;
      }
    }

    if (changed) {
      await crmStore.upsertWorkspace(row.org_id, { ...state, emailLog }, null, {
        ifUpdatedAt: row.updated_at || null,
      });
      updated += 1;
    }
  }

  return { ok: true, updated };
}

module.exports = { handleResendWebhook };
