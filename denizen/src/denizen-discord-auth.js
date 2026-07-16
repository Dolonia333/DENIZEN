'use strict';

/**
 * Discord OAuth for Denizen visitor accounts + Discord Spaces map linking.
 *
 * Routes (wired in server.js):
 *   GET  /api/visitor/auth/discord/connect   → 302 Discord authorize
 *   GET  /api/visitor/auth/discord/callback  → exchange code, link identity, HTML
 *   GET  /api/visitor/auth/discord/status    → { linked, discord_user_id, … }
 *
 * Env:
 *   DISCORD_CLIENT_ID | DISCORD_APPLICATION_ID
 *   DISCORD_CLIENT_SECRET
 *   DENIZEN_PUBLIC_URL | DENIZEN_URL   (redirect base; default http://127.0.0.1:8080)
 *   DENIZEN_SESSION_SIGNING_KEY | AGENT_TOKEN  (state HMAC)
 *
 * Discord Developer Portal → OAuth2 → Redirects:
 *   {public}/api/visitor/auth/discord/callback
 */

const crypto = require('node:crypto');

const denizenDb = require('./denizen-db.js');
const userIdentity = require('./denizen-user-identity.js');
const sessionAuth = require('./visitor-session-auth.js');
const visitorAccess = require('./visitor-access.js');
const promptTuning = require('./prompt-tuning.js');

const STATE_TTL_MS = 15 * 60 * 1000;
const OAUTH_SCOPES = 'identify email';
const DISCORD_API = 'https://discord.com/api/v10';

class DiscordAuthError extends Error {
  constructor(message, code = 'DISCORD_AUTH') {
    super(message);
    this.name = 'DiscordAuthError';
    this.code = code;
  }
}

function discordAuthErrorStatus(err) {
  if (!(err instanceof DiscordAuthError)) return 500;
  switch (err.code) {
    case 'BAD_INPUT':
    case 'OAUTH_DENIED':
      return 400;
    case 'NOT_CONFIGURED':
      return 503;
    case 'DENIED':
    case 'STATE_INVALID':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'UPSTREAM':
      return 502;
    default:
      return 500;
  }
}

function publicBaseUrl() {
  return String(
    process.env.DENIZEN_PUBLIC_URL
    || process.env.DENIZEN_URL
    || 'http://127.0.0.1:8080',
  ).replace(/\/$/, '');
}

function clientId() {
  return String(
    process.env.DISCORD_CLIENT_ID
    || process.env.DISCORD_APPLICATION_ID
    || '',
  ).trim();
}

function clientSecret() {
  return String(process.env.DISCORD_CLIENT_SECRET || '').trim();
}

function assertConfigured() {
  if (!clientId() || !clientSecret() || !signingKey()) {
    throw new DiscordAuthError(
      'Discord OAuth is not configured (set client, secret, and session signing key)',
      'NOT_CONFIGURED',
    );
  }
}

function redirectUri() {
  return `${publicBaseUrl()}/api/visitor/auth/discord/callback`;
}

