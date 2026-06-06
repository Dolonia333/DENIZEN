'use strict';

const robinhoodMcp = require('../src/robinhood-mcp');
const denizenDb = require('../src/denizen-db');

const baseUrl = String(process.env.DENIZEN_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 10000);

async function requestJson(method, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function flushDbQueue() {
  if (typeof denizenDb._drain !== 'function') return;
  for (let i = 0; i < 20; i += 1) {
    await denizenDb._drain();
    if (!denizenDb._draining && (!Array.isArray(denizenDb._queue) || denizenDb._queue.length === 0)) break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

function printReportAndExit(report, exitCode) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(exitCode);
}

async function main() {
  const report = {
    ok: false,
    baseUrl,
    at: new Date().toISOString(),
    checks: [],
  };

  let authStatus;
  try {
    authStatus = await requestJson('GET', '/api/market/auth-status');
    report.checks.push({
      name: 'auth_status_endpoint',
      ok: authStatus.ok,
      status: authStatus.status,
      authenticated: Boolean(authStatus.data?.authenticated),
    });
  } catch (err) {
    report.checks.push({
      name: 'auth_status_endpoint',
      ok: false,
      error: err?.message || String(err),
    });
    report.error = 'auth-status request failed';
    return printReportAndExit(report, 1);
  }

  const envTokenSet = Boolean(process.env.ROBINHOOD_API_TOKEN);
  const authenticated = Boolean(authStatus?.data?.authenticated) || envTokenSet;
  report.auth = {
    authenticatedViaApi: Boolean(authStatus?.data?.authenticated),
    envTokenSet,
    clientId: authStatus?.data?.clientId || null,
  };

  if (!authenticated) {
    const connectUrl = robinhoodMcp.getAuthConnectUrl(baseUrl);
    report.ok = true;
    report.instructions = [
      'Robinhood is not authenticated yet.',
      `Open this URL in a browser to connect OAuth: ${connectUrl}`,
      'After approving OAuth, rerun: node scripts/robinhood-live-smoke.js',
    ];
    report.oauthConnectUrl = connectUrl;
    return printReportAndExit(report, 0);
  }

  const seeded = await robinhoodMcp.seedDefaultWatchlistInDbIfEmpty({ npcKey: 'roki' }).catch((err) => ({
    ok: false,
    seeded: false,
    reason: err?.message || String(err),
  }));
  report.checks.push({
    name: 'seed_default_watchlist_if_empty',
    ok: Boolean(seeded?.ok),
    detail: seeded,
  });

  const watchlistRes = await requestJson('POST', '/api/market/watchlist', { action: 'add', symbol: 'NVDA' });
  const watchlistBody = watchlistRes.data || {};
  const watchlistSymbols = Array.isArray(watchlistBody.symbols)
    ? watchlistBody.symbols
    : (Array.isArray(watchlistBody.watchlist) ? watchlistBody.watchlist : []);
  const watchlistOk = watchlistRes.ok && watchlistSymbols.includes('NVDA');
  report.checks.push({
    name: 'watchlist_add_nvda',
    ok: watchlistOk,
    status: watchlistRes.status,
    symbolsCount: watchlistSymbols.length,
  });

  const marker = `smoke:${Date.now().toString(36)}`;
  const suggestion = robinhoodMcp.createSuggestion({
    npc: 'Roki',
    symbol: 'NVDA',
    action: 'watch',
    rationale: `Live smoke test suggestion ${marker}`,
  });
  await flushDbQueue();

  const dbInit = await denizenDb.init();
  const dbReady = Boolean(dbInit?.ok && denizenDb.orgId);
  report.checks.push({
    name: 'denizen_db_init',
    ok: dbReady,
    detail: dbInit,
  });

  let foundInDb = false;
  let queried = 0;
  if (dbReady) {
    await flushDbQueue();
    const rows = await denizenDb.listTradeSuggestions({ npcKey: 'roki', status: 'pending', limit: 100 });
    queried = Array.isArray(rows) ? rows.length : 0;
    foundInDb = rows.some((row) => row.symbol === 'NVDA' && String(row.rationale || '').includes(marker));
  }
  report.checks.push({
    name: 'suggestion_row_in_supabase',
    ok: foundInDb,
    queriedRows: queried,
    suggestionId: suggestion.id,
    marker,
  });

  report.ok = report.checks.every((check) => check.ok);
  if (!report.ok) {
    report.error = 'one or more live smoke checks failed';
    return printReportAndExit(report, 1);
  }
  return printReportAndExit(report, 0);
}

main().catch((err) => {
  printReportAndExit({
    ok: false,
    at: new Date().toISOString(),
    error: err?.stack || err?.message || String(err),
  }, 1);
});
