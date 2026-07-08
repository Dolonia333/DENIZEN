'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const links = require('../src/auth/denizen-team-invite-links.js');

describe('denizen-team-invite-links', () => {
  it('buildJoinUrl encodes team code in query', () => {
    const url = links.buildJoinUrl('1921', 'https://denizen.example.com');
    assert.equal(url, 'https://denizen.example.com/office?join=1921');
  });

  it('buildShortJoinUrl uses invite path', () => {
    const url = links.buildShortJoinUrl('1921', 'https://denizen.example.com');
    assert.equal(url, 'https://denizen.example.com/invite/1921');
  });

  it('buildInviteEmailText includes Windows desktop installer', () => {
    const text = links.buildInviteEmailText({
      name: 'Grandpa',
      inviterName: 'Zion',
      orgSlug: 'zion',
      orgDisplayName: 'Dolonia',
      teamCode: '1921',
      baseUrl: 'https://denizen.example.com',
      platform: 'windows',
    });
    assert.match(text, /invite\/1921/);
    assert.match(text, /Denizen-Setup\.exe/i);
    assert.match(text, /STEP 2/);
  });
});
