'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const invitePlatform = require('../src/denizen-invite-platform.js');

describe('denizen-invite-platform', () => {
  it('normalizes mac platform aliases', () => {
    assert.equal(invitePlatform.normalizeInvitePlatform('macos'), 'mac');
    assert.equal(invitePlatform.normalizeInvitePlatform('darwin'), 'mac');
  });

  it('builds platform-specific email subjects', () => {
    assert.match(
      invitePlatform.inviteEmailSubject({ orgDisplayName: 'Dolonia', platform: 'mac' }),
      /Mac setup/,
    );
    assert.match(
      invitePlatform.inviteEmailSubject({ orgDisplayName: 'Dolonia', platform: 'windows' }),
      /Windows setup/,
    );
  });

  it('returns dmg url for mac installer', () => {
    assert.match(invitePlatform.desktopInstallerUrl('mac'), /Denizen\.dmg$/);
  });
});
