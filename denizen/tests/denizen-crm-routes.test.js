'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { mountCrmRoutes } = require('../src/denizen-crm-routes');

function mockReadJsonBody(body) {
  return async () => body;
}

describe('denizen-crm-routes', () => {
  it('POST /api/crm/assist is registered', async () => {
    const handler = mountCrmRoutes({
      verifyVisitorSession: async () => ({
        orgId: 'org-test',
        orgSlug: 'zion',
        session: { org_id: 'org-test', identity_id: 'id1' },
      }),
      readJsonBody: mockReadJsonBody({
        session_id: 'sess-1',
        message: 'hi',
        state: { contacts: [], deals: [], tasks: [] },
      }),
      npcBrains: null,
      broadcastToOffice: null,
    });

    const server = http.createServer(async (req, res) => {
      await handler(req, res);
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/crm/assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: 'sess-1', message: 'hi', state: {} }),
      });
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.ok, true);
      assert.ok(data.reply);
    } finally {
      server.close();
    }
  });

  it('GET /api/crm/health lists assist route', async () => {
    const handler = mountCrmRoutes({
      verifyVisitorSession: async () => ({}),
      readJsonBody: mockReadJsonBody({}),
      npcBrains: null,
      broadcastToOffice: null,
    });
    const server = http.createServer(async (req, res) => {
      await handler(req, res);
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/crm/health`);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.ok(data.routes.some((r) => r.includes('/api/crm/assist')));
    } finally {
      server.close();
    }
  });
});
