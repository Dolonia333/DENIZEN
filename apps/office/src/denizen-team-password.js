'use strict';

const crypto = require('crypto');

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;
const PROD_MIN = 6;
const DEV_MIN = 3;

/** Dev/local only — production keeps 6+ chars unless DENIZEN_DEV_RELAXED_PASSWORD is forced off. */
function isDevPasswordRelaxed() {
  const flag = process.env.DENIZEN_DEV_RELAXED_PASSWORD;
  if (flag === '0' || /^false$/i.test(String(flag || ''))) return false;
  if (/^(1|true|yes|on)$/i.test(String(flag || ''))) return true;
  return process.env.NODE_ENV !== 'production';
}

function minPasswordLength() {
  return isDevPasswordRelaxed() ? DEV_MIN : PROD_MIN;
}

function assertPasswordMinLength(password) {
  const min = minPasswordLength();
  const pass = String(password || '');
  if (pass.length < min) {
    const err = new Error(`password must be at least ${min} characters`);
    err.code = 'BAD_INPUT';
    throw err;
  }
}

function hashPassword(password) {  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEY_LEN, SCRYPT_OPTS);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  const actual = crypto.scryptSync(String(password), salt, expected.length, SCRYPT_OPTS);
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = {
  minPasswordLength,
  isDevPasswordRelaxed,
  assertPasswordMinLength,
  hashPassword,
  verifyPassword,
};