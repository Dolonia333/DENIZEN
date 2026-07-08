'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const meshScaleAdvisor = require('../src/compute/mesh-scale-advisor');

describe('mesh-scale-advisor', () => {
  let origAutoHeal;

  beforeEach(() => {
    origAutoHeal = process.env.DENIZEN_AUTO_HEAL;
  });

  afterEach(() => {
    if (origAutoHeal === undefined) delete process.env.DENIZEN_AUTO_HEAL;
    else process.env.DENIZEN_AUTO_HEAL = origAutoHeal;
  });

  it('adviseScale recommends restart when LM Studio is down', () => {
    const plan = meshScaleAdvisor.adviseScale({
      pressures: ['lm_studio_down'],
      severity: 'critical',
    });
    assert.ok(plan.actions.some((a) => a.type === 'restart_lm_studio' && a.auto_eligible));
  });

  it('adviseScale recommends reclaim and BYOK when mesh saturated', () => {
    const plan = meshScaleAdvisor.adviseScale({
      pressures: ['mesh_queue_saturated', 'stuck_assignments'],
      severity: 'high',
    });
    assert.ok(plan.actions.some((a) => a.type === 'reclaim_stale_jobs'));
    assert.ok(plan.actions.some((a) => a.type === 'route_byok'));
  });

  it('executeAutoScale skips when DENIZEN_AUTO_HEAL is off', async () => {
    delete process.env.DENIZEN_AUTO_HEAL;
    const r = await meshScaleAdvisor.executeAutoScale({
      signals: { pressures: ['lm_studio_down'] },
    });
    assert.equal(r.skipped, true);
  });

  it('executeAutoScale reclaims jobs when auto-heal enabled', async () => {
    process.env.DENIZEN_AUTO_HEAL = '1';
    const broadcasts = [];
    const r = await meshScaleAdvisor.executeAutoScale({
      signals: { pressures: ['mesh_queue_saturated', 'stuck_assignments'] },
      deps: {
        computeQueue: {
          reclaimStaleJobs: async () => ({ reclaimed: 2 }),
          expireOldQueuedJobs: async () => ({ expired: 1 }),
        },
      },
      broadcast: (m) => broadcasts.push(m),
    });
    assert.equal(r.ok, true);
    assert.ok(r.executed.some((e) => e.type === 'reclaim_stale_jobs'));
    assert.ok(broadcasts.some((b) => b.type === 'mesh_scale_action'));
  });
});
