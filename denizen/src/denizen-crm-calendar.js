'use strict';

const crypto = require('node:crypto');
const crmStore = require('./denizen-crm-store');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
const MS_CLIENT_ID = process.env.MICROSOFT_CALENDAR_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID || '';
const MS_CLIENT_SECRET = process.env.MICROSOFT_CALENDAR_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET || '';

const GOOGLE_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
];
const GOOGLE_REDIRECT_PATH = '/api/crm/google/callback';
const SECRET_PREFIX = 'enc:v1:';
const usedOAuthNonces = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;

function publicBaseUrl() {
  return String(process.env.DENIZEN_PUBLIC_URL || process.env.DENIZEN_URL || 'http://localhost:8080').replace(/\/$/, '');
}

function nextId(list) {
  const ids = (list || []).map((r) => Number(r?.id) || 0);
  return ids.length ? Math.max(...ids) + 1 : Date.now();
}

function googleClient() {
  const id = String(process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '');
  const secret = String(process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '');
  if (id && secret) return { id, secret };
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const file = process.env.GOOGLE_OAUTH_CLIENT_FILE
      || path.join(__dirname, '..', 'data', 'google-oauth-client.json');
    if (!fs.existsSync(file)) return { id, secret };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const web = parsed.web || parsed.installed || parsed;
    return {
      id: id || String(web.client_id || web.clientId || ''),
      secret: secret || String(web.client_secret || web.clientSecret || ''),
    };
  } catch (_) {
    return { id, secret };
  }
}

function googleConfigured() {
  const client = googleClient();
  return Boolean(client.id && client.secret);
}

function googleRedirectUri() {
  return `${publicBaseUrl()}${GOOGLE_REDIRECT_PATH}`;
}

function stateSecret() {
  return String(process.env.DENIZEN_TOKEN_KEY || googleClient().secret || MS_CLIENT_SECRET || '');
}

function tokenKey() {
  const explicit = String(process.env.DENIZEN_TOKEN_KEY || process.env.DENIZEN_GOOGLE_TOKEN_KEY || '');
  if (explicit) return crypto.createHash('sha256').update(explicit).digest();
  const googleSecret = googleClient().secret;
  if (googleSecret) {
    return crypto.createHash('sha256').update(`denizen-google-tokens:${googleSecret}`).digest();
  }
  if (MS_CLIENT_SECRET) {
    return crypto.createHash('sha256').update(`denizen-microsoft-tokens:${MS_CLIENT_SECRET}`).digest();
  }
  return null;
}

function sealToken(plain) {
  if (plain == null || plain === '') return null;
  const opened = openToken(plain);
  if (!opened) return null;
  const key = tokenKey();
  if (!key) throw new Error('token_key_missing');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(opened), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return SECRET_PREFIX + Buffer.concat([iv, tag, enc]).toString('base64url');
}

