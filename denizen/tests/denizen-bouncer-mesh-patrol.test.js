'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { runNodePatrol } = require('../src/denizen-bouncer-mesh-patrol');

describe('denizen-bouncer-mesh-patrol', () => {
  it('probes mock node tcp and health endpoints', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    try {
      const result = await runNodePatrol({
        node_id: 'test-node',
        host: '127.0.0.1',
        ports: [address.port],
        health_url: `http://127.0.0.1:${address.port}/health`,
        timeout_ms: 1500,
      });

      assert.equal(result.nodeId, 'test-node');
      assert.equal(result.ok, true);
      assert.equal(Array.isArray(result.openPorts), true);
      assert.equal(result.openPorts.length, 1);
      assert.equal(result.openPorts[0].port, String(address.port));
      assert.equal(result.health?.ok, true);
      assert.match(result.summary, /Mesh node patrol test-node/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('fails cleanly when host is missing', async () => {
    const result = await runNodePatrol({ node_id: 'missing-host' });
    assert.equal(result.ok, false);
    assert.equal(result.nodeId, 'missing-host');
    assert.equal(result.openPorts.length, 0);
  });
});
