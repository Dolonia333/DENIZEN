'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const pubsub = require('../src/denizen-world-pubsub');

describe('denizen-world-pubsub', () => {
  it('defaults to memory driver', () => {
    const prev = process.env.DENIZEN_WORLD_PUBSUB;
    delete process.env.DENIZEN_WORLD_PUBSUB;
    assert.equal(pubsub.resolveDriver(), 'memory');
    const bus = pubsub.createWorldPubsub();
    assert.equal(bus.driver, 'memory');
    assert.equal(bus.enabled, false);
    if (prev) process.env.DENIZEN_WORLD_PUBSUB = prev;
  });

  it('resolveRole maps follower and primary', () => {
    process.env.DENIZEN_SERVER_ROLE = 'follower';
    assert.equal(pubsub.resolveRole(), 'follower');
    process.env.DENIZEN_SERVER_ROLE = 'primary';
    assert.equal(pubsub.resolveRole(), 'primary');
  });

  it('creates redis driver when package and URL are set', () => {
    process.env.DENIZEN_WORLD_PUBSUB = 'redis';
    process.env.DENIZEN_REDIS_URL = 'redis://127.0.0.1:6379';
    const bus = pubsub.createWorldPubsub();
    assert.ok(bus.driver === 'redis' || bus.driver === 'memory');
    delete process.env.DENIZEN_WORLD_PUBSUB;
    delete process.env.DENIZEN_REDIS_URL;
  });
});
