'use strict';

/**
 * Denizen A+ P1.2 — Skill contracts for top Jelly skills.
 *
 * Each contract: id, input_schema, timeout_ms, cooldown_ms, preferred_tier,
 * output_shape, inject_template. Validation is lightweight (JSON-schema-ish).
 * Metrics: in-memory + optional append to data/skill-metrics.jsonl.
 */

const fs = require('node:fs');
const path = require('node:path');

const TIERS = new Set(['fast', 'main', 'heavy']);

/** @type {Record<string, object>} */
const CONTRACTS = {
  research: {
    id: 'research',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        topic: { type: 'string', minLength: 1 },
        q: { type: 'string', minLength: 1 },
        count: { type: 'integer', minimum: 1, maximum: 20 },
        read: { type: 'integer', minimum: 0, maximum: 10 },
        backend: { type: 'string', enum: ['brave', 'browser', 'mesh', 'auto'] },
      },
      anyOf: [
        { required: ['query'] },
        { required: ['topic'] },
        { required: ['q'] },
      ],
    },
    timeout_ms: 60_000,
    cooldown_ms: 5_000,
    preferred_tier: 'main',
    output_shape: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        output: { type: 'string' },
        sources: { type: 'array' },
      },
    },
    inject_template: '[RESEARCH] {{query}}: {{output}}',
  },

  github: {
    id: 'github',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'pr-list', 'run-list', 'issue-list',
            'skill-search', 'search-skills', 'search-repos',
          ],
        },
        repo: { type: 'string' },
        query: { type: 'string' },
        task: { type: 'string' },
        q: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
    timeout_ms: 30_000,
    cooldown_ms: 3_000,
    preferred_tier: 'fast',
    output_shape: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        output: { type: 'string' },
      },
    },
    inject_template: '[GITHUB {{action}}] {{output}}',
  },

  'coding-agent': {
    id: 'coding-agent',
    input_schema: {
      type: 'object',
      properties: {
        task: { type: 'string', minLength: 1 },
        targetFiles: { type: 'array', items: { type: 'string' } },
        files: { type: 'array', items: { type: 'string' } },
      },
      required: ['task'],
    },
    timeout_ms: 600_000,
    cooldown_ms: 15_000,
    preferred_tier: 'heavy',
    output_shape: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        output: { type: 'string' },
      },
    },
    inject_template: '[CODING] {{task}}: {{output}}',
  },

  'denizen-data': {
    id: 'denizen-data',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        orgId: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        query: { type: 'string' },
      },
    },
    timeout_ms: 45_000,
    cooldown_ms: 2_000,
    preferred_tier: 'fast',
    output_shape: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        output: { type: 'string' },
        data: { type: 'object' },
      },
    },
    inject_template: '[DATA {{action}}] {{output}}',
  },

  'consult-grok': {
    id: 'consult-grok',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', minLength: 3 },
        query: { type: 'string', minLength: 3 },
        topic: { type: 'string' },
        context: { type: 'string' },
        source: { type: 'string' },
      },
      anyOf: [
        { required: ['question'] },
        { required: ['query'] },
      ],
    },
    timeout_ms: 15_000,
    cooldown_ms: 10_000,
    preferred_tier: 'main',
    output_shape: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        output: { type: 'string' },
        pending: { type: 'boolean' },
      },
    },
    inject_template: '[CONSULT-GROK {{topic}}] {{question}} → {{output}}',
  },

  'market-watch': {
    id: 'market-watch',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['observe', 'get-quote', 'quote'] },
        symbols: {
          type: 'array',
          items: { type: 'string' },
        },
        symbol: { type: 'string' },
      },
    },
    timeout_ms: 30_000,
    cooldown_ms: 5_000,
    preferred_tier: 'fast',
    output_shape: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        output: { type: 'string' },
      },
    },
    inject_template: '[MARKET] {{output}}',
  },

  'job-pipeline': {
    id: 'job-pipeline',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        q: { type: 'string' },
        site: { type: 'string' },
        pages: { type: 'integer', minimum: 1, maximum: 10 },
        remoteOnly: { type: 'boolean' },
        minSalary: { type: 'number', minimum: 0 },
      },
    },
    timeout_ms: 300_000,
    cooldown_ms: 30_000,
    preferred_tier: 'main',
    output_shape: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        output: { type: 'string' },
      },
    },
    inject_template: '[JOBS {{query}}] {{output}}',
  },

  browserclaw: {
    id: 'browserclaw',
    input_schema: {
      type: 'object',
      properties: {
        task: { type: 'string', minLength: 1 },
        query: { type: 'string', minLength: 1 },
        q: { type: 'string', minLength: 1 },
        url: { type: 'string', minLength: 1 },
        mode: { type: 'string', enum: ['visible', 'background'] },
      },
      anyOf: [
        { required: ['task'] },
        { required: ['query'] },
        { required: ['q'] },
        { required: ['url'] },
      ],
    },
    timeout_ms: 120_000,
    cooldown_ms: 8_000,
    preferred_tier: 'main',
    output_shape: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        output: { type: 'string' },
      },
    },
    inject_template: '[BROWSER] {{task}}: {{output}}',
  },

  'health-check': {
    id: 'health-check',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        scope: { type: 'string' },
      },
    },
    timeout_ms: 45_000,
    cooldown_ms: 10_000,
    preferred_tier: 'fast',
    output_shape: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        output: { type: 'string' },
        report: { type: 'object' },
      },
    },
    inject_template: '[HEALTH {{scope}}] {{output}}',
  },

  remediate: {
    id: 'remediate',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'verify',
            'drain-mesh-queue',
            'clear-stale-jobs',
            'reclaim-stale',
            'restart-lm-studio',
            'lm-studio-restart',
          ],
        },
      },
    },
    timeout_ms: 60_000,
    cooldown_ms: 15_000,
    preferred_tier: 'fast',
    output_shape: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        output: { type: 'string' },
      },
    },
    inject_template: '[REMEDIATE {{action}}] {{output}}',
  },
};

