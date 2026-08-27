'use strict';

/**
 * MCP / CRM outbound mail policy.
 *
 * DENIZEN_MAIL_POLICY=never|confirm|allowlist  (default: never)
 * DENIZEN_MAIL_WHO=lucy,abby,_team              npc_keys allowed to send
 * DENIZEN_MAIL_ALLOWLIST=ceo@x.com,@dolonia.cloud
 * DENIZEN_MAIL_CONFIRM_TTL_MS=900000
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CONFIRM_PATH = path.join(__dirname, '..', 'data', 'mail-confirm-tokens.json');
const MAX_TOKENS = 200;

function policyMode() {
  const raw = String(process.env.DENIZEN_MAIL_POLICY || 'never').toLowerCase().trim();
  if (raw === 'confirm' || raw === 'allowlist' || raw === 'never') return raw;
  return 'never';
}

function whoMay() {
  const raw = String(process.env.DENIZEN_MAIL_WHO || 'lucy,abby,_team,visitor');
  return new Set(
    raw.split(/[,\s]+/).map((s) => s.toLowerCase().trim()).filter(Boolean),
  );
}

function allowlist() {
  const raw = String(process.env.DENIZEN_MAIL_ALLOWLIST || '');
  return raw.split(/[,\s]+/).map((s) => s.toLowerCase().trim()).filter(Boolean);
}

function confirmTtlMs() {
  return Math.max(60_000, Number(process.env.DENIZEN_MAIL_CONFIRM_TTL_MS) || 15 * 60 * 1000);
}

function actorAllowed(npcKey) {
  const key = String(npcKey || '').toLowerCase().trim();
  if (!key) return false;
  return whoMay().has(key);
}

function recipientAllowed(to) {
  const addr = String(to || '').toLowerCase().trim();
  if (!addr || !addr.includes('@')) return false;
  const list = allowlist();
  if (!list.length) return false;
  const domain = addr.split('@')[1];
  for (const entry of list) {
    if (entry.startsWith('@') && domain === entry.slice(1)) return true;
    if (entry === addr) return true;
  }
  return false;
}

function _loadTokens() {
  try {
    if (!fs.existsSync(CONFIRM_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONFIRM_PATH, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function _saveTokens(map) {
  try {
    fs.mkdirSync(path.dirname(CONFIRM_PATH), { recursive: true });
    const entries = Object.entries(map).slice(-MAX_TOKENS);
    fs.writeFileSync(CONFIRM_PATH, JSON.stringify(Object.fromEntries(entries), null, 2));
  } catch (_) { /* best-effort */ }
}

function issueConfirmToken(draft) {
  const token = `mcf_${crypto.randomBytes(12).toString('base64url')}`;
  const map = _loadTokens();
  map[token] = {
    ...draft,
    issued_at: Date.now(),
    expires_at: Date.now() + confirmTtlMs(),
  };
  _saveTokens(map);
  return token;
}

function consumeConfirmToken(token) {
  const key = String(token || '').trim();
  if (!key) return { ok: false, error: 'confirm_token required' };
  const map = _loadTokens();
  const row = map[key];
  if (!row) return { ok: false, error: 'confirm_token invalid' };
  delete map[key];
  _saveTokens(map);
  if (Date.now() > Number(row.expires_at || 0)) {
    return { ok: false, error: 'confirm_token expired' };
  }
  return { ok: true, draft: row };
}

/**
 * Gate a send attempt.
 * @returns {{ ok: boolean, needs_confirm?: boolean, confirm_token?: string, error?: string, policy?: string }}
 */
function assertSendAllowed({ npcKey, to, subject, body, confirmToken } = {}) {
  const policy = policyMode();
  if (policy === 'never') {
    return {
      ok: false,
      error: 'mail_policy_never — DENIZEN_MAIL_POLICY=never (draft only)',
      policy,
    };
  }
  if (!actorAllowed(npcKey)) {
    return {
      ok: false,
      error: `mail_who_denied — ${npcKey} not in DENIZEN_MAIL_WHO`,
      policy,
    };
  }
  const toAddr = String(to || '').trim();
  if (!toAddr || !toAddr.includes('@')) {
    return { ok: false, error: 'to email required', policy };
  }

  if (policy === 'allowlist') {
    if (!recipientAllowed(toAddr)) {
      return {
        ok: false,
        error: `mail_allowlist_denied — ${toAddr} not in DENIZEN_MAIL_ALLOWLIST`,
        policy,
      };
    }
    return { ok: true, policy };
  }

  // confirm mode
  if (confirmToken) {
    const consumed = consumeConfirmToken(confirmToken);
    if (!consumed.ok) return { ...consumed, policy };
    const d = consumed.draft;
    if (String(d.to || '').toLowerCase() !== toAddr.toLowerCase()) {
      return { ok: false, error: 'confirm_token to mismatch', policy };
    }
    return { ok: true, policy, confirmed: true, draft: d };
  }

  const token = issueConfirmToken({
    to: toAddr,
    subject: String(subject || '').slice(0, 300),
    body: String(body || '').slice(0, 8000),
    npc_key: npcKey,
  });
  return {
    ok: false,
    needs_confirm: true,
    confirm_token: token,
    policy,
    preview: {
      to: toAddr,
      subject: String(subject || '').slice(0, 120),
      body_preview: String(body || '').slice(0, 240),
    },
    hint: 'Re-call send_draft with the same args + confirm_token to send',
  };
}

function policyStatus() {
  return {
    policy: policyMode(),
    who_may: [...whoMay()],
    allowlist: allowlist(),
    confirm_ttl_ms: confirmTtlMs(),
  };
}

module.exports = {
  policyMode,
  whoMay,
  allowlist,
  actorAllowed,
  recipientAllowed,
  assertSendAllowed,
  issueConfirmToken,
  consumeConfirmToken,
  policyStatus,
};
