'use strict';

const { sendResendEmail } = require('./visitor-notify');

function nextId(list) {
  const ids = (list || []).map((r) => Number(r?.id) || 0);
  return ids.length ? Math.max(...ids) + 1 : Date.now();
}

function findContact(state, contactId) {
  const contacts = Array.isArray(state?.contacts) ? state.contacts : [];
  return contacts.find((c) => String(c?.id) === String(contactId)) || null;
}

function findDeal(state, dealId) {
  const deals = Array.isArray(state?.deals) ? state.deals : [];
  return deals.find((d) => String(d?.id) === String(dealId)) || null;
}

function findDealForContact(state, contact) {
  if (!contact) return null;
  const deals = Array.isArray(state?.deals) ? state.deals : [];
  return deals.find((d) => d.contact === contact.name) || deals[0] || null;
}

function findTemplate(state, templateId, templateName) {
  const templates = Array.isArray(state?.emailTemplates) ? state.emailTemplates : [];
  if (templateId != null) {
    return templates.find((t) => String(t?.id) === String(templateId)) || null;
  }
  if (templateName) {
    const q = String(templateName).toLowerCase();
    return templates.find((t) => String(t?.name || '').toLowerCase() === q) || null;
  }
  return null;
}

function mergeFields(text, ctx) {
  const s = String(text || '');
  const map = {
    '{{name}}': ctx.name || '',
    '{{company}}': ctx.company || '',
    '{{email}}': ctx.email || '',
    '{{deal.title}}': ctx.dealTitle || '',
    '{{deal.value}}': ctx.dealValue || '',
    '{{sender.name}}': ctx.senderName || 'Team',
  };
  let out = s;
  for (const [token, val] of Object.entries(map)) {
    out = out.split(token).join(val);
  }
  return out;
}

function buildMergeContext(state, { contactId, dealId, senderName }) {
  const contact = findContact(state, contactId);
  const deal = dealId != null ? findDeal(state, dealId) : findDealForContact(state, contact);
  const value = deal?.value != null ? `$${Number(deal.value).toLocaleString()}` : '';
  return {
    name: contact?.name || '',
    company: contact?.company || '',
    email: contact?.email || '',
    dealTitle: deal?.title || '',
    dealValue: value,
    senderName: senderName || 'Team',
    contact,
    deal,
  };
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Turn a plain-text (already merge-substituted) body into safe, escaped HTML. */
function textToSafeHtml(text) {
  const escaped = escapeHtml(text).replace(/\r?\n/g, '<br>');
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;`
    + `font-size:15px;line-height:1.5;color:#1f2937;white-space:normal">${escaped}</div>`;
}

function buildMailtoUrl(toEmail, subject, body) {
  const to = encodeURIComponent(String(toEmail || '').trim());
  const subj = encodeURIComponent(String(subject || ''));
  const b = encodeURIComponent(String(body || ''));
  return `mailto:${to}?subject=${subj}&body=${b}`;
}

function appendEmailLog(state, entry) {
  const out = { ...state };
  const emailLog = Array.isArray(out.emailLog) ? [...out.emailLog] : [];
  emailLog.unshift(entry);
  out.emailLog = emailLog.slice(0, 500);
  const auditLog = Array.isArray(out.auditLog) ? [...out.auditLog] : [];
  auditLog.unshift({
    id: nextId(auditLog),
    user: entry.sentBy || 'System',
    action: 'sent',
    entity: 'email',
    entityName: entry.subject || entry.toEmail,
    at: entry.sentAt || new Date().toISOString(),
  });
  out.auditLog = auditLog.slice(0, 200);
  return out;
}

async function deliverEmail({ toEmail, subject, body, attachments }) {
  const to = String(toEmail || '').trim();
  if (!to) return { ok: false, error: 'Recipient email is required' };

  // Never forward caller-supplied HTML verbatim — derive an escaped HTML body
  // from the plain text so merged contact fields can't inject markup/scripts.
  const safeHtml = textToSafeHtml(body);

  const result = await sendResendEmail({
    to,
    subject: String(subject || '').trim() || '(no subject)',
    text: String(body || ''),
    html: safeHtml,
    attachments,
  });

  if (result.ok) {
    return { ok: true, mode: 'resend', providerId: result.id };
  }
  if (result.skipped) {
    return {
      ok: true,
      mode: 'mailto',
      mailto: buildMailtoUrl(to, subject, body),
      reason: result.reason || 'no_api_key',
    };
  }
  return { ok: false, error: 'Send failed' };
}

/**
 * Send (or mailto-fallback) and append emailLog on success.
 */
async function sendCrmEmail(state, opts = {}) {
  const {
    contactId,
    dealId,
    toEmail: toEmailOverride,
    subject: subjectIn,
    body: bodyIn,
    templateId,
    templateName,
    senderName,
    forceMailto,
    attachments,
  } = opts;

  const ctx = buildMergeContext(state, { contactId, dealId, senderName });
  const contact = ctx.contact;
  const toEmail = String(toEmailOverride || contact?.email || '').trim();
  if (!toEmail) {
    return { ok: false, error: 'No recipient email — add an email on the contact first' };
  }

  let subject = subjectIn;
  let body = bodyIn;
  const template = findTemplate(state, templateId, templateName);
  if (template) {
    subject = subject || template.subject;
    body = body || template.body;
  }
  subject = mergeFields(subject, ctx);
  body = mergeFields(body, ctx);

  if (!subject && !body) {
    return { ok: false, error: 'Subject or body is required' };
  }

  let delivery;
  if (forceMailto) {
    delivery = {
      ok: true,
      mode: 'mailto',
      mailto: buildMailtoUrl(toEmail, subject, body),
    };
  } else {
    delivery = await deliverEmail({ toEmail, subject, body, attachments });
  }

  if (!delivery.ok) return delivery;

  const sentAt = new Date().toISOString();
  const logEntry = {
    id: nextId(state.emailLog),
    to: contact?.name || toEmail,
    toEmail,
    contactId: contact?.id ?? contactId ?? 0,
    subject,
    body,
    sentAt,
    opens: [],
    clicks: 0,
    tracked: delivery.mode === 'resend',
    status: delivery.mode === 'resend' ? 'sent' : 'mailto',
    sentBy: senderName || 'You',
    providerId: delivery.providerId || null,
  };

  let nextState = appendEmailLog(state, logEntry);

  if (contact?.id) {
    const contacts = Array.isArray(nextState.contacts) ? [...nextState.contacts] : [];
    const idx = contacts.findIndex((c) => String(c.id) === String(contact.id));
    if (idx >= 0) {
      contacts[idx] = {
        ...contacts[idx],
        lastContact: sentAt.slice(0, 10),
        interactions: (Number(contacts[idx].interactions) || 0) + 1,
      };
      nextState = { ...nextState, contacts };
    }
  }

  return {
    ok: true,
    mode: delivery.mode,
    mailto: delivery.mailto || null,
    logEntry,
    subject,
    body,
    state: nextState,
  };
}

module.exports = {
  mergeFields,
  buildMergeContext,
  buildMailtoUrl,
  sendCrmEmail,
  findTemplate,
  nextId,
};