// ── validation helpers ──────────────────────────────────────────────

function _typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function _matchesType(value, type) {
  if (type == null) return true;
  const t = _typeOf(value);
  if (type === 'integer') return t === 'number' && Number.isInteger(value);
  if (type === 'number') return t === 'number' && Number.isFinite(value);
  return t === type;
}

/**
 * Validate value against a JSON-schema-ish node. Collects path-prefixed errors.
 * @param {*} value
 * @param {object} schema
 * @param {string} path
 * @param {string[]} errors
 */
function _validateNode(value, schema, path, errors) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.type && !_matchesType(value, schema.type)) {
    errors.push(`${path || 'args'}: expected ${schema.type}, got ${_typeOf(value)}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path || 'args'}: must be one of [${schema.enum.join(', ')}]`);
  }

  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) {
      errors.push(`${path || 'args'}: minLength ${schema.minLength}`);
    }
    if (schema.maxLength != null && value.length > schema.maxLength) {
      errors.push(`${path || 'args'}: maxLength ${schema.maxLength}`);
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum != null && value < schema.minimum) {
      errors.push(`${path || 'args'}: minimum ${schema.minimum}`);
    }
    if (schema.maximum != null && value > schema.maximum) {
      errors.push(`${path || 'args'}: maximum ${schema.maximum}`);
    }
  }

  if (schema.type === 'object' || (value && typeof value === 'object' && !Array.isArray(value))) {
    const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (obj[key] === undefined || obj[key] === null || obj[key] === '') {
        errors.push(`${path ? path + '.' : ''}${key}: required`);
      }
    }
    if (schema.properties && typeof schema.properties === 'object') {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (obj[key] === undefined) continue;
        _validateNode(obj[key], propSchema, path ? `${path}.${key}` : key, errors);
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => {
      _validateNode(item, schema.items, `${path || 'args'}[${i}]`, errors);
    });
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length) {
    const anyOk = schema.anyOf.some((branch) => {
      const branchErrors = [];
      _validateNode(value, branch, path, branchErrors);
      return branchErrors.length === 0;
    });
    if (!anyOk) {
      const keys = schema.anyOf
        .flatMap((b) => (Array.isArray(b.required) ? b.required : []))
        .filter(Boolean);
      const uniq = [...new Set(keys)];
      errors.push(
        `${path || 'args'}: requires one of ${uniq.length ? uniq.join('|') : 'anyOf branches'}`,
      );
    }
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    let matchCount = 0;
    for (const branch of schema.oneOf) {
      const branchErrors = [];
      _validateNode(value, branch, path, branchErrors);
      if (branchErrors.length === 0) matchCount += 1;
    }
    if (matchCount !== 1) {
      errors.push(`${path || 'args'}: must match exactly one of oneOf (${matchCount} matched)`);
    }
  }
}