function signingKey() {
  return String(
    process.env.DENIZEN_SESSION_SIGNING_KEY
    || process.env.AGENT_TOKEN
    || '',
  );
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function signState(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', signingKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyState(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', signingKey()).update(body).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch (_) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.exp || Date.now() > payload.exp) return null;
    if (payload.typ !== 'discord_oauth') return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function avatarUrl(user) {
  if (!user?.id) return null;
  if (user.avatar) {
    const ext = String(user.avatar).startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
  }
  // Default avatar (new username system uses (id >> 22) % 6)
  let index = 0;
  try {
    index = Number((BigInt(user.id) >> 22n) % 6n);
  } catch (_) {
    index = 0;
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function syntheticEmail(discordUserId) {
  return `discord_${String(discordUserId).trim()}@discord.users.denizen.local`;
}

function normalizeReturnTo(returnTo) {
  let path = String(returnTo || '/discord-map/').trim() || '/discord-map/';
  // Only allow relative same-origin paths (block open redirects).
  if (!path.startsWith('/') || path.startsWith('//')) path = '/discord-map/';
  if (path.includes('://')) path = '/discord-map/';
  return path;
}

/**
 * Build Discord OAuth authorize URL and return it for a 302.
 */
function buildConnectUrl({
  mode = 'signup',
  returnTo = '/discord-map/',
  identityId = null,
  sessionId = null,
  sessionToken = null,
} = {}) {
  assertConfigured();
  // Link without a fully authenticated session falls back to signup. Never
  // authorize identity linking from an identity/session id alone.
  let m = mode === 'link' ? 'link' : 'signup';
  if (m === 'link' && (!sessionId || !sessionToken)) {
    m = 'signup';
  }

  const state = signState({
    typ: 'discord_oauth',
    mode: m,
    returnTo: normalizeReturnTo(returnTo),
    // Identity ownership is derived from the authenticated session after the
    // callback; a caller-provided identity id is never trusted.
    identityId: null,
    sessionId: sessionId || null,
    // Store only a hash of the session token so we can re-check after callback
    // without putting the raw token in the OAuth state (still signed).
    sessionTokenHash: sessionToken
      ? sessionAuth.hashSessionToken(sessionToken)
      : null,
    exp: Date.now() + STATE_TTL_MS,
    jti: crypto.randomBytes(8).toString('hex'),
  });

  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: OAUTH_SCOPES,
    state,
    prompt: 'consent',
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: 'authorization_code',
    code: String(code),
    redirect_uri: redirectUri(),
  });
  let res;
  try {
    res = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    throw new DiscordAuthError(`Discord token exchange failed: ${err.message || err}`, 'UPSTREAM');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new DiscordAuthError(
      data.error_description || data.error || `Discord token HTTP ${res.status}`,
      'UPSTREAM',
    );
  }
  return data;
}

async function fetchDiscordUser(accessToken) {
  let res;
  try {
    res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    throw new DiscordAuthError(`Discord user fetch failed: ${err.message || err}`, 'UPSTREAM');
  }
  const user = await res.json().catch(() => ({}));
  if (!res.ok || !user.id) {
    throw new DiscordAuthError(
      user.message || `Discord user HTTP ${res.status}`,
      'UPSTREAM',
    );
  }
  return user;
}

function discordProfile(user) {
  const username = user.global_name || user.username || user.id;
  return {
    discord_user_id: String(user.id),
    discord_username: user.username || null,
    discord_global_name: user.global_name || null,
    display_name: String(username).slice(0, 200),
    // Only a Discord-verified address may join an existing Denizen identity.
    email: user.verified === true && user.email
      ? String(user.email).trim().toLowerCase()
      : null,
    discord_avatar_url: avatarUrl(user),
    discriminator: user.discriminator || null,
  };
}

