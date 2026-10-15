'use strict';

/**
 * High-impact action gates (A+ P2.2 / trust).
 *
 * Email send, code apply, trade execute, deploy-like skills must not run
 * silently without approval when org policy requires it (default: yes).
 *
 * Fail-safe: consumers should try/catch require(); missing module must not
 * hard-crash skill execution.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_APPROVALS_PATH = path.join(ROOT, 'data', 'impact-approvals.json');
const MAX_ROWS = 100;

/** Skills that are always low-risk read/research — never blocked by this gate. */
const SAFE_SKILLS = new Set([
  'research',
  'web-search',
  'github',
  'health-check',
  'consult-grok',
  'consult-mentors',
  'market-watch',
  'denizen-data',
  'trend-scraper',
  'grok-telemetry-optimizer',
  'lucy-search',
  'memory-retrieve',
  'office-status',
  'work-history',
]);

/** Skill names that are high-impact by nature when acting (not merely drafting). */
const HIGH_SKILL_RE = /^(?:send-email|email-send|crm-send-email|send_draft|send-draft|deploy|cms-publish|platform-publish|job-applier)$/i;

/** Param keys that indicate a side-effecting action when truthy. */
const HIGH_PARAM_KEYS = [
  'execute',
  'send',
  'apply',
  'deploy',
  'push',
  'placeOrder',
  'place_order',
  'autoSend',
  'auto_send',
  'sendEmail',
  'send_email',
  'liveTrade',
  'live_trade',
  'merge',
  'forcePush',
  'force_push',
];

let _approvalsPath = DEFAULT_APPROVALS_PATH;

function setApprovalsPath(filePath) {
  _approvalsPath = filePath
    ? path.resolve(String(filePath))
    : DEFAULT_APPROVALS_PATH;
}

function getApprovalsPath() {
  return _approvalsPath;
}

