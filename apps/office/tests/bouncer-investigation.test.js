'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const bouncerInvestigation = require('../src/bouncer-investigation');

describe('bouncer-investigation', () => {
  it('takeInvestigationSlot blocks internal sources', () => {
    const gate = bouncerInvestigation.takeInvestigationSlot({
      category: 'brute_force',
      source: '127.0.0.1',
    });
    assert.equal(gate.allowed, false);
    assert.equal(gate.loopback, true);
  });

  it('takeInvestigationSlot allows force on internal', () => {
    const gate = bouncerInvestigation.takeInvestigationSlot(
      { category: 'scan_probe', source: 'test', force: true },
      { force: true },
    );
    assert.equal(gate.allowed, true);
    assert.equal(gate.forced, true);
  });

  it('createLinuxAgentBridge exposes investigate', () => {
    const bridge = bouncerInvestigation.createLinuxAgentBridge();
    assert.equal(typeof bridge.investigate, 'function');
    assert.equal(typeof bridge.perimeterPatrol, 'function');
    assert.equal(typeof bridge.buildReport, 'function');
  });
});
