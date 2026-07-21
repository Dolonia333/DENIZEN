'use strict';

/**
 * Gmail → CRM inbound watch.
 *
 * Reads the CEO Gmail inbox (OAuth) for mail from configured senders (Angela)
 * and files them into Meridian CRM: contact match/create, emailLog, notes, audit.
 *
 * Env:
 *   GMAIL_INBOUND=1|0                 master (default on when Gmail real mode)
 *   GMAIL_INBOUND_FROM=a@x,b@y        default Angela addresses
 *   GMAIL_INBOUND_ORG_SLUG=zion       org to file into (default DENIZEN_ORG_SLUG / zion)
 *   GMAIL_INBOUND_MAX=15              max messages per poll
 *   GMAIL_INBOUND_NEWER_THAN=30d      Gmail newer_than token
 *   GMAIL_OAUTH_FILE                  existing gmail client path
 *
 * Requires OAuth scope including gmail.readonly (or gmail.modify / mail.google.com).
 */

const fs = require('node:fs');
const path = require('node:path');
const crmStore = require('./denizen-crm-store');
const denizenDb = require('./denizen-db');
const gmailClient = require('./gmail-client');

const ROOT = path.join(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'data', 'crm-email-inbound-state.json');

const DEFAULT_FROM = [
  'vzion253@gmail.com',
  'angelavanzandt1921@gmail.com',
];

function inboundEnabled() {
  const v = String(process.env.GMAIL_INBOUND ?? '1').trim().toLowerCase();
  if (/^(0|false|no|off)$/.test(v)) return false;
  return true;
}

function fromAllowlist() {
  const raw = String(process.env.GMAIL_INBOUND_FROM || '').trim();
  if (!raw) return [...DEFAULT_FROM];
  return raw.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return { processedIds: [], lastPollAt: null, lastError: null };
    const j = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return {
      processedIds: Array.isArray(j.processedIds) ? j.processedIds.slice(-500) : [],
      lastPollAt: j.lastPollAt || null,
      lastError: j.lastError || null,
      lastResult: j.lastResult || null,
    };
  } catch (_) {
    return { processedIds: [], lastPollAt: null, lastError: null };
  }
}

function saveState(st) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2), 'utf8');
}

