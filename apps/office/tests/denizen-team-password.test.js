'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../src/auth/denizen-team-password.js');

describe('denizen-team-password', () => {
  it('hashes and verifies passwords', () => {
    const stored = hashPassword('hunter2');
    assert.ok(stored.startsWith('scrypt$'));
    assert.equal(verifyPassword('hunter2', stored), true);
    assert.equal(verifyPassword('wrong', stored), false);
  });
});