function _newId() {
  try {
    if (typeof crypto.randomUUID === 'function') {
      return `ia_${crypto.randomUUID()}`;
    }
  } catch (_) { /* fall through */ }
  return `ia_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function _truthy(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'on';
  }
  return false;
}

function _safeParams(params) {
  if (!params || typeof params !== 'object') return {};
  const out = {};
  const keys = Object.keys(params).slice(0, 40);
  for (const k of keys) {
    if (k === 'password' || k === 'token' || k === 'apiKey' || k === 'api_key' || k === 'secret') {
      out[k] = '[redacted]';
      continue;
    }
    const v = params[k];
    if (v == null) {
      out[k] = v;
    } else if (typeof v === 'string') {
      out[k] = v.length > 500 ? `${v.slice(0, 500)}…` : v;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 20).map((x) => (typeof x === 'string' ? x.slice(0, 120) : x));
    } else if (typeof v === 'object') {
      try {
        out[k] = JSON.parse(JSON.stringify(v).slice(0, 800));
      } catch (_) {
        out[k] = '[object]';
      }
    } else {
      out[k] = String(v).slice(0, 200);
    }
  }
  return out;
}

function _normalizeSkill(skill) {
  return String(skill || '').trim().toLowerCase();
}

/**
 * Classify impact of a skill invocation.
 * @returns {{ level: 'low'|'medium'|'high', reason: string }}
 */
function classifyImpact(skill, params = {}) {
  const name = _normalizeSkill(skill);
  const p = params && typeof params === 'object' ? params : {};

  if (!name) {
    return { level: 'low', reason: 'empty_skill' };
  }

  // Safe read/research skills stay low unless clearly side-effecting via high param flags.
  // Even then we treat pure research/github as low so they are never blocked.
  if (SAFE_SKILLS.has(name)) {
    return { level: 'low', reason: `safe_skill:${name}` };
  }

  // Explicit high param flags
  for (const key of HIGH_PARAM_KEYS) {
    if (_truthy(p[key])) {
      return { level: 'high', reason: `param:${key}=true` };
    }
  }

  // Nested action flags sometimes used by agents
  if (p.action && typeof p.action === 'string') {
    const act = p.action.trim().toLowerCase();
    if (['execute', 'send', 'apply', 'deploy', 'push', 'merge', 'place_order', 'place-order'].includes(act)) {
      return { level: 'high', reason: `action:${act}` };
    }
  }

  if (name === 'trade-live') {
    return { level: 'high', reason: 'live_robinhood_order' };
  }

  // trade-suggest: execute / placeOrder already covered; paper buy/sell is medium
  if (name === 'trade-suggest') {
    if (_truthy(p.execute) || _truthy(p.placeOrder) || _truthy(p.place_order) || _truthy(p.liveTrade)) {
      return { level: 'high', reason: 'trade_execute' };
    }
    const action = String(p.tradeAction || p.action || 'watch').toLowerCase();
    if (action === 'buy' || action === 'sell') {
      return { level: 'medium', reason: 'trade_suggest_paper' };
    }
    return { level: 'low', reason: 'trade_suggest_watch' };
  }

  // coding-agent: apply:true is high; bare task proposal is medium
  if (name === 'coding-agent') {
    if (_truthy(p.apply) || _truthy(p.merge) || _truthy(p.deploy)) {
      return { level: 'high', reason: 'coding_agent_apply' };
    }
    return { level: 'medium', reason: 'coding_agent_worktree' };
  }

  // Email-related skills
  if (/email|gmail|smtp|resend/.test(name)) {
    if (
      _truthy(p.send)
      || _truthy(p.autoSend)
      || _truthy(p.auto_send)
      || _truthy(p.sendEmail)
      || _truthy(p.send_email)
      || /send/.test(name)
    ) {
      return { level: 'high', reason: 'email_send' };
    }
    return { level: 'medium', reason: 'email_draft_or_triage' };
  }

  // Deploy / publish skills by name
  if (HIGH_SKILL_RE.test(name) || /deploy|publish|push-prod|force-push/.test(name)) {
    return { level: 'high', reason: `skill:${name}` };
  }

  // docker / cloud vm create-like
  if (name === 'docker-sandbox' || name === 'cloud-vm') {
    const act = String(p.action || p.op || '').toLowerCase();
    if (['create', 'run', 'start', 'destroy', 'delete', 'exec'].includes(act) || _truthy(p.execute)) {
      return { level: 'high', reason: `${name}_${act || 'execute'}` };
    }
    return { level: 'medium', reason: name };
  }

  // job pipeline apply
  if (name === 'job-pipeline' || name === 'job-applier') {
    if (_truthy(p.apply) || _truthy(p.submit) || _truthy(p.execute) || String(p.action || '').toLowerCase() === 'apply') {
      return { level: 'high', reason: 'job_apply' };
    }
    return { level: 'medium', reason: 'job_pipeline' };
  }

  return { level: 'low', reason: 'default_low' };
}

/**
 * Whether this invocation needs human approval before running.
 * Does NOT check approved / _approvedByHuman — caller must pass those after resolve.
 *
 * @param {string} skill
 * @param {object} [params]
 * @param {object} [policy] — org policy; high impact gated unless require_high_impact_approval === false
 * @returns {boolean}
 */
function requiresApproval(skill, params = {}, policy = null) {
  const name = _normalizeSkill(skill);
  if (SAFE_SKILLS.has(name)) return false;

  const impact = classifyImpact(skill, params);
  if (impact.level !== 'high') return false;

  // Default fail-safe: require approval for high impact.
  if (policy && typeof policy === 'object') {
    if (policy.require_high_impact_approval === false) return false;
    if (policy.allow_silent_high_impact === true) return false;
    // Demo / sandboxed orgs still should not silent-fire high impact if allow_real_work is false
    // — keep gate on (return true). Only explicit opt-outs above skip.
  }
  return true;
}

function _loadRows() {
  try {
    const raw = fs.readFileSync(_approvalsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.approvals)) return parsed.approvals;
    return [];
  } catch (_) {
    return [];
  }
}

function _saveRows(rows) {
  const dir = path.dirname(_approvalsPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) { /* exists */ }
  const capped = Array.isArray(rows) ? rows.slice(0, MAX_ROWS) : [];
  fs.writeFileSync(_approvalsPath, `${JSON.stringify(capped, null, 2)}\n`, 'utf8');
  return capped;
}

/**
 * Create a pending high-impact approval row.
 * @param {{ npc?: string, skill: string, params?: object, reason?: string }} opts
 * @returns {object} pending row
 */
function createPendingApproval(opts = {}) {
  const impact = classifyImpact(opts.skill, opts.params);
  const row = {
    id: _newId(),
    npc: String(opts.npc || opts.npcName || '').trim() || null,
    skill: _normalizeSkill(opts.skill) || String(opts.skill || ''),
    params: _safeParams(opts.params),
    reason: String(opts.reason || impact.reason || 'high_impact'),
    level: impact.level,
    status: 'pending',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    approved: null,
  };

  const rows = _loadRows();
  rows.unshift(row);
  _saveRows(rows);
  return row;
}

/**
 * List pending (or all) impact approvals.
 * @param {{ status?: string }} [filter]
 * @returns {object[]}
 */
function listPending(filter = {}) {
  const rows = _loadRows();
  const status = filter.status != null ? String(filter.status) : 'pending';
  if (status === 'all' || status === '*') return rows.slice();
  return rows.filter((r) => r && r.status === status);
}

/**
 * Resolve an approval by id.
 * @param {string} id
 * @param {{ approved: boolean, note?: string, resolvedBy?: string }} decision
 * @returns {{ ok: boolean, row?: object, error?: string }}
 */
function resolveApproval(id, decision = {}) {
  const key = String(id || '').trim();
  if (!key) return { ok: false, error: 'id_required' };

  const rows = _loadRows();
  const idx = rows.findIndex((r) => r && r.id === key);
  if (idx === -1) return { ok: false, error: 'not_found' };

  const approved = decision.approved === true
    || decision.approved === 'true'
    || decision.decision === 'approved';
  const rejected = decision.approved === false
    || decision.decision === 'rejected'
    || decision.decision === 'denied';

  if (!approved && !rejected && decision.approved == null && !decision.decision) {
    return { ok: false, error: 'approved_bool_required' };
  }

  const row = { ...rows[idx] };
  row.status = approved ? 'approved' : 'rejected';
  row.approved = !!approved;
  row.resolvedAt = new Date().toISOString();
  if (decision.note) row.note = String(decision.note).slice(0, 400);
  if (decision.resolvedBy) row.resolvedBy = String(decision.resolvedBy).slice(0, 120);
  rows[idx] = row;
  _saveRows(rows);
  return { ok: true, row };
}

/**
 * Gate helper for executors: if approval required and not pre-approved, create pending + deny.
 * @returns {null | { ok: false, error: 'approval_required', approvalId: string, reason: string, level: string, output: string }}
 */
function isGrokLiveTrade(npc, skill) {
  const who = String(npc || '').toLowerCase();
  return _normalizeSkill(skill) === 'trade-live' && (who === 'grok' || who === 'xp_grok');
}

function gateSkillRun(npc, skill, params = {}, policy = null) {
  const p = params && typeof params === 'object' ? params : {};
  if (p.approved === true || p._approvedByHuman === true) return null;
  // The connected agentic Robinhood account is the authorization for Grok.
  if (isGrokLiveTrade(npc, skill)) return null;
  if (!requiresApproval(skill, p, policy)) return null;

  const impact = classifyImpact(skill, p);
  const pending = createPendingApproval({
    npc,
    skill,
    params: p,
    reason: impact.reason,
  });
  return {
    ok: false,
    error: 'approval_required',
    approvalId: pending.id,
    reason: impact.reason,
    level: impact.level,
    output: `Approval required for high-impact skill "${skill}" (${impact.reason}). approvalId=${pending.id}`,
    skill: _normalizeSkill(skill) || skill,
    npcName: npc,
  };
}

module.exports = {
  SAFE_SKILLS,
  HIGH_PARAM_KEYS,
  classifyImpact,
  requiresApproval,
  createPendingApproval,
  listPending,
  resolveApproval,
  gateSkillRun,
  setApprovalsPath,
  getApprovalsPath,
  MAX_ROWS,
};
