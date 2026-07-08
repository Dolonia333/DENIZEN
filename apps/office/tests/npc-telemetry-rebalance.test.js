'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const reb = require('../src/npc/npc-telemetry-rebalance.js');

describe('npc-telemetry-rebalance', () => {
  it('applies Claude standing thresholds', () => {
    assert.equal(reb.effectiveThinkMinMs('Bouncer', 120000), 150000);
    assert.equal(reb.effectiveMemoryChars('Bob', 350), 280);
    assert.equal(reb.rebalanceFor('Bouncer').memoryFlushTokenThreshold, 2000);
    assert.equal(reb.rebalanceFor('Bob').compressTokenThreshold, 1500);
    assert.equal(reb.metricsThresholds('Bouncer').latencyMs, 4000);
  });
});