function openToken(stored) {
  if (stored == null || stored === '') return null;
  const raw = String(stored);
  if (!raw.startsWith(SECRET_PREFIX)) return raw;
  const key = tokenKey();
  if (!key) return null;
  const buf = Buffer.from(raw.slice(SECRET_PREFIX.length), 'base64url');
  if (buf.length < 29) return null;
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function sealConnection(conn) {
  if (!conn || typeof conn !== 'object') return conn;
  return {
    ...conn,
    access_token: conn.access_token ? sealToken(conn.access_token) : null,
    refresh_token: conn.refresh_token ? sealToken(conn.refresh_token) : null,
  };
}

function pruneNonces() {
  const now = Date.now();
  for (const [nonce, exp] of usedOAuthNonces.entries()) {
    if (exp < now) usedOAuthNonces.delete(nonce);
  }
}

function signState(payload) {
  const secret = stateSecret();
  if (!secret) throw new Error('google_not_configured');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function consumeState(state) {
  pruneNonces();
  const secret = stateSecret();
  if (!secret || !state || !String(state).includes('.')) return null;
  const [body, sig] = String(state).split('.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!payload || !payload.exp || payload.exp < Date.now()) return null;
  if (!payload.nonce || usedOAuthNonces.has(payload.nonce)) return null;
  usedOAuthNonces.set(payload.nonce, payload.exp);
  return payload;
}

function getConnections(state, identityId) {
  const all = state?.calendarConnections && typeof state.calendarConnections === 'object'
    ? state.calendarConnections
    : {};
  return all[identityId] || {};
}

function setConnection(state, identityId, provider, conn) {
  const calendarConnections = {
    ...(state.calendarConnections && typeof state.calendarConnections === 'object' ? state.calendarConnections : {}),
  };
  calendarConnections[identityId] = {
    ...getConnections(state, identityId),
    [provider]: provider === 'google' || provider === 'microsoft' ? sealConnection(conn) : conn,
  };
  return { ...state, calendarConnections };
}

function clearConnection(state, identityId, provider) {
  const calendarConnections = {
    ...(state.calendarConnections && typeof state.calendarConnections === 'object' ? state.calendarConnections : {}),
  };
  const mine = { ...getConnections(state, identityId) };
  delete mine[provider];
  calendarConnections[identityId] = mine;
  return { ...state, calendarConnections };
}

async function exchangeToken(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Token HTTP ${res.status}`);
  return data;
}

function buildGoogleAuthUrl(orgId, identityId, opts = {}) {
  if (!googleConfigured()) return { ok: false, error: 'google_not_configured', redirectUri: googleRedirectUri() };
  if (!identityId) return { ok: false, error: 'identity_required' };
  const redirectUri = googleRedirectUri();
  const state = signState({
    orgId,
    identityId,
    provider: 'google',
    redirectUri,
    returnTo: opts.returnTo || '/connect/google',
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + PENDING_TTL_MS,
  });
  const params = new URLSearchParams({
    client_id: googleClient().id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  });
  return { ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, redirectUri };
}

function buildMicrosoftAuthUrl(orgId, identityId) {
  if (!MS_CLIENT_ID) return { ok: false, error: 'microsoft_not_configured' };
  const state = signState({
    orgId,
    identityId,
    provider: 'microsoft',
    redirectUri: `${publicBaseUrl()}/api/crm/calendar/microsoft/callback`,
    returnTo: '/crm/#schedule',
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + PENDING_TTL_MS,
  });
  const redirect = `${publicBaseUrl()}/api/crm/calendar/microsoft/callback`;
  const params = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'offline_access Calendars.Read User.Read',
    state,
  });
  return { ok: true, url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}` };
}

async function handleGoogleCallback(code, state) {
  const ctx = consumeState(state);
  if (!ctx || ctx.provider !== 'google') return { ok: false, error: 'invalid_state' };

  const redirect = ctx.redirectUri || googleRedirectUri();
  const tokens = await exchangeToken('https://oauth2.googleapis.com/token', {
    code,
    client_id: googleClient().id,
    client_secret: googleClient().secret,
    redirect_uri: redirect,
    grant_type: 'authorization_code',
  });

  let email = null;
  let googleSub = null;
  try {
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    email = profile.email || null;
    googleSub = profile.id || null;
  } catch { /* ignore */ }

  const row = await crmStore.getWorkspace(ctx.orgId);
  const previousRefresh = openToken(getConnections(row?.state || {}, ctx.identityId).google?.refresh_token);
  const stateObj = setConnection(row?.state || {}, ctx.identityId, 'google', {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || previousRefresh || null,
    expires_at: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
    email,
    google_sub: googleSub,
    identity_id: ctx.identityId,
    org_id: ctx.orgId,
    scopes: GOOGLE_SCOPES,
    connected_at: new Date().toISOString(),
  });
  await crmStore.upsertWorkspace(ctx.orgId, stateObj, ctx.identityId, { ifUpdatedAt: row?.updated_at || null });
  return { ok: true, provider: 'google', email, returnTo: ctx.returnTo || '/connect/google' };
}

async function handleMicrosoftCallback(code, state) {
  const ctx = consumeState(state);
  if (!ctx || ctx.provider !== 'microsoft') return { ok: false, error: 'invalid_state' };

  const redirect = `${publicBaseUrl()}/api/crm/calendar/microsoft/callback`;
  const tokens = await exchangeToken('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    code,
    client_id: MS_CLIENT_ID,
    client_secret: MS_CLIENT_SECRET,
    redirect_uri: redirect,
    grant_type: 'authorization_code',
  });

  let email = null;
  try {
    const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    email = profile.mail || profile.userPrincipalName || null;
  } catch { /* ignore */ }

  const row = await crmStore.getWorkspace(ctx.orgId);
  const stateObj = setConnection(row?.state || {}, ctx.identityId, 'microsoft', {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || getConnections(row?.state || {}, ctx.identityId).microsoft?.refresh_token || null,
    expires_at: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
    email,
    connected_at: new Date().toISOString(),
  });
  await crmStore.upsertWorkspace(ctx.orgId, stateObj, ctx.identityId, { ifUpdatedAt: row?.updated_at || null });
  return { ok: true, provider: 'microsoft', email };
}

async function refreshGoogleToken(conn) {
  const refresh = openToken(conn?.refresh_token);
  const access = openToken(conn?.access_token);
  if (!refresh) return { ...conn, access_token: access, refresh_token: null };
  if (conn.expires_at && Date.now() < conn.expires_at - 60_000) {
    return { ...conn, access_token: access, refresh_token: refresh };
  }
  const tokens = await exchangeToken('https://oauth2.googleapis.com/token', {
    client_id: googleClient().id,
    client_secret: googleClient().secret,
    refresh_token: refresh,
    grant_type: 'refresh_token',
  });
  return {
    ...conn,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || refresh,
    expires_at: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
  };
}

async function disconnectGoogle(orgId, identityId) {
  if (!identityId) return { ok: false, error: 'identity_required' };
  const row = await crmStore.getWorkspace(orgId);
  const conn = getConnections(row?.state || {}, identityId).google;
  const token = openToken(conn?.refresh_token) || openToken(conn?.access_token);
  if (token) {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    }).catch(() => null);
  }
  const stateObj = clearConnection(row?.state || {}, identityId, 'google');
  await crmStore.upsertWorkspace(orgId, stateObj, identityId, { ifUpdatedAt: row?.updated_at || null });
  return { ok: true, disconnected: true };
}

