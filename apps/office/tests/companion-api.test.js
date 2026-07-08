'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const api = require('../src/denizen-companion-api.js');

describe('denizen-companion-api', () => {
  it('buildSyncUrls returns REST endpoints', () => {
    const urls = api.buildSyncUrls('http://localhost:8080/');
    assert.equal(urls.status, 'http://localhost:8080/api/npc-sync/status');
    assert.equal(urls.memory, 'http://localhost:8080/api/npc-sync/memory');
    assert.equal(urls.activity, 'http://localhost:8080/api/npc-sync/activity');
  });

  it('validateCredentials rejects missing token', () => {
    assert.match(api.validateCredentials({ baseUrl: 'http://x' }), /token/);
    assert.equal(api.validateCredentials(null), 'credentials required');
  });

  it('pushMemory posts body with bearer auth', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ({ ok: true, memory_id: 'm1' }) };
    };
    const creds = { baseUrl: 'http://localhost:8080', token: 'test-token-1234567890' };
    const result = await api.pushMemory(creds, 'Remember sprint deadline', { fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(calls[0].url, 'http://localhost:8080/api/npc-sync/memory');
    assert.equal(calls[0].body.body, 'Remember sprint deadline');
    assert.equal(calls[0].headers.Authorization, 'Bearer test-token-1234567890');
  });

  it('getNpcStatus fetches status with limit', async () => {
    let fetchedUrl = '';
    const fetchImpl = async (url) => {
      fetchedUrl = url;
      return { ok: true, json: async () => ({ ok: true, npc: { npc_key: 'roki' } }) };
    };
    const creds = { baseUrl: 'http://localhost:8080', token: 'test-token-1234567890' };
    const result = await api.getNpcStatus(creds, { limit: 5, fetchImpl });
    assert.match(fetchedUrl, /\/api\/npc-sync\/status\?limit=5/);
    assert.equal(result.npc.npc_key, 'roki');
  });

  it('logActivity posts note', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ ok: true, logged: true }) };
    };
    const creds = { baseUrl: 'http://localhost:8080', token: 'test-token-1234567890' };
    await api.logActivity(creds, 'Reviewed PR', { phase: 'review', fetchImpl });
    assert.equal(calls[0].note, 'Reviewed PR');
    assert.equal(calls[0].phase, 'review');
  });
});
