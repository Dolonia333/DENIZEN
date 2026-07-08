'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { DenizenDb } = require('../src/intelligence/denizen-db');

describe('bouncer runs db writes', () => {
  it('recordBouncerRun posts normalized run shape', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      if (String(url).includes('/denizen_bouncer_runs')) {
        calls.push({ url: String(url), body: JSON.parse(opts.body || '{}') });
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => [] };
      }
      return { ok: false, status: 404, text: async () => 'not found' };
    };

    const db = new DenizenDb({
      env: {
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_ANON_KEY: 'test-key',
      },
    });
    db.enabled = true;

    db.recordBouncerRun({
      threatCategory: 'network_scan',
      source: '192.168.1.20',
      ok: true,
      reportPath: 'reports/security/report.md',
      elapsed: 321.8,
      verdict: 'clear',
      metadata: { probe: 'nmap' },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(calls.length, 1);
    const row = calls[0].body;
    assert.equal(row.threat_category, 'network_scan');
    assert.equal(row.source, '192.168.1.20');
    assert.equal(row.ok, true);
    assert.equal(row.report_path, 'reports/security/report.md');
    assert.equal(row.elapsed_ms, 322);
    assert.equal(row.verdict, 'clear');
    assert.deepEqual(row.metadata, { probe: 'nmap' });
    assert.equal(typeof row.at, 'string');

    delete global.fetch;
  });
});