async function refreshMicrosoftToken(conn) {
  const refresh = openToken(conn?.refresh_token);
  const access = openToken(conn?.access_token);
  if (!refresh) return { ...conn, access_token: access, refresh_token: null };
  if (conn.expires_at && Date.now() < conn.expires_at - 60_000) {
    return { ...conn, access_token: access, refresh_token: refresh };
  }
  const tokens = await exchangeToken('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    client_id: MS_CLIENT_ID,
    client_secret: MS_CLIENT_SECRET,
    refresh_token: refresh,
    grant_type: 'refresh_token',
  });
  return {
    ...conn,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || refresh,
    expires_at: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
  };
}

function mapGoogleEvent(ev) {
  const start = ev.start?.dateTime || ev.start?.date;
  if (!start) return null;
  const d = new Date(start);
  const date = d.toISOString().slice(0, 10);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const end = ev.end?.dateTime || ev.end?.date;
  const duration = end ? Math.max(15, Math.round((new Date(end).getTime() - d.getTime()) / 60000)) : 30;
  return {
    title: ev.summary || 'Calendar event',
    type: 'other',
    date,
    time,
    duration,
    contact: '',
    attendees: (ev.attendees || []).map((a) => a.email || a.displayName).filter(Boolean),
    status: ev.status === 'cancelled' ? 'cancelled' : 'confirmed',
    notes: ev.description || '',
    meetingUrl: ev.hangoutLink || ev.location || '',
    externalId: `google:${ev.id}`,
    source: 'google',
  };
}

function mapMicrosoftEvent(ev) {
  const start = ev.start?.dateTime;
  if (!start) return null;
  const d = new Date(start);
  const date = d.toISOString().slice(0, 10);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const end = ev.end?.dateTime;
  const duration = end ? Math.max(15, Math.round((new Date(end).getTime() - d.getTime()) / 60000)) : 30;
  return {
    title: ev.subject || 'Calendar event',
    type: 'other',
    date,
    time,
    duration,
    contact: '',
    attendees: (ev.attendees || []).map((a) => a.emailAddress?.address).filter(Boolean),
    status: ev.isCancelled ? 'cancelled' : 'confirmed',
    notes: ev.bodyPreview || '',
    meetingUrl: ev.onlineMeeting?.joinUrl || ev.location?.displayName || '',
    externalId: `microsoft:${ev.id}`,
    source: 'microsoft',
  };
}

async function syncCalendar(orgId, identityId, provider) {
  const row = await crmStore.getWorkspace(orgId);
  let state = { ...(row?.state || {}) };
  const conn = getConnections(state, identityId)[provider];
  if (!conn?.access_token) return { ok: false, error: 'not_connected' };

  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + 30 * 86400000).toISOString();
  const imported = [];

  if (provider === 'google') {
    const fresh = await refreshGoogleToken(conn);
    state = setConnection(state, identityId, 'google', { ...fresh, last_sync_at: new Date().toISOString() });
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('timeMin', timeMin);
    url.searchParams.set('timeMax', timeMax);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '50');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${fresh.access_token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'google_fetch_failed');
    for (const ev of data.items || []) {
      const m = mapGoogleEvent(ev);
      if (m) imported.push(m);
    }
  } else if (provider === 'microsoft') {
    const fresh = await refreshMicrosoftToken(conn);
    state = setConnection(state, identityId, 'microsoft', { ...fresh, last_sync_at: new Date().toISOString() });
    const url = new URL('https://graph.microsoft.com/v1.0/me/calendarview');
    url.searchParams.set('startDateTime', timeMin);
    url.searchParams.set('endDateTime', timeMax);
    url.searchParams.set('$top', '50');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${fresh.access_token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'microsoft_fetch_failed');
    for (const ev of data.value || []) {
      const m = mapMicrosoftEvent(ev);
      if (m) imported.push(m);
    }
  } else {
    return { ok: false, error: 'unknown_provider' };
  }

  const meetings = Array.isArray(state.meetings) ? [...state.meetings] : [];
  const existing = new Set(
    meetings
      .filter((m) => String(m.ownerIdentityId || '') === String(identityId))
      .map((m) => m.externalId)
      .filter(Boolean),
  );
  let added = 0;
  for (const m of imported) {
    if (existing.has(m.externalId)) continue;
    meetings.push({
      ...m,
      id: nextId(meetings),
      visibility: 'private',
      ownerIdentityId: identityId,
    });
    existing.add(m.externalId);
    added += 1;
  }
  state.meetings = meetings;

  await crmStore.upsertWorkspace(orgId, state, identityId, { ifUpdatedAt: row?.updated_at || null });
  return { ok: true, imported: added, total: imported.length };
}

