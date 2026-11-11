'use strict';

/**
 * Shared MCP response helpers — empty states, pagination, dry-run, soft size caps.
 * Keeps connector-friendly payloads under gateway truncation (~20k chars).
 */

const SOFT_CHAR_BUDGET = Number(process.env.DENIZEN_MCP_SOFT_CHAR_BUDGET || 18_000);

function isDryRun(args = {}) {
  return args?.dry_run === true || args?.validate_only === true || args?.dryRun === true;
}

function dryRunResult({ tool, plan = null, missing = [], args = null } = {}) {
  if (missing.length) {
    return {
      ok: false,
      dry_run: true,
      error: 'validation_failed',
      missing,
      message: `Dry-run validation failed — missing or invalid: ${missing.join(', ')}`,
      tool: tool || null,
    };
  }
  return {
    ok: true,
    dry_run: true,
    tool: tool || null,
    would_execute: tool || null,
    plan: plan || null,
    args_echo: args
      ? Object.fromEntries(
        Object.entries(args).filter(([k]) => !/dry_run|validate_only|dryRun/i.test(k)),
      )
      : null,
    message: 'No changes committed (dry_run / validate_only). Re-call without dry_run to execute.',
  };
}

/**
 * Healthy empty list — agents must not treat ok:true + [] as broken.
 */
function emptyHealthy({ kind, create_with, extra = {} } = {}) {
  const label = String(kind || 'records');
  return {
    empty: true,
    empty_state: 'healthy',
    message: create_with
      ? `No ${label} yet — create one with ${create_with}`
      : `No ${label} yet — empty workspace is OK`,
    create_with: create_with || null,
    ...extra,
  };
}

function parsePage(args = {}, { defaultLimit = 25, maxLimit = 100 } = {}) {
  const offset = Math.max(0, Number(args.offset) || 0);
  let limit = Number(args.limit);
  if (!Number.isFinite(limit) || limit <= 0) limit = defaultLimit;
  limit = Math.min(maxLimit, Math.max(1, Math.floor(limit)));
  return { offset, limit };
}

function paginate(items, args = {}, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const { offset, limit } = parsePage(args, opts);
  const page = list.slice(offset, offset + limit);
  const total = list.length;
  const next_offset = offset + page.length < total ? offset + page.length : null;
  return {
    items: page,
    total,
    offset,
    limit,
    next_offset,
    has_more: next_offset != null,
  };
}

function modeOf(args = {}, fallback = 'summary') {
  const raw = String(args.mode || args.format || '').toLowerCase().trim();
  if (raw === 'full' || raw === 'details' || raw === 'detail') return 'full';
  if (raw === 'names' || raw === 'names_only' || raw === 'name') return 'names';
  if (raw === 'summary' || raw === 'brief') return 'summary';
  return fallback;
}

function jsonSize(value) {
  try {
    return JSON.stringify(value).length;
  } catch (_) {
    return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * If payload exceeds soft budget, attach truncation metadata and drop bulky keys.
 */
function softCap(payload, {
  budget = SOFT_CHAR_BUDGET,
  dropKeys = [],
  hint = 'Response truncated for connector size limits — re-call with mode=full + offset/limit, or request a specific section.',
} = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  const size = jsonSize(payload);
  if (size <= budget) return payload;
  const out = { ...payload, truncated: true, original_chars: size, truncation_hint: hint };
  for (const key of dropKeys) {
    if (key in out) delete out[key];
  }
  // Second pass: if still huge, replace large arrays with counts.
  if (jsonSize(out) > budget) {
    for (const [k, v] of Object.entries(out)) {
      if (Array.isArray(v) && v.length > 5) {
        out[k] = v.slice(0, 5);
        out[`${k}_omitted`] = v.length - 5;
      }
    }
  }
  return out;
}

function withEmptyList(result, {
  itemsKey = 'items',
  kind,
  create_with,
} = {}) {
  if (!result || result.ok === false) return result;
  const items = result[itemsKey];
  if (!Array.isArray(items) || items.length > 0) {
    return { ...result, empty: false, empty_state: items?.length ? 'populated' : result.empty_state };
  }
  return {
    ...result,
    ...emptyHealthy({ kind, create_with }),
    [itemsKey]: [],
    count: result.count ?? 0,
  };
}

module.exports = {
  SOFT_CHAR_BUDGET,
  isDryRun,
  dryRunResult,
  emptyHealthy,
  parsePage,
  paginate,
  modeOf,
  jsonSize,
  softCap,
  withEmptyList,
};
