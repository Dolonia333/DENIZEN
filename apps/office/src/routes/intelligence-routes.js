'use strict';

const { URL } = require('node:url');

const mirofish = require('../intelligence/mirofish-prediction');
const predictionLoop = require('../intelligence/denizen-prediction-loop');

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function createIntelligenceRouteHandler(deps = {}) {
  const denizenDb = deps.denizenDb || null;

  return async function handleIntelligenceRoutes(req, res) {
    const reqUrl = req.url || '/';
    const url = new URL(reqUrl, 'http://localhost');
    const path = url.pathname;
    const method = req.method || 'GET';

    if (method === 'GET' && path === '/api/intelligence/mirofish-status') {
      const cfg = mirofish.getConfig();
      const available = await mirofish.isAvailable();
      sendJson(res, 200, {
        ok: true,
        enabled: cfg.enabled,
        baseUrl: cfg.baseUrl,
        available,
      });
      return true;
    }

    if (method === 'POST' && path === '/api/intelligence/mirofish-sync') {
      if (!denizenDb?.enabled || !denizenDb?.orgId) {
        sendJson(res, 503, { ok: false, error: 'Intelligence layer unavailable' });
        return true;
      }
      const result = await predictionLoop.runMiroFishMaintenance(denizenDb);
      sendJson(res, 200, { ok: true, result });
      return true;
    }

    return false;
  };
}

module.exports = {
  createIntelligenceRouteHandler,
};
