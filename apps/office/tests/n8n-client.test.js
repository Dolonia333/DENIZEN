'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const n8nClient = require('../src/integrations/n8n-client.js');

let mockServer;
let mockBase;
let received;

before(() => new Promise((resolve) => {
  received = [];
  mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({
        method: req.method,
        path: req.url,
        key: req.headers['x-n8n-api-key'] || null,
        body: body ? JSON.parse(body) : null,
      });
      if (req.url.startsWith('/api/v1/workflows') && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'wf-1', name: 'Lucy inbox' }] }));
        return;
      }
      if (req.url === '/api/v1/workflows' && req.method === 'POST') {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'wf-new', name: received.at(-1).body.name }));
        return;
      }
      res.writeHead(404);
      res.end('missing');
    });
  });
  mockServer.listen(0, '127.0.0.1', () => {
    const { port } = mockServer.address();
    mockBase = `http://127.0.0.1:${port}/api/v1`;
    resolve();
  });
}));

after(() => new Promise((r) => mockServer.close(r)));

function testEnv() {
  return { N8N_API_URL: mockBase, N8N_API_KEY: 'test-key' };
}

describe('n8n-client', () => {
  it('isConfigured reflects env', () => {
    assert.equal(n8nClient.isConfigured(testEnv()), true);
    assert.equal(n8nClient.isConfigured({}), false);
  });

  it('listWorkflows sends API key header', async () => {
    received = [];
    const out = await n8nClient.listWorkflows({ env: testEnv(), limit: 5 });
    assert.equal(out.data[0].id, 'wf-1');
    assert.equal(received[0].key, 'test-key');
    assert.match(received[0].path, /^\/api\/v1\/workflows/);
  });

  it('createWorkflow posts workflow body', async () => {
    received = [];
    const created = await n8nClient.createWorkflow({
      name: 'Test flow',
      nodes: [],
      connections: {},
    }, { env: testEnv() });
    assert.equal(created.id, 'wf-new');
    assert.equal(received[0].body.name, 'Test flow');
  });
});
