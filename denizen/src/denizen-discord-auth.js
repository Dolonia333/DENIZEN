'use strict';

/**
 * Discord OAuth — create/link Denizen identities and issue demo access grants.
 */
const crypto = require('node:crypto');
const promptTuning = require('./prompt-tuning.js');
const denizenVisitor = require('./denizen-visitor.js');
const userIdentity = require('./denizen-user-identity.js');
const { createAccessGrant, verifySignedToken } = require('./visitor-session-auth.js');
const visitorAccess = require('./visitor-access.js');

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
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
    case 'BAD_INPUT': return 400;
    case 'DENIED': return 403;
    case 'CONFLICT': return 409;
    case 'NOT_CONFIGURED': return 503;
    default: return 500;
  }
}

function publicBaseUrl() {
  const raw = String(
    process.env.DENIZEN_PUBLIC_URL
    || process.env.DENIZEN_URL
    || `http://127.0.0.1:${process.env.PORT || 8888}`,
  ).replace(/\/$/, '');
  return raw;
}

function clientId() {
  return String(process.env.DISCORD_CLIENT_ID || process.env.DISCORD_APPLICATION_ID || '').trim();
}

function clientSecret() {
  return String(process.env.DISCORD_CLIENT_SECRET || '').trim();
}

function redirectUri() {
  const configured = String(process.env.DISCORD_OAUTH_REDIRECT_URI || '').trim();
  if (configured) return configured;
  return `${publicBaseUrl()}/api/visitor/auth/discord/callback`;
}

function isConfigured() {
  return !!(clientId() && clientSecret());
}

function signState(payload) {
  const body = {
    ...payload,
    typ: 'discord_oauth',
    exp: Date.now() + OAUTH_STATE_TTL_MS,
    jti: crypto.randomBytes(8).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', String(
    process.env.DENIZEN_SESSION_SIGNING_KEY
    || process.env.AGENT_TOKEN
    || 'denizen-dev-signing-key-change-me',
  )).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyState(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = crypto.createHmac('sha256', String(
    process.env.DENIZEN_SESSION_SIGNING_KEY
    || process.env.AGENT_TOKEN
    || 'denizen-dev-signing-key-change-me',
  )).update(encoded).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch (_) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.typ !== 'discord_oauth' || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function buildConnectUrl({
  mode = 'signup',
  returnTo = '/discord-map/',
  identityId = null,
  sessionId = null,
  sessionToken = null,
} = {}) {
  if (!isConfigured()) {
    throw new DiscordAuthError('Discord OAuth is not configured (DISCORD_CLIENT_ID + DISCORD_CLIENT_SECRET)', 'NOT_CONFIGURED');
  }
  const state = signState({
    mode: mode === 'link' ? 'link' : 'signup',
    return_to: String(returnTo || '/discord-map/').slice(0, 500),
    identity_id: identityId || null,
    session_id: sessionId || null,
    session_token: sessionToken || null,
  });
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'identify email',
    state,
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: redirectUri(),
  });
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new DiscordAuthError(json.error_description || json.error || `Token exchange failed (${res.status})`);
  }
  return json;
}

async function fetchDiscordUser(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new DiscordAuthError(json.message || `Discord profile fetch failed (${res.status})`);
  }
  return json;
}

function discordDisplayName(user) {
  return String(user.global_name || user.username || 'Discord User').slice(0, 200);
}

function discordAvatarUrl(user) {
  if (!user?.id || !user?.avatar) return null;
  const ext = String(user.avatar).startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
}

async function resolveTargetIdentity(state) {
  if (state.mode !== 'link' || !state.identity_id) return null;
  const identity = await userIdentity.getIdentityById(state.identity_id);
  if (!identity?.id) {
    throw new DiscordAuthError('Denizen profile not found for link', 'BAD_INPUT');
  }
  if (state.session_id && state.session_token) {
    await visitorAccess.assertSessionToken(state.session_id, state.session_token);
    const sessionIdentity = await userIdentity.getIdentityBySession(state.session_id);
    if (sessionIdentity?.id && sessionIdentity.id !== identity.id) {
      throw new DiscordAuthError('Session does not match the profile being linked', 'DENIED');
    }
  }
  return identity;
}

