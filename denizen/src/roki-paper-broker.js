'use strict';
/**
 * Roki paper broker — fake cash + positions marked to live quotes.
 * Never touches Robinhood place_equity_order.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ACCOUNT_FILE = path.join(ROOT, 'data', 'roki-paper-account.json');
const DEFAULT_CASH = Number(process.env.ROKI_PAPER_CASH || 10000);

function nowIso() {
  return new Date().toISOString();
}

function emptyAccount() {
  return {
    id: 'PAPER-ROKI-1',
    currency: 'USD',
    startingCash: DEFAULT_CASH,
    cash: DEFAULT_CASH,
    positions: {},
    trades: [],
    equityCurve: [{ at: nowIso(), equity: DEFAULT_CASH, cash: DEFAULT_CASH }],
    updatedAt: nowIso(),
    note: 'Paper only — Denizen never places live Robinhood orders from this ledger.',
  };
}

function loadAccount() {
  try {
    const raw = JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf-8'));
    if (!raw || typeof raw !== 'object') return emptyAccount();
    raw.positions = raw.positions && typeof raw.positions === 'object' ? raw.positions : {};
    raw.trades = Array.isArray(raw.trades) ? raw.trades : [];
    raw.equityCurve = Array.isArray(raw.equityCurve) ? raw.equityCurve : [];
    if (!Number.isFinite(Number(raw.cash))) raw.cash = DEFAULT_CASH;
    return raw;
  } catch (_) {
    return emptyAccount();
  }
}

function saveAccount(acct) {
  acct.updatedAt = nowIso();
  fs.mkdirSync(path.dirname(ACCOUNT_FILE), { recursive: true });
  fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(acct, null, 2));
  return acct;
}

function resetAccount(cash = DEFAULT_CASH) {
  const next = emptyAccount();
  next.startingCash = Number(cash) || DEFAULT_CASH;
  next.cash = next.startingCash;
  next.equityCurve = [{ at: nowIso(), equity: next.cash, cash: next.cash }];
  return saveAccount(next);
}

function quoteMap(quotes) {
  const map = {};
  const list = Array.isArray(quotes) ? quotes : (quotes?.quotes || []);
  for (const q of list) {
    const sym = String(q?.symbol || '').toUpperCase();
    const px = Number(q?.price);
    if (sym && Number.isFinite(px) && px > 0) map[sym] = px;
  }
  return map;
}

function markAccount(acct, quotesBySym) {
  const positions = [];
  let positionsValue = 0;
  for (const [symbol, pos] of Object.entries(acct.positions || {})) {
    const qty = Number(pos.qty) || 0;
    if (qty <= 0) continue;
    const avgCost = Number(pos.avgCost) || 0;
    const last = Number(quotesBySym[symbol] || pos.last || avgCost || 0);
    const marketValue = qty * last;
    const costBasis = qty * avgCost;
    const pnl = marketValue - costBasis;
    const pnlPct = costBasis ? (pnl / costBasis) * 100 : 0;
    positionsValue += marketValue;
    positions.push({
      symbol,
      qty: Number(qty.toFixed(6)),
      avgCost: Number(avgCost.toFixed(4)),
      last: Number(last.toFixed(4)),
      marketValue: Number(marketValue.toFixed(2)),
      pnl: Number(pnl.toFixed(2)),
      pnlPct: Number(pnlPct.toFixed(2)),
    });
  }
  positions.sort((a, b) => b.marketValue - a.marketValue);
  const cash = Number(acct.cash) || 0;
  const equity = cash + positionsValue;
  const starting = Number(acct.startingCash) || DEFAULT_CASH;
  return {
    id: acct.id,
    currency: acct.currency || 'USD',
    cash: Number(cash.toFixed(2)),
    startingCash: Number(starting.toFixed(2)),
    positionsValue: Number(positionsValue.toFixed(2)),
    equity: Number(equity.toFixed(2)),
    pnl: Number((equity - starting).toFixed(2)),
    pnlPct: Number((((equity - starting) / starting) * 100).toFixed(2)),
    buyingPower: Number(cash.toFixed(2)),
    positions,
    trades: (acct.trades || []).slice(0, 40),
    equityCurve: (acct.equityCurve || []).slice(-48),
    updatedAt: acct.updatedAt,
    note: acct.note,
  };
}

function pushEquityPoint(acct, equity, cash) {
  const curve = Array.isArray(acct.equityCurve) ? acct.equityCurve : [];
  const last = curve[curve.length - 1];
  const point = { at: nowIso(), equity: Number(equity.toFixed(2)), cash: Number(cash.toFixed(2)) };
  if (last && Math.abs(Number(last.equity) - point.equity) < 0.01) {
    curve[curve.length - 1] = point;
  } else {
    curve.push(point);
  }
  if (curve.length > 120) curve.splice(0, curve.length - 120);
  acct.equityCurve = curve;
}

async function resolvePrice(symbol, robinhoodMcp, explicitPrice) {
  const px = Number(explicitPrice);
  if (Number.isFinite(px) && px > 0) return px;
  if (!robinhoodMcp?.getQuote) throw new Error('No quote source');
  const quotes = await robinhoodMcp.getQuote([symbol]);
  const map = quoteMap(quotes);
  const found = map[symbol];
  if (!Number.isFinite(found) || found <= 0) throw new Error(`No price for ${symbol}`);
  return found;
}

/**
 * Place a paper market order.
 * @param {object} opts
 * @param {'buy'|'sell'} opts.side
 * @param {string} opts.symbol
 * @param {number} [opts.qty]
 * @param {number} [opts.notional] dollars to spend (buy) or approx sell value
 * @param {number} [opts.price]
 * @param {string} [opts.rationale]
 * @param {string} [opts.npc]
 * @param {object} [opts.robinhoodMcp]
 */
