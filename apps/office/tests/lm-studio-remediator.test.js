'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const lmStudioRemediator = require('../src/integrations/lm-studio-remediator');

describe('lm-studio-remediator', () => {
  it('pollUntilHealthy succeeds when probe reports reachable', async () => {
    let calls = 0;
    const result = await lmStudioRemediator.pollUntilHealthy({
      probeFn: async () => {
        calls += 1;
        return { reachable: calls >= 2, status: 200 };
      },
      maxAttempts: 4,
      intervalMs: 1,
    });
    assert.equal(result.ok, true);
    assert.ok(result.attempts.length >= 2);
  });

  it('pollUntilHealthy fails after max attempts', async () => {
    const result = await lmStudioRemediator.pollUntilHealthy({
      probeFn: async () => ({ reachable: false, error: 'down' }),
      maxAttempts: 3,
      intervalMs: 1,
    });
    assert.equal(result.ok, false);
    assert.equal(result.attempts.length, 3);
  });

  it('restartAndVerify uses custom restart cmd and probeFn', async () => {
    const orig = process.env.LM_STUDIO_RESTART_CMD;
    process.env.LM_STUDIO_RESTART_CMD = process.platform === 'win32' ? 'echo ok' : 'true';
    try {
      const result = await lmStudioRemediator.restartAndVerify({
        probeFn: async () => ({ reachable: true, status: 200 }),
        warmupMs: 1,
        maxAttempts: 2,
        intervalMs: 1,
      });
      assert.equal(result.ok, true);
      assert.match(result.summary, /passed health poll/);
    } finally {
      if (orig === undefined) delete process.env.LM_STUDIO_RESTART_CMD;
      else process.env.LM_STUDIO_RESTART_CMD = orig;
    }
  });
});
