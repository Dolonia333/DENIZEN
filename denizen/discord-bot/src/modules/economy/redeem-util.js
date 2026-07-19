'use strict';

/**
 * Redeem code helpers (SlotBot-style `,redeem <code>` codes).
 * Pure string helpers only — WalletStore owns storage/validation of codes.
 */

const crypto = require('crypto');

// No 0/O/1/I to avoid visually ambiguous codes when staff read them aloud/paste them.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GROUP_LEN = 4;
const GROUP_COUNT = 3;

function randomGroup(len = GROUP_LEN) {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/** Generates a code like `XXXX-XXXX-XXXX`. */
function generateRedeemCode() {
  return Array.from({ length: GROUP_COUNT }, () => randomGroup()).join('-');
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

/** Loose format check for user-supplied custom codes (letters/digits/dashes, 3-20 chars). */
function isValidCodeFormat(code) {
  return /^[A-Z0-9-]{3,20}$/.test(normalizeCode(code));
}

module.exports = {
  CODE_ALPHABET,
  generateRedeemCode,
  normalizeCode,
  isValidCodeFormat,
};