/**
 * Normalize common aliases so skills receive consistent args.
 */
function _normalizeArgs(skillId, args) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {};
  const id = String(skillId || '').toLowerCase();

  if (id === 'research') {
    if (!a.query) a.query = a.topic || a.q || '';
    if (a.count != null) a.count = Number(a.count);
    if (a.read != null) a.read = Number(a.read);
  }
  if (id === 'consult-grok') {
    if (!a.question) a.question = a.query || '';
    if (!a.topic) a.topic = 'general';
  }
  if (id === 'browserclaw') {
    if (!a.task) a.task = a.query || a.q || (a.url ? `Open ${a.url}` : '');
  }
  if (id === 'job-pipeline') {
    if (!a.query) a.query = a.q || '';
    if (a.pages != null) a.pages = Number(a.pages);
    if (a.minSalary != null) a.minSalary = Number(a.minSalary);
    if (a['remote-only'] != null && a.remoteOnly == null) {
      a.remoteOnly = Boolean(a['remote-only']);
    }
  }
  if (id === 'market-watch') {
    if (!a.symbols && a.symbol) a.symbols = [String(a.symbol)];
    if (a.action === 'quote') a.action = 'get-quote';
  }
  if (id === 'coding-agent') {
    if (!a.task && (a.query || a.q)) a.task = a.query || a.q;
    if (!Array.isArray(a.targetFiles) && Array.isArray(a.files)) {
      a.targetFiles = a.files;
    }
  }
  if (id === 'health-check') {
    if (!a.action && a.scope) a.action = a.scope;
    if (!a.scope && a.action) a.scope = a.action;
  }
  if (id === 'github') {
    if (a.limit != null) a.limit = Number(a.limit);
  }
  if (id === 'denizen-data') {
    if (a.limit != null) a.limit = Number(a.limit);
  }

  return a;
}

/**
 * @param {string|object} skill — skill id or contract object
 * @param {object} args
 * @returns {{ ok: boolean, errors: string[], normalized: object }}
 */
function validateSkillArgs(skill, args) {
  const id = typeof skill === 'string'
    ? skill
    : (skill?.id || skill?.name || '');
  const contract = typeof skill === 'object' && skill?.input_schema
    ? skill
    : getContract(id);

  const normalized = _normalizeArgs(id, args);
  if (!contract) {
    // Unknown skill: pass-through (no contract = no gate).
    return { ok: true, errors: [], normalized };
  }

  const errors = [];
  _validateNode(normalized, contract.input_schema || {}, '', errors);

  // Preferred tier sanity (contract self-check only; does not fail args).
  if (contract.preferred_tier && !TIERS.has(contract.preferred_tier)) {
    // ignore — config issue, not caller args
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized,
  };
}

function getContract(skill) {
  const id = String(skill || '').toLowerCase().trim();
  if (!id) return null;
  const c = CONTRACTS[id];
  return c ? { ...c } : null;
}

function listContracts() {
  return Object.keys(CONTRACTS)
    .sort()
    .map((id) => getContract(id));
}

function hasContract(skill) {
  return !!getContract(skill);
}

// ── metrics ─────────────────────────────────────────────────────────

/** @type {Map<string, { success: number, fail: number, invalid: number, lastMs: number|null, lastAt: string|null, lastOk: boolean|null }>} */
const _metrics = new Map();
/** @type {Map<string, number>} skillId → last start ts (cooldown) */
const _lastStart = new Map();