async function placeOrder(opts = {}) {
  const symbol = String(opts.symbol || '').trim().toUpperCase();
  const side = String(opts.side || opts.action || '').trim().toLowerCase();
  if (!symbol) throw new Error('symbol required');
  if (side !== 'buy' && side !== 'sell') throw new Error('side must be buy|sell');

  const price = await resolvePrice(symbol, opts.robinhoodMcp, opts.price || opts.currentPrice);
  const acct = loadAccount();
  const pos = acct.positions[symbol] || { qty: 0, avgCost: 0, last: price };

  let qty = Number(opts.qty);
  const notional = Number(opts.notional);
  if ((!Number.isFinite(qty) || qty <= 0) && Number.isFinite(notional) && notional > 0) {
    qty = notional / price;
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    // Default: buy ~$250 or 1 share, whichever is smaller affordably
    if (side === 'buy') {
      const budget = Math.min(250, Math.max(0, acct.cash * 0.15));
      qty = budget / price;
    } else {
      qty = pos.qty;
    }
  }
  qty = Number(qty.toFixed(6));
  if (qty <= 0) throw new Error('quantity too small');

  const gross = qty * price;
  if (side === 'buy') {
    if (gross > acct.cash + 1e-6) throw new Error(`Insufficient paper cash (need $${gross.toFixed(2)}, have $${acct.cash.toFixed(2)})`);
    const newQty = pos.qty + qty;
    const newAvg = newQty > 0 ? ((pos.qty * pos.avgCost) + gross) / newQty : 0;
    acct.cash = Number((acct.cash - gross).toFixed(4));
    acct.positions[symbol] = {
      qty: Number(newQty.toFixed(6)),
      avgCost: Number(newAvg.toFixed(6)),
      last: price,
    };
  } else {
    if (qty > pos.qty + 1e-8) throw new Error(`Insufficient paper shares of ${symbol}`);
    const newQty = pos.qty - qty;
    acct.cash = Number((acct.cash + gross).toFixed(4));
    if (newQty <= 1e-8) delete acct.positions[symbol];
    else {
      acct.positions[symbol] = {
        qty: Number(newQty.toFixed(6)),
        avgCost: pos.avgCost,
        last: price,
      };
    }
  }

  const trade = {
    id: `pt_${Date.now()}_${(Math.random() * 0xffff | 0).toString(16)}`,
    at: nowIso(),
    npc: opts.npc || 'Roki',
    symbol,
    side,
    qty,
    price: Number(price.toFixed(4)),
    notional: Number(gross.toFixed(2)),
    rationale: String(opts.rationale || '').slice(0, 400),
    mode: 'paper',
  };
  acct.trades.unshift(trade);
  if (acct.trades.length > 200) acct.trades.splice(200);

  const marked = markAccount(acct, { [symbol]: price, ...Object.fromEntries(
    Object.entries(acct.positions).map(([s, p]) => [s, p.last || p.avgCost]),
  ) });
  pushEquityPoint(acct, marked.equity, acct.cash);
  saveAccount(acct);
  return { ok: true, trade, account: markAccount(loadAccount(), { [symbol]: price }) };
}

async function getSnapshot(robinhoodMcp) {
  const acct = loadAccount();
  const symbols = Object.keys(acct.positions || {});
  let quotesBySym = {};
  if (symbols.length && robinhoodMcp?.getQuote) {
    try {
      quotesBySym = quoteMap(await robinhoodMcp.getQuote(symbols));
    } catch (_) {}
  }
  for (const [sym, pos] of Object.entries(acct.positions || {})) {
    if (!quotesBySym[sym]) quotesBySym[sym] = pos.last || pos.avgCost;
  }
  const snap = markAccount(acct, quotesBySym);
  // Persist last marks lightly
  for (const p of snap.positions) {
    if (acct.positions[p.symbol]) acct.positions[p.symbol].last = p.last;
  }
  pushEquityPoint(acct, snap.equity, snap.cash);
  saveAccount(acct);
  return markAccount(loadAccount(), quotesBySym);
}

async function placeFromSuggestion(suggestion, robinhoodMcp) {
  const action = String(suggestion?.action || '').toLowerCase();
  if (action !== 'buy' && action !== 'sell') {
    return { ok: false, skipped: true, reason: 'suggestion is not buy/sell' };
  }
  return placeOrder({
    symbol: suggestion.symbol,
    side: action,
    qty: suggestion.quantity || null,
    price: suggestion.currentPrice || null,
    rationale: suggestion.rationale || '',
    npc: suggestion.npc || 'Roki',
    robinhoodMcp,
  });
}

module.exports = {
  ACCOUNT_FILE,
  DEFAULT_CASH,
  loadAccount,
  resetAccount,
  getSnapshot,
  placeOrder,
  placeFromSuggestion,
  markAccount,
};
