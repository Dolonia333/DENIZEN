'use strict';

/**
 * Handoff wake webhooks — Denizen POSTs to a teammate bot's URL when
 * send_handoff lands, so Grok/Claude/Cursor wake in seconds instead of polling.
 *
 * Wake URL is stored on denizen_visitor_sessions.metadata.handoff_wake_url
 * (optional handoff_wake_secret for Authorization: Bearer).
 */

const HANDOFF_KINDS = Object.freeze(['question', 'task', 'fyi', 'urgent']);

const STATUS_TO_LIFECYCLE = Object.freeze({
  pending: 'sent',
  sent: 'sent',
  delivered: 'read',
  read: 'read',
  done: 'done',
});

const LIFECYCLE_TO_STATUS = Object.freeze({
  sent: 'pending',
  read: 'delivered',
  done: 'done',
});

const OPEN_STATUSES = Object.freeze(['pending', 'sent']);

function normalizeHandoffKind(raw) {
  const k = String(raw || '').trim().toLowerCase();
  if (HANDOFF_KINDS.includes(k)) return k;
  return 'fyi';
}

function lifecycleFromStatus(status) {
  return STATUS_TO_LIFECYCLE[String(status || '').toLowerCase()] || 'sent';
}

function statusFromLifecycle(lifecycle) {
  const key = String(lifecycle || '').trim().toLowerCase();
  return LIFECYCLE_TO_STATUS[key] || null;
}

function isPrivateHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0') {
    return process.env.DENIZEN_HANDOFF_WAKE_ALLOW_LOCALHOST !== '1'
      && process.env.DENIZEN_HANDOFF_WAKE_ALLOW_LOCALHOST !== 'true';
  }
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  // IPv4 private / link-local / CGNAT
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const parts = h.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  // IPv6 local / ULA
  if (h.includes(':')) {
    if (h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  }
  return false;
}

function validateWakeUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return { ok: false, error: 'url required' };
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return { ok: false, error: 'invalid url' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'url must be http(s)' };
  }
  if (parsed.protocol === 'http:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    return { ok: false, error: 'http only allowed for localhost (set DENIZEN_HANDOFF_WAKE_ALLOW_LOCALHOST=1)' };
  }
  if (isPrivateHostname(parsed.hostname)) {
    return {
      ok: false,
      error: 'private/local hosts blocked (set DENIZEN_HANDOFF_WAKE_ALLOW_LOCALHOST=1 for localhost)',
    };
  }
  if (raw.length > 2000) return { ok: false, error: 'url too long' };
  return { ok: true, url: parsed.toString() };
}

function maskWakeUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.host;
    const path = u.pathname.length > 24
      ? `${u.pathname.slice(0, 12)}…${u.pathname.slice(-8)}`
      : u.pathname;
    return `${u.protocol}//${host}${path}${u.search ? '?…' : ''}`;
  } catch (_) {
    return raw.slice(0, 40) + (raw.length > 40 ? '…' : '');
  }
}

function buildWakePayload({
  handoff,
  fromDisplayName,
  kind,
  replyTo,
  lifecycle,
  event,
  note,
  artifact,
} = {}) {
  const id = handoff?.id || null;
  const message = String(handoff?.message || '').slice(0, 4000);
  const evt = String(event || 'handoff.received').trim() || 'handoff.received';
  const handoffKind = kind || normalizeHandoffKind(handoff?.metadata?.kind || handoff?.kind);
  const life = lifecycle || lifecycleFromStatus(handoff?.status);
  const base = {
    source: 'denizen',
    event: evt,
    at: new Date().toISOString(),
    handoff_id: id,
    kind: handoffKind,
    lifecycle: life,
    status: handoff?.status || 'pending',
    reply_to: replyTo || handoff?.metadata?.reply_to || handoff?.reply_to || null,
    from_session_id: handoff?.from_session_id || null,
    to_session_id: handoff?.to_session_id || null,
    from_npc: handoff?.from_npc || null,
    to_npc: handoff?.to_npc || null,
    from_display_name: fromDisplayName || handoff?.from_display_name || null,
    message,
    note: note || handoff?.metadata?.completion?.note || null,
    artifact: artifact || handoff?.metadata?.completion?.artifact || null,
  };
  if (evt === 'handoff.received') {
    return {
      ...base,
      suggested_actions: suggestedActionsForKind(handoffKind),
      next_step: 'Call get_handoff or list_pending_handoffs, act, then acknowledge_handoff / complete_handoff / reply_handoff',
    };
  }
  if (evt === 'handoff.done' || evt === 'handoff.read') {
    return {
      ...base,
      suggested_actions: evt === 'handoff.done'
        ? ['optional: list_handoff_thread for context', 'record_outcome if this was a deliverable']
        : ['wait for complete_handoff or reply'],
      next_step: evt === 'handoff.done'
        ? 'Recipient finished this handoff'
        : 'Recipient marked this handoff read',
    };
  }
  return base;
}

