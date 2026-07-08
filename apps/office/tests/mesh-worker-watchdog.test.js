'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const watchdog = require('../src/mesh-worker-watchdog');

describe('mesh-worker-watchdog', () => {
  it('classifyFleet detects stale and offline nodes', () => {
    const now = Date.now();
    const fleet = [
      { machine_id: 'a', updated_at: new Date(now).toISOString(), reachable: true },
      { machine_id: 'b', updated_at: new Date(now - 10 * 60 * 1000).toISOString(), reachable: true, stale: true },
      { machine_id: 'c', reachable: false },
    ];
    const { stale, offline, healthy } = watchdog.classifyFleet(fleet);
    assert.equal(offline.length, 1);
    assert.equal(stale.length, 1);
    assert.equal(healthy.length, 1);
  });

  it('runWatchdogTick emits queue_deep alert', async () => {
    const broadcasts = [];
    const snap = await watchdog.runWatchdogTick({
      computeQueue: {
        listPendingJobs: async () => new Array(10).fill({ id: 'j' }),
        listAssignedJobs: async () => [],
        reclaimStaleJobs: async () => ({ reclaimed: 0 }),
        expireOldQueuedJobs: async () => ({ expired: 0 }),
      },
      fleetRegistry: { buildFleetSummary: () => ({ fleet: [] }) },
      broadcast: (m) => broadcasts.push(m),
    });
    assert.equal(snap.pending, 10);
    assert.ok(broadcasts.some((b) => b.type === 'mesh_watchdog_alert'));
    assert.ok(snap.alerts.some((a) => a.code === 'queue_deep'));
  });

  it('runWatchdogTick attaches scale plan when resourcePressure provided', async () => {
    const resourcePressure = require('../src/resource-pressure');
    const snap = await watchdog.runWatchdogTick({
      computeQueue: {
        listPendingJobs: async () => new Array(10).fill({ id: 'j' }),
        listAssignedJobs: async () => [],
        reclaimStaleJobs: async () => ({ reclaimed: 0 }),
        expireOldQueuedJobs: async () => ({ expired: 0 }),
      },
      fleetRegistry: { buildFleetSummary: () => ({ fleet: [] }) },
      resourcePressure,
      probeLmStudio: async () => ({ reachable: false }),
    });
    assert.ok(snap.scale_plan);
    assert.ok(snap.scale_plan.actions.length > 0);
  });
});
