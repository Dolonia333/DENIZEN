'use strict';
/**
 * denizen-sam-gov.js — SAM.gov Opportunities API client (federal RFP feed).
 *
 * Pulls live federal contract opportunities and normalizes them into a clean,
 * CRM-ready shape. This is the transport + normalization layer only; the server
 * routes in server.js decide what to do with the results (return / ingest).
 *
 * Auth: SAM_GOV_API_KEY (env). Never hardcode the key. api.sam.gov takes the
 * key as the `api_key` query param — this module keeps it out of any log line.
 *
 * Defaults are tuned for 1921 Holding Co. / Dolonia Data Tech Solutions
 * (WOSB + HUBZone certified small business, IT / cyber / gov-modernization):
 *   set-asides WOSB, EDWOSB, HZC — override with SAM_GOV_SETASIDE.
 *   no NAICS filter by default    — set SAM_GOV_NAICS once codes are confirmed.
 */

const BASE = 'https://api.sam.gov/opportunities/v2/search';

// SAM.gov notice types (ptype): o=Solicitation p=Presolicitation
// k=Combined Synopsis/Solicitation r=Sources Sought g=Sale i=ITB a=Award s=Special.
// We watch the ones a bidder acts on, not award/sale notices.
const DEFAULT_PTYPE = 'o,p,k,r';
const DEFAULT_SETASIDE = 'WOSB,EDWOSB,HZC';
const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;      // api.sam.gov hard-caps a page at 1000; we stay modest

function hasKey() {
  return Boolean((process.env.SAM_GOV_API_KEY || '').trim());
}

/** MM/dd/yyyy — the only date format api.sam.gov accepts. */
function fmtDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function csvEnv(name, fallback) {
  const v = (process.env[name] || '').trim();
  return v || fallback;
}

/** Collapse a raw opportunity into the fields the CRM actually needs. */
function normalizeOpportunity(o) {
  const poc = Array.isArray(o.pointOfContact)
    ? (o.pointOfContact.find((p) => p && p.type === 'primary') || o.pointOfContact[0])
    : null;
  const pop = o.placeOfPerformance || {};
  const naics = o.naicsCode
    || (Array.isArray(o.naicsCodes) ? o.naicsCodes[0] : null)
    || null;
  return {
    noticeId: o.noticeId || null,                 // stable dedup key
    title: (o.title || '').trim(),
    solicitationNumber: o.solicitationNumber || null,
    agency: o.fullParentPathName || null,
    noticeType: o.type || o.baseType || null,
    setAside: o.typeOfSetAside || null,
    setAsideLabel: o.typeOfSetAsideDescription || null,
    naicsCode: naics,
    classificationCode: o.classificationCode || null,
    postedDate: o.postedDate || null,
    responseDeadline: o.responseDeadLine || null,  // note SAM's capital 'L'
    archiveDate: o.archiveDate || null,
    active: String(o.active || '').toLowerCase() === 'yes',
    contactName: poc && poc.fullName ? poc.fullName : (poc && poc.title) || null,
    contactEmail: poc && poc.email ? poc.email : null,
    placeOfPerformance: [pop.city && pop.city.name, pop.state && (pop.state.name || pop.state.code)]
      .filter(Boolean).join(', ') || null,
    descriptionUrl: o.description || null,         // a URL, not the text itself
    samUrl: o.uiLink || null,                      // human-viewable sam.gov page
    resourceLinks: Array.isArray(o.resourceLinks) ? o.resourceLinks : [],
    raw: o,                                         // keep the original for the fact spine
  };
}

