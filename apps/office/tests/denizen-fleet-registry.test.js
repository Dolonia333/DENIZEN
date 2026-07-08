'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

describe('denizen-fleet-registry', () => {
  let fleetRegistry;

  beforeEach(() => {
    // Fresh module state per test
    delete require.cache[require.resolve('../src/denizen-fleet-registry')];
    fleetRegistry = require('../src/denizen-fleet-registry');
  });

  it('buildFleetSummary(null) aggregates machines across identities', () => {
    fleetRegistry.upsertMachine('identity-a', 'desktop-aaa', {
      role: 'desktop',
      label: 'GPU PC',
      contributing: true,
    });
    fleetRegistry.upsertMachine('identity-b', 'desktop-bbb', {
      role: 'node',
      label: 'Worker',
      contributing: true,
    });

    const summary = fleetRegistry.buildFleetSummary(null);
    assert.equal(summary.fleet.length, 2);
    assert.ok(summary.fleet.some((m) => m.machine_id === 'desktop-aaa'));
    assert.ok(summary.fleet.some((m) => m.machine_id === 'desktop-bbb'));
  });
});
