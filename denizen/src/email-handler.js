'use strict';
/**
 * Email Handler — inbound n8n webhook → NPC brain → Gmail draft.
 *
 * Architecture (matches the user's spec from this session):
 *
 *   n8n Gmail trigger
 *        │  POST { from, subject, body, threadId? }
 *        ▼
 *   /api/email-inbound (server.js)
 *        ▼
 *   email-handler.processInboundEmail()
 *        ├── route to NPC by email_style (Sarah today, anyone with it)
 *        ├── escalation rules — bail to "operator only" if hot-button keyword
 *        ├── npcBrains.getResponse() with email-shaped prompt
 *        ├── gmail-client.createDraft()  (local fallback if Gmail not wired)
 *        ├── append signature
 *        ├── audit log to data/email-log.json
 *        └── return { ok, drafted: { id, ... } } AND emit worldState event
 *
 * Drafts-only by default. EMAIL_AUTOSEND=true plus a per-NPC SOUL
 * email_style.email_canAutoSend: true is required to actually send.
 *
 * The handler is intentionally pure-ish: it does NOT speak directly
 * to gmail-client when the caller (the HTTP route in server.js) is
 * better placed to also broadcast the Phaser "Sarah walks to her
 * desk" WS event. Caller wires that piece.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_LOG_FILE = path.join(ROOT, 'data', 'email-log.json');
// Tests redirect via _DENIZEN_EMAIL_LOG_OVERRIDE so they don't burn through
// the production cap by appending to the real data/email-log.json.
function _logFile() {
  return process.env._DENIZEN_EMAIL_LOG_OVERRIDE || DEFAULT_LOG_FILE;
}
const PER_NPC_DAILY_CAP = 10;

// ---------- pure helpers ----------------------------------------------------

/** Parse the `### email_style` YAML-ish block out of a SOUL.md.
 *  Returns null if no block is present (the NPC isn't an email handler).
 *  Returns { tone, signature, escalate_keywords[], never_send, max_paragraphs,
 *  email_canAutoSend, always_disclose } when found. */