function csvList(v) {
  return String(v == null ? '' : v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Run tasks with bounded concurrency (gentle on the api.data.gov rate limit). */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/** One SAM.gov query (single set-aside, single NAICS). */
async function _singleSearch({ from, to, limit, offset, naics, setAside, ptype, q, signal }) {
  const params = new URLSearchParams();
  params.set('api_key', process.env.SAM_GOV_API_KEY.trim());
  params.set('postedFrom', from);
  params.set('postedTo', to);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (naics) params.set('ncode', String(naics));
  if (setAside) params.set('typeOfSetAside', String(setAside));
  if (ptype) params.set('ptype', String(ptype));
  if (q) params.set('title', String(q));

  let res;
  try {
    res = await fetch(`${BASE}?${params.toString()}`, {
      method: 'GET', headers: { Accept: 'application/json' }, signal,
    });
  } catch (netErr) {
    const err = new Error(`SAM.gov request failed: ${netErr.message}`);
    err.code = 'SAM_NETWORK';
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const safe = body.replace(/api_key=[^&\s"]+/gi, 'api_key=REDACTED').slice(0, 300);
    const err = new Error(`SAM.gov returned ${res.status}: ${safe}`);
    err.code = res.status === 401 || res.status === 403 ? 'SAM_AUTH' : 'SAM_HTTP';
    err.status = res.status;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  return {
    total: Number(data.totalRecords) || 0,
    list: Array.isArray(data.opportunitiesData) ? data.opportunitiesData : [],
  };
}

const MAX_COMBOS = 24;   // set-aside × NAICS fan-out cap

/**
 * Search SAM.gov opportunities.
 *
 * `typeOfSetAside` and `ncode` are SINGLE-value on the SAM API (a comma list or
 * repeated param returns zero), so multiple set-asides/NAICS fan out into one
 * request each and the results are merged + deduped by noticeId. `ptype` does
 * take a comma list, so it stays a single param.
 *
 * @param {object} opts
 *   naics    CSV of NAICS codes  (default env SAM_GOV_NAICS, else none)
 *   setAside CSV of set-aside codes (default env SAM_GOV_SETASIDE, else WOSB,EDWOSB,HZC)
 *   ptype    CSV of notice types (default o,p,k,r)
 *   days     lookback window (default 7; SAM requires a bounded window)
 *   q        free-text title match (optional)
 *   limit    page size PER sub-query (default 25, max 100)
 *   signal   optional AbortSignal
 * @returns {Promise<{total, count, window, queries, truncatedCombos, opportunities}>}
 */
async function searchOpportunities(opts = {}) {
  if (!hasKey()) {
    const err = new Error('SAM_GOV_API_KEY is not set');
    err.code = 'NO_SAM_KEY';
    throw err;
  }
  const days = Math.max(1, Math.min(365, Number(opts.days) || DEFAULT_DAYS));
  const toD = new Date();
  const fromD = new Date(toD.getTime() - days * 24 * 60 * 60 * 1000);
  const from = fmtDate(fromD);
  const to = fmtDate(toD);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(opts.limit) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(opts.offset) || 0);
  const ptype = opts.ptype != null ? opts.ptype : csvEnv('SAM_GOV_PTYPE', DEFAULT_PTYPE);

  // '' (explicit) means "no filter"; undefined falls back to the env default.
  const setAsides = csvList(opts.setAside != null ? opts.setAside : csvEnv('SAM_GOV_SETASIDE', DEFAULT_SETASIDE));
  const naicsList = csvList(opts.naics != null ? opts.naics : csvEnv('SAM_GOV_NAICS', ''));
  const saAxis = setAsides.length ? setAsides : [''];
  const ncAxis = naicsList.length ? naicsList : [''];

  let combos = [];
  for (const s of saAxis) for (const n of ncAxis) combos.push({ setAside: s, naics: n });
  const truncatedCombos = Math.max(0, combos.length - MAX_COMBOS);
  if (truncatedCombos) combos = combos.slice(0, MAX_COMBOS);

  // Isolate each combo: a single failing sub-query (e.g. one SAM 429) must not
  // discard every other combo's results. Collect errors so a total wipeout is
  // still visible, and only throw if EVERY combo failed (a real auth/outage).
  const subErrors = [];
  const results = await mapLimit(combos, 4, async (c) => {
    try {
      return await _singleSearch({
        from, to, limit, offset, ptype, q: opts.q, signal: opts.signal,
        setAside: c.setAside, naics: c.naics,
      });
    } catch (err) {
      subErrors.push({ setAside: c.setAside, naics: c.naics, code: err.code, status: err.status });
      return { total: 0, list: [] };
    }
  });
  if (subErrors.length && subErrors.length === combos.length) {
    // Every sub-query failed — surface it instead of returning a silent count:0.
    const e0 = subErrors[0];
    const err = new Error(`SAM.gov: all ${combos.length} sub-queries failed (${e0.code || e0.status || 'error'})`);
    err.code = e0.code || 'SAM_HTTP';
    err.status = e0.status;
    throw err;
  }

  const byId = new Map();
  let total = 0;
  for (const r of results) {
    total += r.total;
    for (const o of r.list) {
      const id = o.noticeId || `${o.solicitationNumber}|${o.title}`;
      if (!byId.has(id)) byId.set(id, normalizeOpportunity(o));
    }
  }
  let opportunities = [...byId.values()];

  // activeOnly (default true): drop opportunities SAM marks inactive or whose
  // response deadline has already passed. A missing deadline (e.g. sources
  // sought) is kept — it's still an open signal.
  const activeOnly = opts.activeOnly !== false;
  let droppedInactive = 0;
  if (activeOnly) {
    const now = Date.now();
    opportunities = opportunities.filter((o) => {
      if (o.active === false) { droppedInactive += 1; return false; }
      if (o.responseDeadline) {
        const t = Date.parse(o.responseDeadline);
        if (Number.isFinite(t) && t < now) { droppedInactive += 1; return false; }
      }
      return true;
    });
  }

  return {
    total,                        // summed across sub-queries (combos are ~disjoint)
    count: opportunities.length,  // deduped, after activeOnly
    window: { from, to },
    queries: combos.length,
    failedQueries: subErrors.length,   // >0 means partial results
    truncatedCombos,
    droppedInactive,
    opportunities,
  };
}

module.exports = {
  hasKey,
  searchOpportunities,
  normalizeOpportunity,
  DEFAULT_SETASIDE,
  DEFAULT_PTYPE,
};