function nextId(list) {
  let max = 0;
  for (const row of list || []) {
    const n = Number(row?.id);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

function buildQuery(froms) {
  const newer = String(process.env.GMAIL_INBOUND_NEWER_THAN || '30d').trim() || '30d';
  const fromClause = froms.length === 1
    ? `from:${froms[0]}`
    : `from:(${froms.join(' OR ')})`;
  return `${fromClause} newer_than:${newer} -in:chats`;
}

async function resolveOrgId(opts = {}) {
  if (opts.orgId) return opts.orgId;
  const slug = String(
    opts.orgSlug
    || process.env.GMAIL_INBOUND_ORG_SLUG
    || process.env.DENIZEN_ORG_SLUG
    || 'zion',
  ).trim();
  if (denizenDb.orgId && (!slug || slug === process.env.DENIZEN_ORG_SLUG || slug === 'zion')) {
    // prefer configured denizen org when it matches
  }
  if (denizenDb.enabled) {
    const rows = await denizenDb._get(
      `denizen_organizations?select=id,slug&slug=eq.${encodeURIComponent(slug)}&limit=1`,
    ).catch(() => []);
    if (rows?.[0]?.id) return rows[0].id;
  }
  return denizenDb.orgId || null;
}

function findOrCreateContact(state, { email, name }) {
  const contacts = Array.isArray(state.contacts) ? [...state.contacts] : [];
  const em = String(email || '').toLowerCase();
  let contact = contacts.find((c) => String(c?.email || '').toLowerCase() === em);
  if (!contact && name) {
    const q = String(name).toLowerCase();
    contact = contacts.find((c) => String(c?.name || '').toLowerCase().includes(q)
      || q.includes(String(c?.name || '').toLowerCase()));
  }
  if (contact) {
    // backfill email if missing
    if (em && !contact.email) {
      contact = { ...contact, email: em };
      const idx = contacts.findIndex((c) => String(c.id) === String(contact.id));
      if (idx >= 0) contacts[idx] = contact;
    }
    return { contacts, contact, created: false };
  }
  const id = nextId(contacts);
  contact = {
    id,
    name: name || email || 'Inbound contact',
    email: em || '',
    company: '',
    status: 'Capture Team',
    phone: '',
    notes: 'Auto-created from Gmail inbound watch',
    tags: ['gmail-inbound', 'angela-family'],
    createdAt: new Date().toISOString(),
    source: 'gmail_inbound',
  };
  contacts.unshift(contact);
  return { contacts, contact, created: true };
}

/**
 * File one inbound message into CRM state (pure-ish).
 */
function fileMessageIntoState(state, msg, opts = {}) {
  const fromParsed = gmailClient.parseAddress(msg.from);
  const email = (opts.fromEmail || fromParsed.email || '').toLowerCase();
  const name = opts.fromName || fromParsed.name || 'Angela Van Zandt';
  const working = { ...(state || {}) };

  const { contacts, contact, created } = findOrCreateContact(working, { email, name });
  working.contacts = contacts;

  const emailLog = Array.isArray(working.emailLog) ? [...working.emailLog] : [];
  const already = emailLog.some((e) => e.gmailId && e.gmailId === msg.id);
  if (already) {
    return { state: working, skipped: true, reason: 'duplicate', contact };
  }

  const receivedAt = msg.internalDate
    ? new Date(msg.internalDate).toISOString()
    : (msg.date ? new Date(msg.date).toISOString() : new Date().toISOString());

  const bodyText = String(msg.bodyText || msg.snippet || '').slice(0, 8000);
  const entry = {
    id: nextId(emailLog),
    direction: 'inbound',
    from: name,
    fromEmail: email,
    to: msg.to || opts.toEmail || '',
    toEmail: gmailClient.parseAddress(msg.to || '').email || opts.toEmail || null,
    contactId: contact.id,
    subject: msg.subject || '(no subject)',
    body: bodyText,
    snippet: msg.snippet || bodyText.slice(0, 200),
    receivedAt,
    sentAt: receivedAt,
    gmailId: msg.id,
    threadId: msg.threadId || null,
    messageId: msg.messageId || null,
    opens: [],
    clicks: 0,
    tracked: false,
    status: 'received',
    source: opts.source || 'gmail_watch',
  };
  emailLog.unshift(entry);
  working.emailLog = emailLog.slice(0, 500);

  const notes = Array.isArray(working.notes) ? [...working.notes] : [];
  notes.unshift({
    id: nextId(notes),
    type: 'Email',
    contactId: contact.id,
    contact: contact.name,
    text: `📥 Inbound email from ${name} <${email}>\nSubject: ${entry.subject}\n\n${bodyText.slice(0, 2000)}`,
    body: `📥 Inbound email from ${name} <${email}>\nSubject: ${entry.subject}\n\n${bodyText.slice(0, 2000)}`,
    date: receivedAt.slice(0, 10),
    at: receivedAt,
    author: 'Gmail inbound',
    source: 'gmail_inbound',
    gmailId: msg.id,
  });
  working.notes = notes.slice(0, 500);

  // Optional deal linkage by subject keywords
  const deals = Array.isArray(working.deals) ? working.deals : [];
  const subj = String(entry.subject || '').toLowerCase();
  const linkedDeal = deals.find((d) => {
    const t = String(d.title || d.name || '').toLowerCase();
    return t && (subj.includes(t.slice(0, 12)) || t.includes(subj.slice(0, 12)));
  });
  if (linkedDeal) {
    entry.dealId = linkedDeal.id;
  }

  // Suggested follow-up task — Angela confirms in My Day / Assist (or auto-accept via env)
  const autoAccept = /^(1|true|yes|on)$/i.test(String(process.env.GMAIL_INBOUND_AUTO_TASK || '0'));
  const dueDays = Math.min(14, Math.max(1, Number(process.env.GMAIL_INBOUND_TASK_DUE_DAYS || 2)));
  const due = new Date(Date.now() + dueDays * 86400000).toISOString().slice(0, 10);
  const taskTitle = `Follow up: ${String(entry.subject || 'email').slice(0, 80)}`;
  const suggestedTask = {
    id: nextId([...(working.tasks || []), ...(working.suggestedTasks || [])]),
    title: taskTitle,
    contact: contact.name,
    contactId: contact.id,
    due,
    priority: 'Medium',
    done: false,
    status: autoAccept ? 'todo' : 'suggested',
    suggested: !autoAccept,
    notes: `From Gmail inbound (${email}). ${bodyText.slice(0, 240)}`,
    source: 'gmail_inbound',
    gmailId: msg.id,
    dealId: linkedDeal?.id || null,
    createdAt: receivedAt,
  };

  if (autoAccept) {
    const tasks = Array.isArray(working.tasks) ? [...working.tasks] : [];
    tasks.unshift(suggestedTask);
    working.tasks = tasks.slice(0, 500);
  } else {
    const suggested = Array.isArray(working.suggestedTasks) ? [...working.suggestedTasks] : [];
    suggested.unshift(suggestedTask);
    working.suggestedTasks = suggested.slice(0, 100);
  }

  return {
    state: working,
    skipped: false,
    createdContact: created,
    contact,
    emailEntry: entry,
    suggestedTask,
    taskAutoAccepted: autoAccept,
  };
}

/**
 * Inject a single message (API or poll).
 */
async function ingestInboundEmail(msg, opts = {}) {
  if (!inboundEnabled() && !opts.force) {
    return { ok: false, reason: 'inbound_disabled' };
  }
  const orgId = await resolveOrgId(opts);
  if (!orgId) return { ok: false, reason: 'no_org' };
  if (!denizenDb.enabled) return { ok: false, reason: 'db_disabled' };

  const row = await crmStore.getWorkspace(orgId);
  const prev = row?.state || {};
  const filed = fileMessageIntoState(prev, msg, opts);
  if (filed.skipped) {
    return { ok: true, skipped: true, reason: filed.reason, contactId: filed.contact?.id };
  }

  const actor = {
    user: 'Gmail inbound',
    email: null,
    role: 'system',
    source: 'gmail_inbound',
  };
  const saved = await crmStore.upsertWorkspace(orgId, filed.state, null, {
    actor,
    skipAutomations: true,
  });

  return {
    ok: true,
    skipped: false,
    orgId,
    contactId: filed.contact.id,
    contactName: filed.contact.name,
    createdContact: filed.createdContact,
    emailLogId: filed.emailEntry.id,
    subject: filed.emailEntry.subject,
    gmailId: msg.id,
    suggestedTaskId: filed.suggestedTask?.id || null,
    taskAutoAccepted: !!filed.taskAutoAccepted,
    updated_at: saved?.updated_at || null,
  };
}

/**
 * Poll Gmail for allowlisted senders and file into CRM.
 * @param {{ gmail?: object, orgId?: string, broadcast?: function }} opts
 */
async function pollGmailInbound(opts = {}) {
  const result = {
    ok: true,
    enabled: inboundEnabled(),
    gmailMode: gmailClient.mode(),
    from: fromAllowlist(),
    polled: 0,
    filed: 0,
    skipped: 0,
    errors: [],
    items: [],
  };

  if (!inboundEnabled()) {
    result.ok = false;
    result.reason = 'inbound_disabled';
    return result;
  }

  const client = opts.gmail || gmailClient;
  const state = loadState();
  const processed = new Set(state.processedIds || []);
  const froms = fromAllowlist();
  const q = buildQuery(froms);
  const max = Math.min(50, Math.max(1, Number(process.env.GMAIL_INBOUND_MAX || 15)));

  let list;
  if (opts.messages) {
    list = { ok: true, mode: 'mock', messages: opts.messages };
  } else {
    list = await client.listMessages({ q, maxResults: max });
  }

  if (!list.ok) {
    state.lastPollAt = new Date().toISOString();
    state.lastError = list.error || 'list_failed';
    state.lastResult = { ok: false, error: list.error, scopeHint: list.scopeHint };
    saveState(state);
    return {
      ...result,
      ok: false,
      reason: list.error || 'list_failed',
      scopeHint: list.scopeHint || null,
    };
  }

  result.polled = (list.messages || []).length;
  const orgId = await resolveOrgId(opts);

  for (const ref of list.messages || []) {
    if (!ref?.id || processed.has(ref.id)) {
      result.skipped += 1;
      continue;
    }

    let msg;
    if (opts.messageFetcher) {
      msg = await opts.messageFetcher(ref.id);
    } else if (ref.full) {
      msg = { ok: true, ...ref.full, id: ref.id };
    } else {
      msg = await client.getMessage(ref.id);
    }

    if (!msg?.ok) {
      result.errors.push({ id: ref.id, error: msg?.error || 'get_failed' });
      continue;
    }

    const fromEmail = gmailClient.parseAddress(msg.from).email;
    if (fromEmail && !froms.includes(fromEmail) && !opts.skipFromCheck) {
      // safety: only allowlisted senders
      processed.add(ref.id);
      result.skipped += 1;
      continue;
    }

    try {
      const ing = await ingestInboundEmail(msg, {
        orgId,
        force: true,
        source: 'gmail_watch',
      });
      processed.add(ref.id);
      if (ing.skipped) result.skipped += 1;
      else {
        result.filed += 1;
        result.items.push(ing);
        if (typeof opts.broadcast === 'function') {
          opts.broadcast(orgId, {
            type: 'crm_event',
            kind: 'email-inbound',
            npcName: 'Lucy',
            title: ing.subject,
            from: ing.contactName,
            contactId: ing.contactId,
            at: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      result.errors.push({ id: ref.id, error: err?.message || String(err) });
    }
  }

  state.processedIds = [...processed].slice(-500);
  state.lastPollAt = new Date().toISOString();
  state.lastError = result.errors[0]?.error || null;
  state.lastResult = {
    ok: result.ok,
    polled: result.polled,
    filed: result.filed,
    skipped: result.skipped,
    errors: result.errors.length,
  };
  saveState(state);
  result.state = state.lastResult;
  result.lastPollAt = state.lastPollAt;
  return result;
}

function getInboundStatus() {
  const st = loadState();
  return {
    ok: true,
    enabled: inboundEnabled(),
    gmailMode: gmailClient.mode(),
    gmailReal: gmailClient.isReal?.() || gmailClient.mode() === 'real',
    from: fromAllowlist(),
    query: buildQuery(fromAllowlist()),
    lastPollAt: st.lastPollAt,
    lastError: st.lastError,
    lastResult: st.lastResult,
    processedCount: (st.processedIds || []).length,
    needsReadonlyScope: true,
    note: 'OAuth token needs gmail.readonly (or broader) to list inbox. Compose-only tokens cannot read mail.',
  };
}

module.exports = {
  inboundEnabled,
  fromAllowlist,
  buildQuery,
  fileMessageIntoState,
  ingestInboundEmail,
  pollGmailInbound,
  getInboundStatus,
  loadState,
  STATE_PATH,
  DEFAULT_FROM,
};