function parseEmailStyle(soulText) {
  if (!soulText || typeof soulText !== 'string') return null;
  // Normalize CRLF → LF first so the indent-aware regexes below don't have
  // to fight Windows line endings (where \s would greedily eat \r\n and
  // overrun into the next field).
  const normalized = String(soulText).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const match = normalized.match(/###\s*email_style\s*\n([\s\S]+?)(?:\n##\s|\n$)/i);
  if (!match) return null;
  const body = match[1];

  const out = {};
  // Signature is a `|` multi-line block. Use [ \t] (NOT \s) so the indent
  // matcher can't eat newlines and bleed into the next field.
  const sigMatch = body.match(/-\s*signature:\s*\|\s*\n((?:[ \t]{2,8}[^\n]*\n?)+)/);
  if (sigMatch) {
    out.signature = sigMatch[1]
      .split('\n')
      .map(l => l.replace(/^[ \t]+/, ''))
      .filter(l => l.length > 0)
      .join('\n')
      .trim();
  }

  const single = (key) => {
    const re = new RegExp('-\\s*' + key + ':\\s*(.+)', 'i');
    const m = body.match(re);
    if (!m) return undefined;
    let v = m[1].trim();
    // Strip inline-yaml type hints.
    if (/^true|false$/i.test(v)) return /^true$/i.test(v);
    if (/^\d+$/.test(v)) return Number(v);
    return v;
  };

  out.tone = single('tone');
  out.always_disclose = single('always_disclose');
  out.max_paragraphs = single('max_paragraphs');
  out.never_send = single('never_send');
  out.email_canAutoSend = single('email_canAutoSend');

  const kw = body.match(/-\s*escalate_keywords:\s*\[([^\]]+)\]/i);
  if (kw) {
    out.escalate_keywords = kw[1].split(',').map(s => s.trim().replace(/^[\s"']+|[\s"']+$/g, '')).filter(Boolean);
  }

  return out;
}

/** Pick the first NPC whose SOUL declares an email_style. Returns
 *  { name, style } or null. Caller passes npcBrains so we can read souls
 *  without re-parsing files each call (npcBrains already has them in
 *  brain.personality). */
function routeEmailToNpc(npcBrains, emailPayload, { preferredName = null } = {}) {
  if (!npcBrains?.brains) return null;
  const names = preferredName
    ? [preferredName, ...Object.keys(npcBrains.brains).filter(n => n !== preferredName)]
    : Object.keys(npcBrains.brains);
  for (const name of names) {
    const brain = npcBrains.brains[name];
    if (!brain?.personality) continue;
    const style = parseEmailStyle(brain.personality);
    if (style) return { name, style };
  }
  return null;
}

/** Decide whether the email is hot enough to escalate (operator-only,
 *  no auto-draft). Keyword match is case-insensitive and bounded by
 *  word edges so e.g. "ndaily" doesn't match "nda". */
function shouldEscalate(emailPayload, style) {
  if (!style?.escalate_keywords?.length) return false;
  const haystack = `${emailPayload.subject || ''}\n${emailPayload.body || ''}`.toLowerCase();
  return style.escalate_keywords.some(kw => {
    const k = String(kw).toLowerCase();
    if (!k) return false;
    return new RegExp(`(^|\\W)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`).test(haystack);
  });
}

/** Build the LLM prompt for the secretary's reply. Returns
 *  { systemHint, userPrompt }. The NPC's regular SOUL.md + Office
 *  context comes from npcBrains; we just give it the email + tone
 *  guidance. */
function buildReplyPrompt(npcName, emailPayload, style) {
  const tone = style?.tone || 'warm-professional, brief';
  const maxParas = style?.max_paragraphs || 3;
  const systemHint =
    `You are acting as ${npcName}, drafting an email reply on the CEO's behalf.\n` +
    `Tone: ${tone}. Keep it under ${maxParas} short paragraphs.\n` +
    `Always disclose that this draft was composed by an AI secretary, not the CEO personally.\n` +
    `Do NOT make commitments on the CEO's behalf (calendar invites, contract terms, money).`;
  const userPrompt =
    `Incoming email\n` +
    `--------------\n` +
    `From:    ${emailPayload.from || '(unknown)'}\n` +
    `Subject: ${emailPayload.subject || '(no subject)'}\n` +
    `\n${(emailPayload.body || '').slice(0, 4000)}\n` +
    `--------------\n` +
    `Draft a reply that the CEO can review before sending.\n` +
    `Return ONLY the email body — no subject line, no headers, no surrounding quotes.\n` +
    `Do NOT include a signature, name line, or Denizen footer — those are appended automatically.\n` +
    `A short signoff like "Thanks," or "Best," on its own line is fine; just don't add your name.`;
  return { systemHint, userPrompt };
}

/** Format the full final body — LLM output + a clear disclosure footer
 *  + signature block.
 *
 *  Strategy: strip whatever signature the LLM produced (it often copies
 *  the SOUL signature, sometimes truncated to just the first line, plus
 *  a leading "Warm regards," that we don't want), then append OUR
 *  canonical signature block. Net effect: every outbound email is
 *  signed identically with the full 3-line disclosure, no matter what
 *  the LLM did.
 *
 *  Truncation rule: find the first occurrence of the canonical first
 *  signature line in the reply, walk backward past any "Warm regards,"
 *  / "Best," / "Thanks," / blank-line closer, and cut from there. */
function assembleFinalBody(replyText, style) {
  let trimmed = String(replyText || '').trim();
  if (!style?.signature) return trimmed + '\n';

  const sigFirstLine = style.signature.split('\n')[0].trim();
  if (sigFirstLine) {
    const idx = trimmed.indexOf(sigFirstLine);
    if (idx > 0) {
      let cut = idx;
      // Walk backward through whitespace + a single sign-off line
      // (e.g. "Warm regards,") so we don't end the email with a
      // dangling "Best,".
      const before = trimmed.slice(0, cut).replace(/\s+$/, '');
      const lastNewline = before.lastIndexOf('\n');
      const lastLine = (lastNewline === -1 ? before : before.slice(lastNewline + 1)).trim();
      if (/^(warm\s+regards|best|thanks|cheers|sincerely|regards|kind\s+regards)[,!.\s]*$/i.test(lastLine)) {
        cut = lastNewline === -1 ? 0 : lastNewline;
      }
      trimmed = trimmed.slice(0, cut).replace(/\s+$/, '');
    }
  }

  return `${trimmed}\n\n${style.signature}`.trim() + '\n';
}

// ---------- audit log (real file IO; OK to have here, single-writer) -------

function _readLog() {
  try {
    const raw = fs.readFileSync(_logFile(), 'utf8');
    const j = JSON.parse(raw);
    return Array.isArray(j.entries) ? j : { entries: [] };
  } catch (_) {
    return { entries: [] };
  }
}
function _writeLog(store) {
  const f = _logFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(store, null, 2), 'utf8');
}

function _checkBudget(npcName) {
  const today = new Date().toISOString().slice(0, 10);
  const log = _readLog();
  const usedToday = log.entries.filter(e => e?.npc === npcName && (e.at || '').startsWith(today)).length;
  return { allowed: usedToday < PER_NPC_DAILY_CAP, usedToday, cap: PER_NPC_DAILY_CAP };
}

function _appendLog(entry) {
  const store = _readLog();
  store.entries.unshift({ ...entry, at: new Date().toISOString() });
  if (store.entries.length > 500) store.entries.length = 500;
  _writeLog(store);
}

// ---------- main entry point ----------------------------------------------

/**
 * @param {object} deps        { npcBrains, gmailClient }
 * @param {object} emailPayload  { from, subject, body, threadId? }
 * @param {object} opts        { preferredName?, replyToOverride? }
 * @returns {Promise<{ ok:boolean, drafted?:object, escalated?:boolean,
 *                    error?:string, route?:{name,style} }>}
 */
async function processInboundEmail({ npcBrains, gmailClient }, emailPayload, opts = {}) {
  if (!emailPayload?.from || !emailPayload?.subject) {
    return { ok: false, error: 'from + subject required' };
  }

  const routed = routeEmailToNpc(npcBrains, emailPayload, { preferredName: opts.preferredName });
  if (!routed) {
    return { ok: false, error: 'no NPC has email_style configured in their SOUL.md' };
  }
  const { name: npcName, style } = routed;

  // Budget cap so a runaway email loop can't burn provider quota.
  const budget = _checkBudget(npcName);
  if (!budget.allowed) {
    return { ok: false, error: `daily email cap hit for ${npcName} (${budget.usedToday}/${budget.cap})` };
  }

  // Escalation — these emails are NOT drafted automatically. The NPC
  // just files them in the audit log + flags them for the operator.
  if (shouldEscalate(emailPayload, style)) {
    const entry = {
      npc: npcName,
      kind: 'escalated',
      from: emailPayload.from,
      subject: emailPayload.subject,
      reason: 'keyword match — operator review required',
    };
    _appendLog(entry);
    return { ok: true, escalated: true, route: routed };
  }

  // Compose via the existing brain pipeline so the NPC's SOUL voice
  // comes through naturally.
  const { userPrompt } = buildReplyPrompt(npcName, emailPayload, style);
  let replyText;
  try {
    // We pass the CEO as the "from" so the prompt frames it as "the CEO
    // is asking you to handle this for him." The npc-brains pipeline
    // expects (npcName, fromName, text, context) per its existing shape.
    replyText = await npcBrains.getResponse(npcName, 'CEO', userPrompt, {
      kind: 'email-draft',
      emailFrom: emailPayload.from,
      emailSubject: emailPayload.subject,
    });
  } catch (err) {
    _appendLog({ npc: npcName, kind: 'compose-failed', from: emailPayload.from, subject: emailPayload.subject, error: String(err?.message || err) });
    return { ok: false, error: 'compose failed: ' + (err?.message || err), route: routed };
  }

  const finalBody = assembleFinalBody(replyText, style);
  const subjectReply = /^re:/i.test(emailPayload.subject)
    ? emailPayload.subject
    : `Re: ${emailPayload.subject}`;

  // Save the draft.
  let drafted;
  try {
    drafted = await gmailClient.createDraft({
      to: emailPayload.from,
      subject: subjectReply,
      body: finalBody,
      threadId: emailPayload.threadId || null,
      by: npcName,
    });
  } catch (err) {
    _appendLog({ npc: npcName, kind: 'draft-failed', from: emailPayload.from, subject: emailPayload.subject, error: String(err?.message || err) });
    return { ok: false, error: 'draft failed: ' + (err?.message || err), route: routed };
  }

  _appendLog({
    npc: npcName,
    kind: 'drafted',
    draftId: drafted.id,
    mode: drafted.mode,
    from: emailPayload.from,
    subject: emailPayload.subject,
    bodyPreview: finalBody.slice(0, 240),
  });

  return { ok: true, drafted, route: routed };
}

module.exports = {
  parseEmailStyle,
  routeEmailToNpc,
  shouldEscalate,
  buildReplyPrompt,
  assembleFinalBody,
  processInboundEmail,
  _LOG_FILE: DEFAULT_LOG_FILE,
  PER_NPC_DAILY_CAP,
};
