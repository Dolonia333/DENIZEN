'use strict';

const crypto = require('node:crypto');
const crmStore = require('./denizen-crm-store');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
const MS_CLIENT_ID = process.env.MICROSOFT_CALENDAR_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID || '';
const MS_CLIENT_SECRET = process.env.MICROSOFT_CALENDAR_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET || '';

const pendingOAuth = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;

function publicBaseUrl() {
  return String(process.env.DENIZEN_PUBLIC_URL || process.env.DENIZEN_URL || 'http://localhost:8080').replace(/\/$/, '');
}

function nextId(list) {
  const ids = (list || []).map((r) => Number(r?.id) || 0);
  return ids.length ? Math.max(...ids) + 1 : Date.now();
}

function prunePending() {
  const now = Date.now();
  for (const [k, v] of pendingOAuth.entries()) {
    if (now - v.at > PENDING_TTL_MS) pendingOAuth.delete(k);
  }
}

function makeState(orgId, identityId, provider) {
  prunePending();
  const state = crypto.randomBytes(16).toString('hex');
  pendingOAuth.set(state, { orgId, identityId, provider, at: Date.now() });
  return state;
}

function consumeState(state) {
  prunePending();
  const row = pendingOAuth.get(state);
  if (!row) return null;
  pendingOAuth.delete(state);
  if (Date.now() - row.at > PENDING_TTL_MS) return null;
  return row;
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
    [provider]: conn,
  };
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

function buildGoogleAuthUrl(orgId, identityId) {
  if (!GOOGLE_CLIENT_ID) return { ok: false, error: 'google_not_configured' };
  const state = makeState(orgId, identityId, 'google');
  const redirect = `${publicBaseUrl()}/api/crm/calendar/google/callback`;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return { ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
}

function buildMicrosoftAuthUrl(orgId, identityId) {
  if (!MS_CLIENT_ID) return { ok: false, error: 'microsoft_not_configured' };
  const state = makeState(orgId, identityId, 'microsoft');
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

  const redirect = `${publicBaseUrl()}/api/crm/calendar/google/callback`;
  const tokens = await exchangeToken('https://oauth2.googleapis.com/token', {
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: redirect,
    grant_type: 'authorization_code',
  });

  let email = null;
  try {
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    email = profile.email || null;
  } catch { /* ignore */ }

  const row = await crmStore.getWorkspace(ctx.orgId);
  const stateObj = setConnection(row?.state || {}, ctx.identityId, 'google', {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || getConnections(row?.state || {}, ctx.identityId).google?.refresh_token || null,
    expires_at: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
    email,
    connected_at: new Date().toISOString(),
  });
  await crmStore.upsertWorkspace(ctx.orgId, stateObj, ctx.identityId, { ifUpdatedAt: row?.updated_at || null });
  return { ok: true, provider: 'google', email };
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
  if (!conn?.refresh_token) return conn;
  if (conn.expires_at && Date.now() < conn.expires_at - 60_000) return conn;
  const tokens = await exchangeToken('https://oauth2.googleapis.com/token', {
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: conn.refresh_token,
    grant_type: 'refresh_token',
  });
  return {
    ...conn,
    access_token: tokens.access_token,
    expires_at: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
  };
}

async function refreshMicrosoftToken(conn) {
  if (!conn?.refresh_token) return conn;
  if (conn.expires_at && Date.now() < conn.expires_at - 60_000) return conn;
  const tokens = await exchangeToken('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    client_id: MS_CLIENT_ID,
    client_secret: MS_CLIENT_SECRET,
    refresh_token: conn.refresh_token,
    grant_type: 'refresh_token',
  });
  return {
    ...conn,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || conn.refresh_token,
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
  const existing = new Set(meetings.map((m) => m.externalId).filter(Boolean));
  let added = 0;
  for (const m of imported) {
    if (existing.has(m.externalId)) continue;
    meetings.push({ ...m, id: nextId(meetings) });
    existing.add(m.externalId);
    added += 1;
  }
  state.meetings = meetings;

  await crmStore.upsertWorkspace(orgId, state, identityId, { ifUpdatedAt: row?.updated_at || null });
  return { ok: true, imported: added, total: imported.length };
}

function calendarStatus(state, identityId) {
  const conn = getConnections(state, identityId);
  return {
    google: conn.google ? { connected: true, email: conn.google.email, lastSync: conn.google.last_sync_at || null } : { connected: false },
    microsoft: conn.microsoft ? { connected: true, email: conn.microsoft.email, lastSync: conn.microsoft.last_sync_at || null } : { connected: false },
    googleConfigured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
    microsoftConfigured: Boolean(MS_CLIENT_ID && MS_CLIENT_SECRET),
  };
}

module.exports = {
  buildGoogleAuthUrl,
  buildMicrosoftAuthUrl,
  handleGoogleCallback,
  handleMicrosoftCallback,
  syncCalendar,
  calendarStatus,
};