function calendarStatus(state, identityId) {
  const conn = getConnections(state, identityId);
  const google = conn.google?.access_token
    ? {
      connected: true,
      email: conn.google.email || null,
      lastSync: conn.google.last_sync_at || null,
      scopes: conn.google.scopes || GOOGLE_SCOPES,
      connectedAt: conn.google.connected_at || null,
    }
    : { connected: false };
  return {
    google,
    microsoft: conn.microsoft?.access_token
      ? { connected: true, email: conn.microsoft.email || null, lastSync: conn.microsoft.last_sync_at || null }
      : { connected: false },
    googleConfigured: googleConfigured(),
    microsoftConfigured: Boolean(MS_CLIENT_ID && MS_CLIENT_SECRET),
    redirectUri: googleRedirectUri(),
    sendsMail: false,
    pageUrl: '/api/crm/google/app',
    setup: googleConfigured() ? null : {
      message: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET once on the Denizen server. People connect with Google. They do not paste keys.',
      redirectUri: googleRedirectUri(),
    },
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderConnectPage(view) {
  const status = view.status || {};
  const google = status.google || { connected: false };
  const configured = !!status.googleConfigured;
  let body;
  if (!view.signedIn) {
    body = `<p>Sign in to Denizen, then come back to connect the Google account for that person.</p>
      <p><a class="btn" href="/">Sign in</a></p>`;
  } else if (!configured) {
    body = `<p>Connect Google is ready for every Denizen account. This server still needs the one platform Google app.</p>
      <p>Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> on the server. In Google Cloud, register this redirect URI:</p>
      <p><code>${escapeHtml(status.redirectUri)}</code></p>
      <p>After that, each person clicks Connect Google, signs in, and approves. Their tokens stay on their own Denizen identity.</p>`;
  } else if (google.connected) {
    body = `<p>Connected as <strong>${escapeHtml(google.email || 'Google account')}</strong>.</p>
      <p>Denizen can read this account’s calendar and mail. It does not send mail.</p>
      <form method="post" action="/api/crm/google/sync">
        <input type="hidden" name="provider" value="google">
        <input type="hidden" name="session_id" value="${escapeHtml(view.sessionId)}">
        <button class="btn" type="submit">Sync calendar</button>
      </form>
      <form method="post" action="/api/crm/google/disconnect">
        <input type="hidden" name="session_id" value="${escapeHtml(view.sessionId)}">
        <button class="btn quiet" type="submit">Disconnect Google</button>
      </form>`;
  } else {
    body = `<p>Connect the Google account for this Denizen login. Calendar and Gmail stay read-only, and the tokens belong to this person only.</p>
      <p><a class="btn" href="/api/crm/google/connect?session_id=${encodeURIComponent(view.sessionId || '')}">Connect Google</a></p>`;
  }
  const notice = view.notice ? `<p class="note">${escapeHtml(view.notice)}</p>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect Google · Denizen</title>
  <style>
    body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: #0c121c; color: #e7eef8; }
    main { max-width: 38rem; margin: 8vh auto; padding: 0 1.25rem; }
    h1 { font-size: 1.6rem; margin-bottom: 0.4rem; }
    code { color: #9fd0ff; }
    .btn { display: inline-block; margin: 0.6rem 0.6rem 0 0; background: #d7e6ff; color: #102033; text-decoration: none; border: 0; border-radius: 999px; padding: 0.7rem 1.1rem; font: inherit; font-weight: 700; cursor: pointer; }
    .quiet { background: transparent; color: #e7eef8; border: 1px solid #415068; }
    .note { color: #9fd0ff; }
  </style>
</head>
<body>
  <main>
    <h1>Connect Google</h1>
    ${notice}
    ${body}
  </main>
</body>
</html>`;
}

module.exports = {
  GOOGLE_SCOPES,
  buildGoogleAuthUrl,
  buildMicrosoftAuthUrl,
  handleGoogleCallback,
  handleMicrosoftCallback,
  disconnectGoogle,
  syncCalendar,
  calendarStatus,
  googleRedirectUri,
  renderConnectPage,
  sealToken,
  openToken,
  clearConnection,
};
