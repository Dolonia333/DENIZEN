#!/usr/bin/env node
'use strict';
/**
 * Lightweight Kali investigation agent for dolonia (.232).
 * NAS sets BOUNCER_INVESTIGATION_URL=http://192.168.1.232:8890
 *
 *   node scripts/bouncer-investigation-agent.js
 *
 * Env: BOUNCER_INVESTIGATION_PORT (8890), BOUNCER_INVESTIGATION_TOKEN (optional)
 */

const http = require('node:http');
const linuxAgent = require('../src/linux-agent');
const bouncerInvestigation = require('../src/bouncer-investigation');

const PORT = parseInt(process.env.BOUNCER_INVESTIGATION_PORT, 10) || 8890;

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (!bouncerInvestigation.validateInvestigationAuth(req)) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, agent: 'bouncer-investigation', wsl: bouncerInvestigation.canRunLocalWsl() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/bouncer-investigate') {
    try {
      const payload = await readBody(req);
      const threat = payload.threat || payload;
      const result = await linuxAgent.investigate(threat);
      let reportMd = null;
      if (result.ok) {
        reportMd = linuxAgent.buildReport(threat, result, null);
        result.reportMd = reportMd;
      }
      sendJson(res, 200, { ok: result.ok, result, reportMd });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err?.message || String(err) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/bouncer-patrol') {
    try {
      const patrol = await linuxAgent.perimeterPatrol();
      sendJson(res, 200, { ok: patrol.ok !== false, patrol });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err?.message || String(err) });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[BouncerInvestigationAgent] listening on http://0.0.0.0:${PORT}`);
  console.log(`[BouncerInvestigationAgent] WSL/Kali: ${bouncerInvestigation.canRunLocalWsl() ? 'yes' : 'no'}`);
});