let _metricsPath = null;
let _persistEnabled = true;

function setMetricsPath(p) {
  _metricsPath = p || null;
}

function setPersistEnabled(on) {
  _persistEnabled = on !== false;
}

function _ensureMetric(skillId) {
  const id = String(skillId || 'unknown');
  if (!_metrics.has(id)) {
    _metrics.set(id, {
      success: 0,
      fail: 0,
      invalid: 0,
      lastMs: null,
      lastAt: null,
      lastOk: null,
    });
  }
  return _metrics.get(id);
}

function _appendMetric(rec) {
  if (!_persistEnabled) return;
  try {
    const file = _metricsPath
      || path.join(__dirname, '..', 'data', 'skill-metrics.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(
      file,
      `${JSON.stringify({ at: new Date().toISOString(), ...rec })}\n`,
      'utf8',
    );
  } catch (_) {
    // metrics must never break skill execution
  }
}

/**
 * Record a skill outcome.
 * @param {string} skill
 * @param {'success'|'fail'|'invalid'} outcome
 * @param {object} [extra]
 */
function recordSkillOutcome(skill, outcome, extra = {}) {
  const id = String(skill || 'unknown');
  const m = _ensureMetric(id);
  if (outcome === 'success') m.success += 1;
  else if (outcome === 'invalid') m.invalid += 1;
  else m.fail += 1;
  m.lastAt = new Date().toISOString();
  m.lastOk = outcome === 'success';
  if (extra.durationMs != null) m.lastMs = Number(extra.durationMs);
  _appendMetric({
    skill: id,
    outcome,
    npc: extra.npc || null,
    durationMs: extra.durationMs ?? null,
    error: extra.error ? String(extra.error).slice(0, 240) : null,
  });
  return { ...m };
}

/**
 * Cooldown gate for a skill. Returns { ok, waitMs }.
 */
function checkCooldown(skill, now = Date.now()) {
  const contract = getContract(skill);
  if (!contract?.cooldown_ms) return { ok: true, waitMs: 0 };
  const id = contract.id;
  const last = _lastStart.get(id) || 0;
  const waitMs = contract.cooldown_ms - (now - last);
  if (waitMs > 0) return { ok: false, waitMs };
  return { ok: true, waitMs: 0 };
}

function markSkillStart(skill, now = Date.now()) {
  const id = String(skill || '').toLowerCase() || 'unknown';
  _lastStart.set(id, now);
}

function getSkillMetrics(skill) {
  if (skill) {
    const m = _metrics.get(String(skill));
    return m ? { ...m } : { success: 0, fail: 0, invalid: 0, lastMs: null, lastAt: null, lastOk: null };
  }
  const out = {};
  for (const [k, v] of _metrics.entries()) out[k] = { ...v };
  // ensure contract skills appear even with zeros
  for (const id of Object.keys(CONTRACTS)) {
    if (!out[id]) {
      out[id] = { success: 0, fail: 0, invalid: 0, lastMs: null, lastAt: null, lastOk: null };
    }
  }
  return out;
}

function resetSkillMetrics() {
  _metrics.clear();
  _lastStart.clear();
}

function metricsSummary() {
  const bySkill = getSkillMetrics();
  let success = 0;
  let fail = 0;
  let invalid = 0;
  for (const m of Object.values(bySkill)) {
    success += m.success || 0;
    fail += m.fail || 0;
    invalid += m.invalid || 0;
  }
  const total = success + fail + invalid;
  return {
    contracts: Object.keys(CONTRACTS).length,
    totalRuns: success + fail,
    success,
    fail,
    invalid,
    successRate: total > 0 ? Number((success / (success + fail || 1)).toFixed(4)) : null,
    bySkill,
  };
}

module.exports = {
  CONTRACTS,
  validateSkillArgs,
  getContract,
  listContracts,
  hasContract,
  recordSkillOutcome,
  checkCooldown,
  markSkillStart,
  getSkillMetrics,
  resetSkillMetrics,
  metricsSummary,
  setMetricsPath,
  setPersistEnabled,
};
