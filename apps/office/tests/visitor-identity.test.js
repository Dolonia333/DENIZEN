'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const userIdentity = require('../src/auth/denizen-user-identity.js');

describe('denizen-user-identity', () => {
  it('normalizeEmail lowercases and trims', () => {
    assert.equal(userIdentity.normalizeEmail('  User@Example.COM '), 'user@example.com');
  });

  it('toClientIdentity shapes safe client payload', () => {
    const out = userIdentity.toClientIdentity({
      id: 'abc',
      email_normalized: 'a@b.com',
      display_name: 'Alex',
      tier: 'demo',
      login_count: 2,
      notify_email: true,
      subscription_status: 'none',
    });
    assert.equal(out.email, 'a@b.com');
    assert.equal(out.returning, true);
    assert.equal(out.tier, 'demo');
  });

  it('mapChatRowsToMemories maps roles to display names', () => {
    const mem = userIdentity.mapChatRowsToMemories(
      [
        { role: 'user', content: 'hi' },
        { role: 'npc', content: 'hello' },
      ],
      'Lucy',
      'Zion',
    );
    assert.equal(mem[0].from, 'Zion');
    assert.equal(mem[1].from, 'Lucy');
  });
});
