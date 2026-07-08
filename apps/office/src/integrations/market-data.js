'use strict';
/**
 * Free Market Data — no-key public quote feed for Roki.
 *
 * Why this exists: Robinhood's agentic-trading MCP is waitlisted, so Roki
 * can't pull data through it yet. Quotes are public data anyway, so we
 * decouple them from the brokerage:
 *
 *   - QUOTES        → this module (Yahoo Finance v8, Stooq fallback) — works today
 *   - PORTFOLIO     → Robinhood MCP — activates when access lands (robinhood-mcp.js)
 *   - POSITIONS     → Robinhood MCP — same
 *
 * No API key required. No new dependencies (uses node:https).
 *
 * Normalized quote shape (same regardless of source):
 *   {
 *     symbol, price, previousClose, change, changePercent,
 *     dayHigh, dayLow, currency, name, volume, marketTime, source
 *   }
 */

const https = require('node:https');

const YAHOO_HOST   = 'query1.finance.yahoo.com';
const STOOQ_HOST   = 'stooq.com';
const TIMEOUT_MS   = 8000;
const UA           = 'Mozilla/5.0 (Denizen market watcher)';

// ─── HTTP GET helper ───────────────────────────────────────────────────────────

function httpsGet(hostname, pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, port: 443, path: pathname, method: 'GET',
      headers: { 'User-Agent': UA, 'Accept': '*/*' },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(data);
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// ─── Yahoo Finance v8 chart (primary) ──────────────────────────────────────────

async function quoteYahoo(symbol) {
  const sym = symbol.toUpperCase().trim();
  const raw = await httpsGet(YAHOO_HOST, `/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`);
  const json = JSON.parse(raw);
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) {
    throw new Error(`No Yahoo data for ${sym}`);
  }
  const price = meta.regularMarketPrice;
  const prev  = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const change = prev != null ? price - prev : null;
  const changePercent = (prev != null && prev !== 0) ? (change / prev) * 100 : null;
  return {
    symbol:        sym,
    price:         round2(price),
    previousClose: prev != null ? round2(prev) : null,
    change:        change != null ? round2(change) : null,
    changePercent: changePercent != null ? round2(changePercent) : null,
    dayHigh:       meta.regularMarketDayHigh != null ? round2(meta.regularMarketDayHigh) : null,
    dayLow:        meta.regularMarketDayLow  != null ? round2(meta.regularMarketDayLow)  : null,
    currency:      meta.currency || 'USD',
    name:          meta.longName || meta.shortName || sym,
    volume:        meta.regularMarketVolume ?? null,
    marketTime:    meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    source:        'yahoo',
  };
}

// ─── Stooq CSV (fallback) ───────────────────────────────────────────────────────

async function quoteStooq(symbol) {
  const sym = symbol.toLowerCase().trim();
  // f=sd2t2ohlcv → Symbol, Date, Time, Open, High, Low, Close, Volume
  const raw = await httpsGet(STOOQ_HOST, `/q/l/?s=${encodeURIComponent(sym)}.us&f=sd2t2ohlcv&h&e=csv`);
  const lines = raw.trim().split('\n');
  if (lines.length < 2) throw new Error(`No Stooq data for ${sym}`);
  const cols = lines[1].split(',');
  // [Symbol, Date, Time, Open, High, Low, Close, Volume]
  const open  = parseFloat(cols[3]);
  const high  = parseFloat(cols[4]);
  const low   = parseFloat(cols[5]);
  const close = parseFloat(cols[6]);
  const vol   = parseInt(cols[7], 10);
  if (!Number.isFinite(close)) throw new Error(`Stooq returned N/D for ${sym}`);
  // Stooq has no previous-close in this call — approximate the day's move
  // from open→close so Roki still has a changePercent to talk about.
  const change = Number.isFinite(open) ? close - open : null;
  const changePercent = (Number.isFinite(open) && open !== 0) ? (change / open) * 100 : null;
  return {
    symbol:        symbol.toUpperCase().trim(),
    price:         round2(close),
    previousClose: Number.isFinite(open) ? round2(open) : null, // approximation
    change:        change != null ? round2(change) : null,
    changePercent: changePercent != null ? round2(changePercent) : null,
    dayHigh:       Number.isFinite(high) ? round2(high) : null,
    dayLow:        Number.isFinite(low)  ? round2(low)  : null,
    currency:      'USD',
    name:          symbol.toUpperCase().trim(),
    volume:        Number.isFinite(vol) ? vol : null,
    marketTime:    `${cols[1]}T${cols[2]}Z`,
    source:        'stooq',
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Get one quote, trying Yahoo first then Stooq.
 * @returns {object} normalized quote, or { symbol, error, source:null } on total failure
 */
async function getQuote(symbol) {
  try {
    return await quoteYahoo(symbol);
  } catch (e1) {
    try {
      return await quoteStooq(symbol);
    } catch (e2) {
      return { symbol: symbol.toUpperCase().trim(), price: null, error: `${e1.message} / ${e2.message}`, source: null };
    }
  }
}

/**
 * Get quotes for many symbols in parallel.
 * @param {string[]} symbols
 * @returns {object[]} normalized quotes (failed ones include an `error` field)
 */
async function getQuotes(symbols) {
  const syms = Array.isArray(symbols) ? symbols : [symbols];
  return Promise.all(syms.map(s => getQuote(s)));
}

function round2(n) { return Math.round(n * 100) / 100; }

module.exports = { getQuote, getQuotes };