/** Stable bot-facing projection (drops noisy raw metadata dumps). */
function projectHandoff(row) {
  if (!row) return null;
  const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const kind = row.kind || normalizeHandoffKind(meta.kind);
  const lifecycle = row.lifecycle || lifecycleFromStatus(row.status);
  const document = meta.document && typeof meta.document === 'object' ? meta.document : null;
  return {
    id: row.id,
    kind,
    lifecycle,
    status: row.status,
    message: row.message,
    from_session_id: row.from_session_id,
    to_session_id: row.to_session_id,
    from_npc: row.from_npc,
    to_npc: row.to_npc,
    from_display_name: row.from_display_name || null,
    to_display_name: row.to_display_name || null,
    reply_to: row.reply_to || meta.reply_to || null,
    document,
    completion: meta.completion || null,
    created_at: row.created_at || null,
    suggested_actions: row.suggested_actions || suggestedActionsForKind(kind),
    direction: row.direction || null,
  };
}

function suggestedActionsForKind(kind) {
  switch (normalizeHandoffKind(kind)) {
    case 'question':
      return ['reply with send_handoff reply_to=this id', 'acknowledge_handoff'];
    case 'task':
      return ['do the work', 'complete_handoff when finished'];
    case 'urgent':
      return ['act immediately', 'acknowledge_handoff', 'complete_handoff'];
    case 'fyi':
    default:
      return ['acknowledge_handoff after noting'];
  }
}

async function postWakeWebhook(url, payload, { secret, timeoutMs, fetchImpl } = {}) {
  const check = validateWakeUrl(url);
  if (!check.ok) return { ok: false, skipped: true, error: check.error };
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return { ok: false, error: 'fetch unavailable' };
  }
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Denizen-Handoff-Wake/1.0',
    'X-Denizen-Event': 'handoff.received',
  };
  if (secret) headers.Authorization = `Bearer ${String(secret).slice(0, 512)}`;
  if (payload?.handoff_id) headers['X-Denizen-Handoff-Id'] = String(payload.handoff_id);

  const ms = Math.max(1000, Math.min(15000, Number(timeoutMs) || 8000));
  try {
    const res = await fetchFn(check.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(ms),
    });
    return { ok: res.ok, status: res.status, url: maskWakeUrl(check.url) };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), url: maskWakeUrl(check.url) };
  }
}

function wakeConfigFromSession(session) {
  const meta = session?.metadata && typeof session.metadata === 'object' ? session.metadata : {};
  const url = String(meta.handoff_wake_url || '').trim() || null;
  const secret = String(meta.handoff_wake_secret || '').trim() || null;
  return { url, secret, configured: !!url };
}

async function notifyHandoffWake({
  visitor,
  toSessionId,
  handoff,
  fromDisplayName,
  kind,
  replyTo,
  fetchImpl,
  timeoutMs,
} = {}) {
  if (!toSessionId || !handoff) {
    return { ok: false, skipped: true, reason: 'missing_handoff' };
  }
  let session = null;
  try {
    session = await visitor?.getSession?.(toSessionId);
  } catch (_) {
    session = null;
  }
  const cfg = wakeConfigFromSession(session);
  if (!cfg.url) {
    return { ok: false, skipped: true, reason: 'no_wake_url' };
  }
  const payload = buildWakePayload({
    handoff,
    fromDisplayName,
    kind,
    replyTo,
  });
  const result = await postWakeWebhook(cfg.url, payload, {
    secret: cfg.secret,
    fetchImpl,
    timeoutMs,
  });
  return {
    ...result,
    skipped: false,
    notified: !!result.ok,
    reason: result.ok ? 'posted' : (result.error || `http_${result.status || 'error'}`),
  };
}

module.exports = {
  HANDOFF_KINDS,
  OPEN_STATUSES,
  STATUS_TO_LIFECYCLE,
  LIFECYCLE_TO_STATUS,
  normalizeHandoffKind,
  lifecycleFromStatus,
  statusFromLifecycle,
  validateWakeUrl,
  maskWakeUrl,
  buildWakePayload,
  projectHandoff,
  suggestedActionsForKind,
  postWakeWebhook,
  wakeConfigFromSession,
  notifyHandoffWake,
  isPrivateHostname,
};
