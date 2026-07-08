'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const downloads = require('../src/desktop/denizen-desktop-downloads.js');
const links = require('../src/auth/denizen-team-invite-links.js');

describe('denizen-desktop-downloads', () => {
  it('exposes macOS dmg URL', () => {
    assert.match(downloads.MACOS_DESKTOP_URL, /Denizen\.dmg$/);
  });

  it('maps platform to correct download', () => {
    assert.match(downloads.desktopDownloadUrlForPlatform('mac'), /Denizen\.dmg$/);
    assert.match(downloads.desktopDownloadUrlForPlatform('windows'), /Denizen-Setup\.exe$/);
  });
});

describe('denizen-team-invite-links mac', () => {
  it('buildInviteEmailText includes macOS dmg for mac platform', () => {
    const text = links.buildInviteEmailText({
      name: 'Alex',
      teamCode: '1921',
      baseUrl: 'https://denizen.example.com',
      platform: 'mac',
    });
    assert.match(text, /Denizen\.dmg/);
    assert.match(text, /Applications/);
  });
});
