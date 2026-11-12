'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const healthRunbook = require('../src/health-runbook');

describe('health-runbook', () => {
  it('canRemediate allows DevOps NPCs', () => {
    assert.equal(healthRunbook.canRemediate('Oscar'), true);
    assert.equal(healthRunbook.canRemediate('Bob'), false);
  });

  it('check returns structured report', async () => {
    const report = await healthRunbook.check({
      scope: 'server',
      deps: {},
    });
    assert.ok(report.sections.server);
    assert.ok(Array.isArray(report.issues));
    assert.ok(report.checked_at);
  });

  it('remediate verify returns after report', async () => {
    const result = await healthRunbook.remediate({
      action: 'verify',
      deps: { computeQueue: null },
    });
    assert.ok(result.summary);
    assert.ok(result.report);
  });

  it('verifyPoll completes for healthy server scope', async () => {
    const poll = await healthRunbook.verifyPoll({
      scope: 'server',
      deps: {},
      maxAttempts: 2,
      intervalMs: 1,
    });
    assert.equal(poll.ok, true);
    assert.ok(poll.attempts.length >= 1);
  });

  it('resolveLmStudioUrl prefers remote pool on NAS', () => {
    const prevUrl = process.env.LM_STUDIO_URL;
    const prevRemote = process.env.LM_STUDIO_REMOTE_URLS;
    try {
      delete process.env.LM_STUDIO_URL;
      process.env.LM_STUDIO_REMOTE_URLS = 'http://192.168.50.20:1234';
      assert.equal(healthRunbook.resolveLmStudioUrl(), 'http://192.168.50.20:1234');
    } finally {
      if (prevUrl === undefined) delete process.env.LM_STUDIO_URL;
      else process.env.LM_STUDIO_URL = prevUrl;
      if (prevRemote === undefined) delete process.env.LM_STUDIO_REMOTE_URLS;
      else process.env.LM_STUDIO_REMOTE_URLS = prevRemote;
    }
  });

  it('remediate verify-poll action returns poll metadata', async () => {
    const result = await healthRunbook.remediate({
      action: 'verify-poll',
      deps: { computeQueue: null },
    });
    assert.ok(result.verify_poll);
    assert.ok(result.summary.includes('verify poll'));
  });
});