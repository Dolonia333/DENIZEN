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

/**
 * Search SAM.gov opportunities.
 * @param {object} opts
 *   naics    CSV of NAICS codes  (default env SAM_GOV_NAICS, else none)
 *   setAside CSV of set-aside codes (default env SAM_GOV_SETASIDE, else WOSB,EDWOSB,HZC)
 *   ptype    CSV of notice types (default o,p,k,r)
 *   days     lookback window in days (default 7; SAM requires a bounded window)
 *   q        free-text title match (optional)
 *   limit    page size (default 25, max 100)
 *   offset   page offset (default 0)
 *   signal   optional AbortSignal
 * @returns {Promise<{total:number, count:number, opportunities:Array, window:{from,to}}>}
 */
async function searchOpportunities(opts = {}) {
  if (!hasKey()) {
    const err = new Error('SAM_GOV_API_KEY is not set');
    err.code = 'NO_SAM_KEY';
    throw err;
  }
  const days = Math.max(1, Math.min(365, Number(opts.days) || DEFAULT_DAYS));
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(opts.limit) || DEFAULT_LIMIT));

  const params = new URLSearchParams();
  params.set('api_key', process.env.SAM_GOV_API_KEY.trim());
  params.set('postedFrom', fmtDate(from));
  params.set('postedTo', fmtDate(to));
  params.set('limit', String(limit));
  params.set('offset', String(Math.max(0, Number(opts.offset) || 0)));

  const naics = opts.naics != null ? opts.naics : csvEnv('SAM_GOV_NAICS', '');
  const setAside = opts.setAside != null ? opts.setAside : csvEnv('SAM_GOV_SETASIDE', DEFAULT_SETASIDE);
  const ptype = opts.ptype != null ? opts.ptype : csvEnv('SAM_GOV_PTYPE', DEFAULT_PTYPE);
  if (naics) params.set('ncode', String(naics));
  if (setAside) params.set('typeOfSetAside', String(setAside));
  if (ptype) params.set('ptype', String(ptype));
  if (opts.q) params.set('title', String(opts.q));

  let res;
  try {
    res = await fetch(`${BASE}?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: opts.signal,
    });
  } catch (netErr) {
    // Never let a SAM outage take down a request; surface a typed error.
    const err = new Error(`SAM.gov request failed: ${netErr.message}`);
    err.code = 'SAM_NETWORK';
    throw err;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Redact the key if the API happens to echo the query back in an error.
    const safe = body.replace(/api_key=[^&\s"]+/gi, 'api_key=REDACTED').slice(0, 300);
    const err = new Error(`SAM.gov returned ${res.status}: ${safe}`);
    err.code = res.status === 401 || res.status === 403 ? 'SAM_AUTH' : 'SAM_HTTP';
    err.status = res.status;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  const list = Array.isArray(data.opportunitiesData) ? data.opportunitiesData : [];
  return {
    total: Number(data.totalRecords) || 0,
    count: list.length,
    window: { from: fmtDate(from), to: fmtDate(to) },
    opportunities: list.map(normalizeOpportunity),
  };
}

module.exports = {
  hasKey,
  searchOpportunities,
  normalizeOpportunity,
  DEFAULT_SETASIDE,
  DEFAULT_PTYPE,
};
