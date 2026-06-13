'use strict';

const COOKIE_OPTS = 'Path=/; Max-Age=2592000; SameSite=Lax';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const key = part.slice(0, i).trim();
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch (_) {
      out[key] = part.slice(i + 1).trim();
    }
  }
  return out;
}

function setSessionCookies(res, { sessionId, sessionToken } = {}) {
  const cookies = [];
  if (sessionId) cookies.push(`dz_sid=${encodeURIComponent(sessionId)}; ${COOKIE_OPTS}`);
  if (sessionToken) cookies.push(`dz_stok=${encodeURIComponent(sessionToken)}; ${COOKIE_OPTS}`);
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
}

function clearSessionCookies(res) {
  res.setHeader('Set-Cookie', [
    'dz_sid=; Path=/; Max-Age=0; SameSite=Lax',
    'dz_stok=; Path=/; Max-Age=0; SameSite=Lax',
  ]);
}

function sessionIdFromCookies(req) {
  return parseCookies(req.headers?.cookie).dz_sid || null;
}

function sessionTokenFromCookies(req) {
  return parseCookies(req.headers?.cookie).dz_stok || null;
}

module.exports = {
  parseCookies,
  setSessionCookies,
  clearSessionCookies,
  sessionIdFromCookies,
  sessionTokenFromCookies,
};
