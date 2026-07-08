'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const stationCapabilities = require('../src/station/denizen-station-capabilities');
const stationTaskQueue = require('../src/station/denizen-station-task-queue');
const stationRouter = require('../src/station/denizen-station-router');

describe('denizen-station-capabilities', () => {
  it('maps skills to capability keys', () => {
    assert.equal(stationCapabilities.capabilityForSkill('desktop-agent'), 'screen_access');
    assert.equal(stationCapabilities.capabilityForSkill('file-read'), 'read_files');
  });

  it('denies when capability is off', () => {
    const profile = {
      desktop_capabilities: {
        read_files: true,
        write_files: false,
        run_code: false,
        screen_access: false,
      },
    };
    const check = stationCapabilities.assertCapability(profile, null, { skill: 'desktop-agent' });
    assert.equal(check.ok, false);
    assert.match(check.error, /screen access/i);
  });

  it('detects online stations from recent sync', () => {
    const profile = {
      desktop_install_id: 'abc',
      setup_wizard_completed: true,
      last_capability_sync_at: new Date().toISOString(),
    };
    assert.equal(stationCapabilities.stationIsOnline(profile), true);
  });
});

describe('denizen-station-router', () => {
  it('shouldRouteToStation is false when sync is stale', () => {
    const profile = {
      desktop_install_id: 'abc',
      setup_wizard_completed: true,
      client_type: 'desktop',
      last_capability_sync_at: '2020-01-01T00:00:00.000Z',
    };
    assert.equal(stationRouter.shouldRouteToStation(profile), false);
  });

  it('routeOrRunHost returns station_offline without host runner when linked but stale', async () => {
    const result = await stationRouter.routeOrRunHost({
      sessionId: 'offline-session',
      npcName: 'Lucy',
      kind: 'file_read',
      skill: 'file-read',
      instruction: '/tmp/x',
      permissionLevel: 'trusted',
      hostRunner: null,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason || result.summary, /offline|pair/i);
  });
});

describe('denizen-station-task-queue', () => {
  it('enqueues, claims, and completes tasks', async () => {
    const enqueued = await stationTaskQueue.enqueueTask({
      sessionId: 'sess-1',
      installId: 'install-1',
      kind: 'screen_observe',
      instruction: 'look at screen',
    });
    assert.equal(enqueued.queued, true);

    const claimed = await stationTaskQueue.claimTask('install-1');
    assert.equal(claimed.id, enqueued.task.id);
    assert.equal(claimed.status, 'claimed');

    const waitPromise = stationTaskQueue.waitForTask(enqueued.task.id, { timeoutMs: 2000 });
    await stationTaskQueue.completeTask(enqueued.task.id, { ok: true, summary: 'done' });
    const completed = await waitPromise;
    assert.equal(completed.result.summary, 'done');
  });

  it('rejects duplicate pending tasks for same install', async () => {
    await stationTaskQueue.enqueueTask({
      sessionId: 'sess-2',
      installId: 'install-2',
      kind: 'file_read',
      instruction: '/tmp/x',
    });
    const second = await stationTaskQueue.enqueueTask({
      sessionId: 'sess-2',
      installId: 'install-2',
      kind: 'file_read',
      instruction: '/tmp/y',
    });
    assert.equal(second.queued, false);
    assert.equal(second.error, 'station_busy');
  });
});
