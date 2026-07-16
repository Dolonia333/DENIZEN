'use strict';

/**
 * Denizen Harness status() A+ observability surface.
 * Pure unit tests — no GPU / LM Studio required.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { createDenizenHarness } = require('../src/denizen-harness');

const ROOT = path.join(__dirname, '..');

describe('createDenizenHarness().status()', () => {
  let prevStats;

  before(() => {
    prevStats = globalThis._npcStats;
    globalThis._npcStats = {
      providerOk: 10,
      harnessComplete: 9,
      streamParity: 2,
      thinkThrottled: 1,
      providerFail: 0,
      lastHarnessModel: 'qwen/qwen3.6-27b',
      lastHarnessTier: 'main',
    };
  });

  after(() => {
    if (prevStats === undefined) delete globalThis._npcStats;
    else globalThis._npcStats = prevStats;
  });

  it('returns ok:true and expected A+ keys', async () => {
    const h = createDenizenHarness({
      denizenRoot: ROOT,
      jelly: { listSkills: () => [{ id: 'research' }] },
      npcBrains: {
        brains: { Abby: {}, Bob: {} },
        getQueueDepth: () => 0,
      },
      cofounderAgent: {
        buildDirectorHealth() {
          return { offline: false, demoLoop: false, consecutiveErrors: 0 };
        },
      },
    });

    const s = await h.status();

    assert.equal(s.ok, true);
    assert.ok(s.version, 'top-level version from config.meta');
    assert.equal(typeof s.version, 'string');
    assert.ok(s.harness);
    assert.equal(s.harness.version, s.version);

    assert.ok(s.metrics, 'metrics present');
    assert.equal(typeof s.metrics.providerOk, 'number');
    assert.equal(typeof s.metrics.harnessComplete, 'number');
    assert.equal(typeof s.metrics.streamParity, 'number');
    assert.ok('harnessRate' in s.metrics);
    assert.ok('mainModelUnloaded' in s.metrics);
    assert.ok('npcTierRules' in s.metrics);
    assert.equal(s.metrics.lastHarnessModel, 'qwen/qwen3.6-27b');
    assert.equal(s.metrics.lastHarnessTier, 'main');
    assert.equal(s.metrics.providerOk, 10);
    assert.equal(s.metrics.harnessComplete, 9);
    assert.equal(s.metrics.harnessRate, 0.9);

    // skillContracts: number when module exists, else null
    assert.ok('skillContracts' in s);
    assert.ok(s.skillContracts === null || typeof s.skillContracts === 'number');

    assert.ok(s.dailyPlan);
    assert.equal(typeof s.dailyPlan.present, 'boolean');
    assert.match(String(s.dailyPlan.path).replace(/\\/g, '/'), /data\/daily-plan\.json$/);
    assert.equal(
      s.dailyPlan.present,
      fs.existsSync(path.join(ROOT, 'data', 'daily-plan.json')),
    );

    assert.ok(s.director);
    assert.equal(s.director.offline, false);
    assert.equal(s.director.demoLoop, false);
    assert.equal(s.director.consecutiveErrors, 0);

    assert.ok(s.bound);
    assert.equal(s.bound.jelly, true);
    assert.equal(s.bound.npcBrains, true);
    assert.equal(s.bound.cofounder, true);
    assert.equal(s.bound.inference, true);

    assert.ok(s.inference);
    assert.ok('reachable' in s.inference);
    // A+ skills block: contracts + registry + metrics (object, not bare count)
    assert.ok(s.skills && typeof s.skills === 'object');
    assert.equal(typeof s.skills.count, 'number');
    assert.ok(s.skills.contracts >= 0);
    assert.equal(s.npcCount, 2);
    assert.ok(s.at);
  });

  it('director is null when cofounder unbound', async () => {
    const h = createDenizenHarness({ denizenRoot: ROOT });
    const s = await h.status();
    assert.equal(s.ok, true);
    assert.equal(s.director, null);
    assert.equal(s.bound.cofounder, false);
  });

  it('lastHarnessModel/Tier null when stats unset', async () => {
    const saved = globalThis._npcStats;
    globalThis._npcStats = {};
    try {
      const h = createDenizenHarness({ denizenRoot: ROOT });
      const s = await h.status();
      assert.equal(s.metrics.lastHarnessModel, null);
      assert.equal(s.metrics.lastHarnessTier, null);
      assert.equal(s.metrics.harnessRate, null);
    } finally {
      globalThis._npcStats = saved;
    }
  });
});
