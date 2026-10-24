'use strict';

const denizenVisitor = require('./denizen-visitor');
const crmStore = require('./denizen-crm-store');

function nextId(list) {
  const ids = (list || []).map((r) => Number(r?.id) || 0);
  return ids.length ? Math.max(...ids) + 1 : Date.now();
}

// --- Abuse protection for the unauthenticated public form ---
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_PER_WINDOW = 8;       // per client key (IP) per minute
const RATE_MAX_PER_ORG = 40;         // per org per minute (spam burst guard)
const MAX_FIELD_LEN = 2000;          // name/email/company
const MAX_ANSWER_KEYS = 60;
const MAX_ANSWER_LEN = 5000;
const _rateHits = new Map(); // key -> number[] (timestamps)

function _recordHit(key) {
  if (!key) return 0;
  const now = Date.now();
  const hits = (_rateHits.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  _rateHits.set(key, hits);
  // Opportunistic cleanup so the map can't grow unbounded.
  if (_rateHits.size > 5000) {
    for (const [k, v] of _rateHits) {
      if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) _rateHits.delete(k);
    }
  }
  return hits.length;
}

function _clip(value, max = MAX_FIELD_LEN) {
  return String(value || '').trim().slice(0, max);
}

function _sanitizeAnswers(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (count >= MAX_ANSWER_KEYS) break;
    const key = String(k).slice(0, 200);
    if (v == null) { out[key] = ''; }
    else if (typeof v === 'object') { out[key] = _clip(JSON.stringify(v), MAX_ANSWER_LEN); }
    else { out[key] = _clip(v, MAX_ANSWER_LEN); }
    count += 1;
  }
  return out;
}

/**
 * Public intake form submission — no session required.
 * Body: { org_slug, clientName, clientEmail, company, answers }
 * options.clientKey — caller-supplied per-IP key used for rate limiting.
 */
async function submitPublicIntake(body, options = {}) {
  const orgSlug = String(body.org_slug || body.orgSlug || '').trim().toLowerCase();
  if (!orgSlug) return { ok: false, error: 'org_slug is required' };

  const clientKey = String(options.clientKey || '').trim();
  if (clientKey && _recordHit(`ip:${clientKey}`) > RATE_MAX_PER_WINDOW) {
    return { ok: false, error: 'rate_limited', status: 429 };
  }

  const org = await denizenVisitor.resolveOrgBySlug(orgSlug);
  if (!org?.id) return { ok: false, error: 'Organization not found' };

  // Per-org burst guard (covers attackers rotating IPs against one form).
  if (_recordHit(`org:${org.id}`) > RATE_MAX_PER_ORG) {
    return { ok: false, error: 'rate_limited', status: 429 };
  }

  const name = _clip(body.clientName || body.client_name || '');
  const email = _clip(body.clientEmail || body.client_email || '');
  if (!name && !email) return { ok: false, error: 'Name or email is required' };

  const row = await crmStore.getWorkspace(org.id);
  const state = { ...(row?.state || {}) };
  const submissions = Array.isArray(state.submissions) ? [...state.submissions] : [];

  const submission = {
    id: nextId(submissions),
    clientName: name || email.split('@')[0],
    clientEmail: email,
    company: _clip(body.company || ''),
    submittedAt: new Date().toISOString(),
    status: 'new',
    assignedTo: '',
    teamNote: '',
    answers: _sanitizeAnswers(body.answers),
    quoteId: null,
    source: 'public_form',
  };

  submissions.unshift(submission);
  state.submissions = submissions.slice(0, 2000); // cap unbounded growth from public form

  const auditLog = Array.isArray(state.auditLog) ? [...state.auditLog] : [];
  auditLog.unshift({
    id: nextId(auditLog),
    user: 'Public intake',
    action: 'submitted',
    entity: 'submission',
    entityName: submission.clientName,
    at: submission.submittedAt,
  });
  state.auditLog = auditLog.slice(0, 500);

  await crmStore.upsertWorkspace(org.id, state, null, { ifUpdatedAt: row?.updated_at || null });
  return { ok: true, submissionId: submission.id };
}

module.exports = {
  submitPublicIntake,
  // Shared helpers/limits (reused by denizen-crm-intake-ingest.js).
  _clip,
  _sanitizeAnswers,
  _recordHit,
  MAX_FIELD_LEN,
  MAX_ANSWER_LEN,
};
