'use strict';
/**
 * Gmail Client — a small wrapper that gives the email-handler a stable
 * surface regardless of whether real Gmail is wired up yet.
 *
 * Two modes:
 *
 *   1. **Real Gmail** (production) — when `googleapis` is installed AND
 *      a valid OAuth token file is found, we hit Gmail's REST API for
 *      drafts.create / drafts.send. Set GMAIL_OAUTH_FILE env to point
 *      at your token JSON.
 *
 *   2. **Local-drafts fallback** (default) — writes the drafted email
 *      to `data/email-drafts.json` and returns a synthetic draft id.
 *      Keeps the architecture testable WITHOUT needing to ship Gmail
 *      OAuth on day one. The operator can read drafts via
 *      GET /api/email-drafts and copy-paste them into Gmail's compose
 *      window manually.
 *
 * The two functions both return { id, status, mode } so callers don't
 * have to branch on which mode they're in.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DRAFT_FILE = path.join(ROOT, 'data', 'email-drafts.json');

let _gmail = null;
let _mode = null;          // 'real' | 'local' (resolved on first call)
let _resolveCheckedAt = 0;

/** Resolve which mode we're in. Cached for 60s so each call doesn't
 *  re-stat the OAuth file. */
function _resolveMode() {
  const now = Date.now();
  if (_mode && (now - _resolveCheckedAt) < 60_000) return _mode;
  _resolveCheckedAt = now;

  const oauthFile = process.env.GMAIL_OAUTH_FILE
    || path.join(ROOT, 'data', 'gmail-oauth.json');

  let googleapis = null;
  try { googleapis = require('googleapis'); }
  catch (_) { /* not installed — fall back to local-drafts */ }

  if (!googleapis || !fs.existsSync(oauthFile)) {
    _mode = 'local';
    _gmail = null;
    return _mode;
  }

  try {
    const tokens = JSON.parse(fs.readFileSync(oauthFile, 'utf8'));
    const oAuth2Client = new googleapis.google.auth.OAuth2(
      tokens.client_id, tokens.client_secret, tokens.redirect_uri,
    );
    oAuth2Client.setCredentials(tokens);
    _gmail = googleapis.google.gmail({ version: 'v1', auth: oAuth2Client });
    _mode = 'real';
  } catch (err) {
    console.warn('[gmail-client] OAuth file present but unreadable:', err?.message || err);
    _mode = 'local';
    _gmail = null;
  }
  return _mode;
}

function _readDrafts() {
  try {
    const raw = fs.readFileSync(DRAFT_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.drafts) ? parsed : { drafts: [] };
  } catch (_) {
    return { drafts: [] };
  }
}

function _writeDrafts(store) {
  fs.mkdirSync(path.dirname(DRAFT_FILE), { recursive: true });
  fs.writeFileSync(DRAFT_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function _encodeRfc822({ to, subject, body, threadId }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `MIME-Version: 1.0`,
    '',
    body,
  ];
  const raw = lines.join('\r\n');
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Create a draft. Returns { id, status, mode }.
 *   status: 'drafted' (saved to Gmail or local file, not sent)
 */
async function createDraft({ to, subject, body, threadId, by }) {
  if (!to || !subject || !body) throw new Error('createDraft: to/subject/body all required');
  const mode = _resolveMode();
  const baseRecord = {
    id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    to, subject, body, threadId: threadId || null,
    by: by || 'Sarah',
    createdAt: new Date().toISOString(),
    sent: false,
  };

  if (mode === 'real') {
    try {
      const res = await _gmail.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: {
            threadId: threadId || undefined,
            raw: _encodeRfc822({ to, subject, body, threadId }),
          },
        },
      });
      const record = { ...baseRecord, id: res.data.id, mode: 'real', gmailDraftId: res.data.id };
      // Mirror to local log so /api/email-drafts returns a unified feed.
      const store = _readDrafts();
      store.drafts.unshift(record);
      if (store.drafts.length > 200) store.drafts.length = 200;
      _writeDrafts(store);
      return { id: record.id, status: 'drafted', mode: 'real' };
    } catch (err) {
      console.warn('[gmail-client] real-mode createDraft failed, falling through to local:', err?.message || err);
      // fall through
    }
  }

  // Local mode (or real-mode fallback after failure)
  const record = { ...baseRecord, mode: 'local' };
  const store = _readDrafts();
  store.drafts.unshift(record);
  if (store.drafts.length > 200) store.drafts.length = 200;
  _writeDrafts(store);
  return { id: record.id, status: 'drafted', mode: 'local' };
}

/**
 * Send a previously-created draft. Defaults to refusing unless
 * EMAIL_AUTOSEND=true is set AND the per-NPC SOUL email_style permits.
 *
 * Returns { id, status: 'sent' | 'refused', reason? }.
 */