async function getIdentityByDiscordUserId(discordUserId) {
  const id = String(discordUserId || '').trim();
  if (!id || !userIdentity.isEnabled()) return null;
  const rows = await denizenDb._getSoft(
    `denizen_user_identities?select=*&discord_user_id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows?.[0] || null;
}

async function patchIdentityDiscord(identityId, profile, extraMeta = {}) {
  if (!userIdentity.isEnabled() || !identityId) return null;
  const existing = await userIdentity.getIdentityById(identityId);
  const meta = {
    ...(existing?.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}),
    ...extraMeta,
    discord_username: profile.discord_username,
    discord_global_name: profile.discord_global_name,
    discord_avatar_url: profile.discord_avatar_url,
    discord_linked_at: new Date().toISOString(),
  };
  const patch = {
    discord_user_id: profile.discord_user_id,
    notify_discord: true,
    display_name: profile.display_name || existing?.display_name,
    last_login_at: new Date().toISOString(),
    login_count: (existing?.login_count || 0) + 1,
    metadata: meta,
  };
  const rows = await denizenDb._patchSoft(
    `denizen_user_identities?id=eq.${encodeURIComponent(identityId)}`,
    patch,
    { prefer: 'return=representation' },
  );
  return rows?.[0] || { ...existing, ...patch };
}

/**
 * Create or update a Denizen identity from a Discord profile.
 * Prefer real email; fall back to a stable synthetic address.
 */
async function upsertIdentityFromDiscord(profile, { source = 'discord' } = {}) {
  if (!userIdentity.isEnabled()) return null;

  // Already linked?
  let identity = await getIdentityByDiscordUserId(profile.discord_user_id);
  if (identity?.id) {
    return patchIdentityDiscord(identity.id, profile, { source });
  }

  const email = profile.email || syntheticEmail(profile.discord_user_id);
  identity = await userIdentity.upsertIdentity({
    email,
    displayName: profile.display_name,
    tier: 'demo',
    source,
    updateDisplayName: true,
  });
  if (!identity?.id) return null;
  return patchIdentityDiscord(identity.id, profile, { source, discord_signup: true });
}

async function completeOAuth({ code, stateToken } = {}) {
  assertConfigured();
  if (!code) throw new DiscordAuthError('Missing authorization code', 'BAD_INPUT');

  const state = verifyState(stateToken);
  if (!state) {
    throw new DiscordAuthError('Invalid or expired OAuth state — try again', 'STATE_INVALID');
  }

  const token = await exchangeCode(code);
  const user = await fetchDiscordUser(token.access_token);
  const profile = discordProfile(user);

  const mode = state.mode === 'link' ? 'link' : 'signup';
  let identity = null;
  let sessionId = state.sessionId || null;

  if (mode === 'link') {
    if (!sessionId || !state.sessionTokenHash) {
      throw new DiscordAuthError('Authenticated session required for Discord linking', 'DENIED');
    }
    const rows = await denizenDb._getSoft(
      `denizen_visitor_sessions?select=session_token_hash&limit=1&id=eq.${encodeURIComponent(sessionId)}`,
    );
    const stored = rows?.[0]?.session_token_hash;
    if (!stored || stored !== state.sessionTokenHash) {
      throw new DiscordAuthError('Session token mismatch — re-open Link from the map', 'DENIED');
    }
    identity = await userIdentity.getIdentityBySession(sessionId).catch(() => null);
    if (!identity?.id) {
      // Link with no identity yet: create one and attach if we have a session.
      identity = await upsertIdentityFromDiscord(profile, { source: 'discord_link' });
      if (identity?.id && sessionId) {
        await userIdentity.linkSessionToIdentity(identity.id, sessionId).catch(() => null);
      }
    } else {
      // Guard: discord id already on another account
      const other = await getIdentityByDiscordUserId(profile.discord_user_id);
      if (other?.id && other.id !== identity.id) {
        throw new DiscordAuthError(
          'This Discord account is already linked to another Denizen profile',
          'DENIED',
        );
      }
      identity = await patchIdentityDiscord(identity.id, profile, { source: 'discord_link' });
      if (sessionId) {
        await userIdentity.linkSessionToIdentity(identity.id, sessionId).catch(() => null);
      }
    }
  } else {
    // signup — create/return identity; map will exchange access_grant for a session
    identity = await upsertIdentityFromDiscord(profile, { source: 'discord' });
  }

  const orgSlug = promptTuning.demoOrgSlug || 'acme';
  const access_grant = sessionAuth.createAccessGrant({
    tier: 'demo',
    orgSlug,
    accessMethod: 'discord',
    email: identity?.email_normalized || identity?.email || profile.email || syntheticEmail(profile.discord_user_id),
  });

  return {
    mode,
    profile,
    identity,
    sessionId,
    access_grant,
    returnTo: state.returnTo || '/discord-map/',
    clientIdentity: identity
      ? userIdentity.toClientIdentity(identity)
      : {
        discord_user_id: profile.discord_user_id,
        discord_username: profile.discord_username,
        display_name: profile.display_name,
        discord_avatar_url: profile.discord_avatar_url,
      },
  };
}

async function getLinkStatusForSession(sessionId, sessionToken) {
  if (!sessionId) {
    throw new DiscordAuthError('session_id required', 'BAD_INPUT');
  }
  try {
    await visitorAccess.assertSessionToken(sessionId, sessionToken);
  } catch (err) {
    if (err instanceof visitorAccess.VisitorAccessError) {
      throw new DiscordAuthError(err.message, err.code || 'DENIED');
    }
    throw err;
  }

  const identity = await userIdentity.getIdentityBySession(sessionId).catch(() => null);
  if (!identity) {
    return {
      linked: false,
      discord_user_id: null,
      identity_id: null,
    };
  }
  const meta = identity.metadata && typeof identity.metadata === 'object' ? identity.metadata : {};
  const discordUserId = identity.discord_user_id || meta.discord_user_id || null;
  return {
    linked: !!discordUserId,
    identity_id: identity.id,
    discord_user_id: discordUserId,
    discord_username: meta.discord_username || null,
    display_name: identity.display_name || meta.discord_global_name || null,
    discord_avatar_url: meta.discord_avatar_url || null,
    tier: identity.tier || null,
  };
}

function errorHtml(message) {
  const msg = esc(message || 'Something went wrong');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Discord link failed — Denizen</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0b1020;font-family:system-ui,sans-serif;color:#e8eefc;padding:24px}
  .card{max-width:420px;background:#151c31;border:1px solid rgba(255,255,255,.1);
    border-radius:16px;padding:28px;box-shadow:0 20px 50px rgba(0,0,0,.4)}
  h1{font-size:1.15rem;margin:0 0 10px}
  p{color:#93a0c0;font-size:.9rem;line-height:1.5;margin:0 0 18px}
  a{display:inline-block;background:#5865f2;color:#fff;text-decoration:none;
    font-weight:700;padding:10px 16px;border-radius:10px}
  a.secondary{background:transparent;border:1px solid rgba(255,255,255,.15);margin-left:8px}
</style></head><body>
<div class="card">
  <h1>Couldn’t link Discord</h1>
  <p>${msg}</p>
  <a href="/discord-map/">Back to map</a>
  <a class="secondary" href="/">Denizen office</a>
</div>
</body></html>`;
}

/**
 * Success page: write map localStorage (for ME_DISCORD_ID) then redirect with access_grant.
 */
function successHtml(result) {
  const profile = result?.profile || {};
  const returnTo = normalizeReturnTo(result?.returnTo || '/discord-map/');
  const grant = result?.access_grant || '';
  const u = new URL(returnTo, 'http://local.invalid');
  if (grant) u.searchParams.set('access_grant', grant);
  u.searchParams.set('discord_linked', '1');
  const nextPath = `${u.pathname}${u.search}${u.hash}`;

  const payload = {
    discordUserId: profile.discord_user_id || null,
    discordUsername: profile.discord_username || null,
    discordDisplayName: profile.display_name || null,
    discordAvatarUrl: profile.discord_avatar_url || null,
  };

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Discord linked — Denizen</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0b1020;font-family:system-ui,sans-serif;color:#e8eefc;padding:24px}
  .card{max-width:420px;background:#151c31;border:1px solid rgba(255,255,255,.1);
    border-radius:16px;padding:28px;text-align:center}
  .ok{color:#3dd68c;font-weight:800;font-size:1.1rem;margin-bottom:8px}
  p{color:#93a0c0;font-size:.9rem;line-height:1.5}
  img{width:56px;height:56px;border-radius:50%;margin:12px auto;display:block;border:2px solid #3dd68c}
</style></head><body>
<div class="card">
  <div class="ok">Discord linked</div>
  ${payload.discordAvatarUrl ? `<img src="${esc(payload.discordAvatarUrl)}" alt=""/>` : ''}
  <p><strong>${esc(payload.discordDisplayName || 'You')}</strong> will show in green on the map.</p>
  <p>Redirecting…</p>
</div>
<script>
(function () {
  var KEY = 'denizen-discord-map';
  var patch = ${JSON.stringify(payload)};
  try {
    var cur = {};
    try { cur = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
    if (patch.discordUserId) cur.discordUserId = patch.discordUserId;
    if (patch.discordUsername) cur.discordUsername = patch.discordUsername;
    if (patch.discordDisplayName) cur.discordDisplayName = patch.discordDisplayName;
    if (patch.discordAvatarUrl) cur.discordAvatarUrl = patch.discordAvatarUrl;
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch (e) {}
  location.replace(${JSON.stringify(nextPath)});
})();
</script>
</body></html>`;
}

module.exports = {
  DiscordAuthError,
  discordAuthErrorStatus,
  buildConnectUrl,
  completeOAuth,
  getLinkStatusForSession,
  errorHtml,
  successHtml,
  // test helpers
  _verifyState: verifyState,
  _signState: signState,
  _discordProfile: discordProfile,
  _avatarUrl: avatarUrl,
  _syntheticEmail: syntheticEmail,
  _normalizeReturnTo: normalizeReturnTo,
  _publicBaseUrl: publicBaseUrl,
  _redirectUri: redirectUri,
  getIdentityByDiscordUserId,
};
