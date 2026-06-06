'use strict';

const { URL } = require('node:url');

function safeRequire(modulePath) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(modulePath);
  } catch (_) {
    return null;
  }
}

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function getPredictionHandler(deps) {
  const predictionRoutes = safeRequire('./prediction-routes');
  if (predictionRoutes) {
    if (typeof predictionRoutes.handlePredictionSummary === 'function') {
      return predictionRoutes.handlePredictionSummary;
    }
    if (typeof predictionRoutes === 'function') {
      return predictionRoutes;
    }
    if (typeof predictionRoutes.registerPredictionRoutes === 'function') {
      const bag = {};
      predictionRoutes.registerPredictionRoutes(bag, deps);
      if (typeof bag.handlePredictionSummary === 'function') {
        return bag.handlePredictionSummary;
      }
    }
  }

  const predictionLoop = safeRequire('./denizen-prediction-loop');
  if (typeof deps.getPredictionSummary === 'function') return deps.getPredictionSummary;
  if (typeof predictionLoop?.getPredictionSummary === 'function') {
    const db = deps.denizenDb || safeRequire('./denizen-db');
    return async () => predictionLoop.getPredictionSummary(db?.orgId, db, { topForecasts: 5 });
  }
  return null;
}

function getFederalSummaryProvider(deps) {
  const mod = safeRequire('./federal-pipeline');
  if (typeof deps.getFederalPipelineSummary === 'function') return deps.getFederalPipelineSummary;
  if (!mod) return null;
  const fn = mod.getRfpPipelineSummary || mod.getPipelineSummary || mod.pipelineSummary;
  if (typeof fn !== 'function') return null;
  const db = deps.denizenDb || safeRequire('./denizen-db');
  return async () => fn(db);
}

function createDenizenRouteHandler(deps = {}) {
  const robinhoodMcp = deps.robinhoodMcp || safeRequire('./robinhood-mcp');
  const jobCrm = deps.jobCrm || safeRequire('./job-crm');
  const getPredictionSummary = getPredictionHandler(deps);
  const getFederalPipelineSummary = getFederalSummaryProvider(deps);

  return async function handleDenizenRoutes(req, res) {
    const reqUrl = req.url || '/';
    const url = new URL(reqUrl, 'http://localhost');
    const path = url.pathname;
    const method = req.method || 'GET';

    if (method === 'GET' && path === '/api/intelligence/prediction-summary') {
      if (!getPredictionSummary) {
        sendJson(res, 200, {
          ok: true,
          source: 'route-registry-fallback',
          summary: [],
          note: 'prediction-routes.js not available yet',
          at: new Date().toISOString(),
        });
        return true;
      }
      const summary = await getPredictionSummary({ req, res, url, deps });
      if (!res.writableEnded) sendJson(res, 200, summary || { ok: true, summary: [] });
      return true;
    }

    if (method === 'GET' && path === '/api/market/quote') {
      if (!robinhoodMcp?.getQuote) {
        sendJson(res, 503, { ok: false, error: 'robinhood-mcp unavailable' });
        return true;
      }
      const symbols = String(url.searchParams.get('symbols') || 'NVDA')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      const quotes = await robinhoodMcp.getQuote(symbols);
      sendJson(res, 200, { ok: true, symbols, quotes });
      return true;
    }

    if (method === 'POST' && path === '/api/market/trade') {
      if (!robinhoodMcp?.createSuggestion) {
        sendJson(res, 503, { ok: false, error: 'robinhood-mcp unavailable' });
        return true;
      }
      const body = await readJsonBody(req);
      const suggestion = robinhoodMcp.createSuggestion(body || {});
      sendJson(res, 200, { ok: true, suggestion });
      return true;
    }

    if (path === '/api/market/watchlist' && method === 'GET') {
      if (!robinhoodMcp?.loadWatchlist) {
        sendJson(res, 503, { ok: false, error: 'robinhood-mcp unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, watchlist: robinhoodMcp.loadWatchlist() });
      return true;
    }

    if (path === '/api/market/watchlist' && method === 'POST') {
      if (!robinhoodMcp?.addToWatchlist) {
        sendJson(res, 503, { ok: false, error: 'robinhood-mcp unavailable' });
        return true;
      }
      const body = await readJsonBody(req);
      const symbol = String(body.symbol || '').trim();
      if (!symbol) {
        sendJson(res, 400, { ok: false, error: 'symbol is required' });
        return true;
      }
      const watchlist = robinhoodMcp.addToWatchlist(symbol);
      sendJson(res, 200, { ok: true, watchlist });
      return true;
    }

    if (method === 'GET' && path === '/api/federal/pipeline-summary') {
      if (!getFederalPipelineSummary) {
        sendJson(res, 200, {
          ok: true,
          source: 'route-registry-fallback',
          summary: [],
          note: 'federal-pipeline.js not available yet',
          at: new Date().toISOString(),
        });
        return true;
      }
      const summary = await getFederalPipelineSummary({ req, res, url, deps });
      sendJson(res, 200, summary || { ok: true, summary: [] });
      return true;
    }

    if (method === 'POST' && path === '/api/job-crm/maintenance') {
      if (!jobCrm?.runMaintenance) {
        sendJson(res, 503, { ok: false, error: 'job-crm unavailable' });
        return true;
      }
      const result = await jobCrm.runMaintenance({
        npcBrains: deps.npcBrains,
        broadcast: deps.broadcast,
      });
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }

    return false;
  };
}

function registerDenizenRoutes(httpServer, deps = {}) {
  const handle = createDenizenRouteHandler(deps);

  if (httpServer && typeof httpServer.prependListener === 'function') {
    httpServer.prependListener('request', (req, res) => {
      Promise.resolve(handle(req, res)).catch((err) => {
        sendJson(res, 500, { ok: false, error: err.message || String(err) });
      });
    });
  }

  return { handle };
}

module.exports = {
  createDenizenRouteHandler,
  registerDenizenRoutes,
};