async function sendDraft({ id, autoSendAllowed }) {
  if (!id) throw new Error('sendDraft: id required');
  const autoSendEnv = String(process.env.EMAIL_AUTOSEND || '').toLowerCase() === 'true';
  if (!autoSendEnv) {
    return { id, status: 'refused', reason: 'EMAIL_AUTOSEND env not set to "true"' };
  }
  if (!autoSendAllowed) {
    return { id, status: 'refused', reason: 'NPC SOUL email_style.never_send is true (or email_canAutoSend missing)' };
  }

  const store = _readDrafts();
  const idx = store.drafts.findIndex(d => d && d.id === id);
  if (idx === -1) return { id, status: 'refused', reason: 'draft not found' };
  const draft = store.drafts[idx];

  const mode = _resolveMode();
  if (mode === 'real' && draft.gmailDraftId) {
    try {
      await _gmail.users.drafts.send({
        userId: 'me',
        requestBody: { id: draft.gmailDraftId },
      });
      draft.sent = true;
      draft.sentAt = new Date().toISOString();
      _writeDrafts(store);
      return { id, status: 'sent', mode: 'real' };
    } catch (err) {
      return { id, status: 'refused', reason: 'gmail send failed: ' + (err?.message || err) };
    }
  }

  // Local mode — there's nothing to actually send. Mark as "sent" in the
  // local log so the operator can see they reviewed it, but flag clearly.
  draft.sent = true;
  draft.sentAt = new Date().toISOString();
  draft.localOnly = true;
  _writeDrafts(store);
  return { id, status: 'sent', mode: 'local', warning: 'local-only — no real Gmail account wired; nothing actually sent' };
}

function listDrafts({ limit = 25, sentFilter = null } = {}) {
  const store = _readDrafts();
  let arr = store.drafts;
  if (sentFilter === true) arr = arr.filter(d => d.sent);
  else if (sentFilter === false) arr = arr.filter(d => !d.sent);
  return arr.slice(0, limit);
}

function mode() { return _resolveMode(); }

function isReal() {
  return _resolveMode() === 'real' && !!_gmail;
}

/**
 * List message ids matching a Gmail search query (requires gmail.readonly or broader).
 * @param {{ q?: string, maxResults?: number }} opts
 * @returns {Promise<{ ok: boolean, mode: string, messages?: {id,threadId}[], error?: string }>}
 */
async function listMessages({ q = 'in:inbox', maxResults = 25 } = {}) {
  const m = _resolveMode();
  if (m !== 'real' || !_gmail) {
    return { ok: false, mode: m || 'local', error: 'gmail_not_configured', messages: [] };
  }
  try {
    const res = await _gmail.users.messages.list({
      userId: 'me',
      q: String(q || 'in:inbox'),
      maxResults: Math.max(1, Math.min(100, Number(maxResults) || 25)),
    });
    const messages = (res.data.messages || []).map((row) => ({
      id: row.id,
      threadId: row.threadId || null,
    }));
    return { ok: true, mode: 'real', messages };
  } catch (err) {
    return {
      ok: false,
      mode: 'real',
      error: err?.message || String(err),
      messages: [],
      scopeHint: 'OAuth may need https://www.googleapis.com/auth/gmail.readonly',
    };
  }
}

/**
 * Fetch one message (headers + plain/html body snippet).
 * @param {string} id
 */
async function getMessage(id) {
  if (!id) throw new Error('getMessage: id required');
  const m = _resolveMode();
  if (m !== 'real' || !_gmail) {
    return { ok: false, mode: m || 'local', error: 'gmail_not_configured' };
  }
  try {
    const res = await _gmail.users.messages.get({
      userId: 'me',
      id: String(id),
      format: 'full',
    });
    const msg = res.data || {};
    const headers = {};
    for (const h of msg.payload?.headers || []) {
      if (h?.name) headers[String(h.name).toLowerCase()] = h.value || '';
    }
    const body = _extractBody(msg.payload);
    return {
      ok: true,
      mode: 'real',
      id: msg.id,
      threadId: msg.threadId || null,
      snippet: msg.snippet || '',
      internalDate: msg.internalDate ? Number(msg.internalDate) : null,
      labelIds: msg.labelIds || [],
      from: headers.from || '',
      to: headers.to || '',
      cc: headers.cc || '',
      subject: headers.subject || '',
      date: headers.date || '',
      messageId: headers['message-id'] || null,
      bodyText: body.text || '',
      bodyHtml: body.html || '',
    };
  } catch (err) {
    return { ok: false, mode: 'real', error: err?.message || String(err) };
  }
}

function _extractBody(payload) {
  const out = { text: '', html: '' };
  if (!payload) return out;

  function walk(part) {
    if (!part) return;
    const mime = String(part.mimeType || '');
    const data = part.body?.data;
    if (data && (mime === 'text/plain' || mime === 'text/html')) {
      const decoded = Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      if (mime === 'text/plain' && !out.text) out.text = decoded;
      if (mime === 'text/html' && !out.html) out.html = decoded;
    }
    if (Array.isArray(part.parts)) {
      for (const p of part.parts) walk(p);
    }
  }
  walk(payload);
  if (!out.text && out.html) {
    out.text = out.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return out;
}

/** Parse "Name <email@x.com>" → { name, email } */
function parseAddress(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) {
    return {
      name: m[1].replace(/^["']|["']$/g, '').trim() || null,
      email: m[2].trim().toLowerCase(),
    };
  }
  if (s.includes('@')) return { name: null, email: s.toLowerCase() };
  return { name: s || null, email: null };
}

module.exports = {
  createDraft,
  sendDraft,
  listDrafts,
  mode,
  isReal,
  listMessages,
  getMessage,
  parseAddress,
  _DRAFT_FILE: DRAFT_FILE,
};
