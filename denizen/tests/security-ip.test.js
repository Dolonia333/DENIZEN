'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const securityIp = require('../src/security-ip');

describe('security-ip', () => {
  let prevHost;

  beforeEach(() => {
    prevHost = process.env.DENIZEN_HOST_IP;
  });

  afterEach(() => {
    if (prevHost === undefined) delete process.env.DENIZEN_HOST_IP;
    else process.env.DENIZEN_HOST_IP = prevHost;
  });

  it('treats loopback as internal', () => {
    assert.equal(securityIp.isInternalThreatSource('127.0.0.1'), true);
    assert.equal(securityIp.isInternalThreatSource('localhost'), true);
  });

  it('treats DENIZEN_HOST_IP as internal', () => {
    process.env.DENIZEN_HOST_IP = '192.168.1.232';
    assert.equal(securityIp.isHostOperatorIp('192.168.1.232'), true);
    assert.equal(securityIp.isInternalThreatSource('192.168.1.232'), true);
    assert.equal(securityIp.isInternalThreatSource('192.168.1.232', { force: true }), false);
  });

  it('allows external IPs', () => {
    process.env.DENIZEN_HOST_IP = '192.168.1.232';
    assert.equal(securityIp.isInternalThreatSource('203.0.113.50'), false);
  });
});