async function completeOAuth({ code, stateToken }) {
  if (!isConfigured()) {
    throw new DiscordAuthError('Discord OAuth is not configured', 'NOT_CONFIGURED');
  }
  const state = verifyState(stateToken);
  if (!state) throw new DiscordAuthError('Invalid or expired OAuth state', 'DENIED');

  const token = await exchangeCode(code);
  const discordUser = await fetchDiscordUser(token.access_token);
  const discordUserId = String(discordUser.id || '').trim();
  if (!discordUserId) throw new DiscordAuthError('Discord user id missing', 'BAD_INPUT');

  const existingByDiscord = await userIdentity.getIdentityByDiscordId(discordUserId);
  const targetIdentity = await resolveTargetIdentity(state).catch((err) => {
    if (err instanceof DiscordAuthError) throw err;
    return null;
  });

  let identity = null;
  let created = false;

  if (state.mode === 'link' && targetIdentity) {
    if (existingByDiscord && existingByDiscord.id !== targetIdentity.id) {
      throw new DiscordAuthError(
        'This Discord account is already linked to another Denizen profile',
        'CONFLICT',
      );
    }
    identity = await userIdentity.linkDiscordToIdentity(targetIdentity.id, {
      discordUserId,
      discordUsername: discordUser.username,
      discordGlobalName: discordUser.global_name || null,
      avatarUrl: discordAvatarUrl(discordUser),
      notifyDiscord: true,
      displayName: discordDisplayName(discordUser),
    });
  } else if (existingByDiscord) {
    identity = await userIdentity.linkDiscordToIdentity(existingByDiscord.id, {
      discordUserId,
      discordUsername: discordUser.username,
      discordGlobalName: discordUser.global_name || null,
      avatarUrl: discordAvatarUrl(discordUser),
      notifyDiscord: true,
      displayName: discordDisplayName(discordUser),
    });
  } else {
    const result = await userIdentity.createIdentityFromDiscord({
      discordUserId,
      discordUsername: discordUser.username,
      discordGlobalName: discordUser.global_name || null,
      email: discordUser.email || null,
      displayName: discordDisplayName(discordUser),
      avatarUrl: discordAvatarUrl(discordUser),
    });
    identity = result.identity;
    created = !!result.created;
  }

  if (!identity?.id) {
    throw new DiscordAuthError('Could not create Denizen profile', 'DISCORD_AUTH');
  }

  const org = await denizenVisitor.resolveOrgBySlug(promptTuning.demoOrgSlug);
  if (!org?.slug) {
    throw new DiscordAuthError('Demo org not configured', 'NOT_CONFIGURED');
  }

  const accessGrant = createAccessGrant({
    tier: 'demo',
    orgSlug: org.slug,
    accessMethod: 'discord',
    email: identity.email_normalized || identity.email,
  });

  if (state.session_id) {
    await userIdentity.linkSessionToIdentity(identity.id, state.session_id).catch(() => null);
  }

  return {
    identity,
    created,
    accessGrant,
    returnTo: state.return_to || '/discord-map/',
    discordUserId,
    discordUsername: discordUser.username,
    displayName: identity.display_name,
  };
}

async function getLinkStatusForSession(sessionId, sessionToken) {
  if (!sessionId) {
    return { configured: isConfigured(), linked: false };
  }
  if (sessionToken) {
    await visitorAccess.assertSessionToken(sessionId, sessionToken);
  }
  const identity = await userIdentity.getIdentityBySession(sessionId);
  if (!identity) {
    return { configured: isConfigured(), linked: false, session_id: sessionId };
  }
  const meta = identity.metadata && typeof identity.metadata === 'object' ? identity.metadata : {};
  return {
    configured: isConfigured(),
    linked: !!identity.discord_user_id,
    session_id: sessionId,
    identity_id: identity.id,
    display_name: identity.display_name,
    discord_user_id: identity.discord_user_id || null,
    discord_username: meta.discord_username || null,
    discord_avatar_url: meta.discord_avatar_url || null,
  };
}

function successHtml({ displayName, created, returnTo, accessGrant, discordUsername }) {
  const safeName = String(displayName || discordUsername || 'friend').replace(/</g, '&lt;');
  const dest = `${String(returnTo || '/discord-map/').replace(/"/g, '')}${String(returnTo || '').includes('?') ? '&' : '?'}access_grant=${encodeURIComponent(accessGrant)}&discord_linked=1`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Denizen · Discord linked</title>
<style>
body{font-family:system-ui,sans-serif;background:#0b1020;color:#e8eefc;margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px}
.box{max-width:440px;background:#151c31;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px;text-align:center}
h1{margin:0 0 10px;font-size:1.35rem;color:#c9d4ff}
p{color:#93a0c0;line-height:1.5;margin:0 0 16px}
.btn{display:inline-block;background:#5865f2;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700}
.meta{font-size:0.82rem;color:#7d8ab0;margin-top:14px}
</style></head><body><div class="box">
<h1>${created ? 'Welcome to Denizen' : 'Discord linked'}</h1>
<p>Hi <b>${safeName}</b> — your Discord profile is now your Denizen map profile. Join a voice channel and you’ll show up as <b>you</b> on the map.</p>
<a class="btn" href="${dest}">Open Discord map</a>
<p class="meta">You can also type <code>,denizen map</code> in Discord anytime.</p>
</div>
<script>setTimeout(function(){ location.href=${JSON.stringify(dest)}; }, 1800);</script>
</body></html>`;
}

function errorHtml(message, retryPath = '/api/visitor/auth/discord/connect?mode=signup&return=/discord-map/') {
  const safe = String(message || 'Something went wrong').replace(/</g, '&lt;');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Discord link failed</title>
<style>body{font-family:system-ui;background:#1a0f14;color:#fecdd3;padding:32px} a{color:#93c5fd}</style></head>
<body><h2>Could not link Discord</h2><p>${safe}</p><p><a href="${retryPath}">Try again</a> · <a href="/discord-map/">Back to map</a></p></body></html>`;
}

module.exports = {
  DiscordAuthError,
  discordAuthErrorStatus,
  publicBaseUrl,
  isConfigured,
  buildConnectUrl,
  completeOAuth,
  getLinkStatusForSession,
  successHtml,
  errorHtml,
  redirectUri,
};
