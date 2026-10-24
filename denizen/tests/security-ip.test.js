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
    process.env.DENIZEN_HOST_IP = '192.168.50.20';
    assert.equal(securityIp.isHostOperatorIp('192.168.50.20'), true);
    assert.equal(securityIp.isInternalThreatSource('192.168.50.20'), true);
    assert.equal(securityIp.isInternalThreatSource('192.168.50.20', { force: true }), false);
  });

  it('treats RFC1918 LAN as internal without DENIZEN_HOST_IP', () => {
    delete process.env.DENIZEN_HOST_IP;
    assert.equal(securityIp.isPrivateLan('192.168.50.20'), true);
    assert.equal(securityIp.isInternalThreatSource('192.168.50.20'), true);
    assert.equal(securityIp.isInternalThreatSource('10.0.0.5'), true);
    assert.equal(securityIp.isInternalThreatSource('172.16.4.1'), true);
  });

  it('allows external IPs', () => {
    process.env.DENIZEN_HOST_IP = '192.168.50.20';
    assert.equal(securityIp.isInternalThreatSource('203.0.113.50'), false);
    assert.equal(securityIp.isInternalThreatSource('8.8.8.8'), false);
  });
});
