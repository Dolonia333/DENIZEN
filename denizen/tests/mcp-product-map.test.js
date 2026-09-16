'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const map = require('../src/denizen-mcp-product-map.js');
const teamGateway = require('../src/denizen-mcp-team-gateway.js');

describe('MCP product map for ChatGPT connectors', () => {
  it('describes CRM, Studio Board, Business Studio, and Agency', () => {
    const ids = map.SURFACES.map((s) => s.id);
    assert.deepEqual(ids.sort(), ['agency', 'business_studio', 'crm', 'studio_board'].sort());
    const json = map.productMapJson();
    assert.equal(json.ok, true);
    assert.match(json.pitch, /office/i);
    assert.ok(json.playbook.some((p) => /working_set/i.test(p)));
  });

  it('exposes initialize instructions and docs://product-map resources', () => {
    const text = map.mcpInitializeInstructions({ mode: 'team' });
    assert.match(text, /CRM/);
    assert.match(text, /Studio Board/);
    assert.match(text, /Business Studio/);
    assert.match(text, /docs:\/\/product-map/);
    const gpt = map.chatgptProductInstructions({ npcLabel: 'Abby' });
    assert.match(gpt, /evidence/i);
    assert.match(gpt, /crm_write/);
    assert.ok(map.readProductResource('docs://product-map'));
    assert.match(map.readProductResource('docs://product-map.md'), /## Surfaces/);
  });

  it('registers product resources on the team gateway', () => {
    const uris = teamGateway.TEAM_RESOURCES.map((r) => r.uri);
    assert.ok(uris.includes('docs://product-map'));
    assert.ok(uris.includes('docs://product-map.md'));
    const info = teamGateway.buildConnectInfo('https://denizen.example');
    assert.match(info.instructions, /Business Studio/);
    assert.equal(info.product_map.ok, true);
  });
});
