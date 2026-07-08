'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isBouncerPatrolEnabled,
  getPatrolProbeTargets,
} = require('../src/security/linux-agent');

test('isBouncerPatrolEnabled respects explicit env', () => {
  const prev = process.env.BOUNCER_PATROL;
  try {
    process.env.BOUNCER_PATROL = '0';
    assert.equal(isBouncerPatrolEnabled(), false);
    process.env.BOUNCER_PATROL = '1';
    assert.equal(isBouncerPatrolEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.BOUNCER_PATROL;
    else process.env.BOUNCER_PATROL = prev;
  }
});

test('getPatrolProbeTargets uses PORT and LM_STUDIO_REMOTE_URLS', () => {
  const prevPort = process.env.PORT;
  const prevLm = process.env.LM_STUDIO_URL;
  const prevRemote = process.env.LM_STUDIO_REMOTE_URLS;
  try {
    process.env.PORT = '8888';
    delete process.env.LM_STUDIO_URL;
    process.env.LM_STUDIO_REMOTE_URLS = 'http://192.168.1.232:1234';
    const t = getPatrolProbeTargets();
    assert.equal(t.ws.port, 8888);
    assert.equal(t.lm.host, '192.168.1.232');
    assert.equal(t.lm.port, 1234);
  } finally {
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    if (prevLm === undefined) delete process.env.LM_STUDIO_URL;
    else process.env.LM_STUDIO_URL = prevLm;
    if (prevRemote === undefined) delete process.env.LM_STUDIO_REMOTE_URLS;
    else process.env.LM_STUDIO_REMOTE_URLS = prevRemote;
  }
});
