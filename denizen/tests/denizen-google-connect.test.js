'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

describe('platform Connect Google', () => {
  let calendar;
  let access;

  before(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.DENIZEN_PUBLIC_URL = 'https://denizen.example';
    delete require.cache[require.resolve('../src/denizen-crm-calendar')];
    calendar = require('../src/denizen-crm-calendar');
    access = require('../src/denizen-crm-access');
  });

  it('asks Google for read-only calendar and gmail on one consent screen', () => {
    const result = calendar.buildGoogleAuthUrl('org-1', 'id-zion', { returnTo: '/api/crm/google/app' });
    assert.equal(result.ok, true);
    assert.match(result.url, /gmail\.readonly/);
    assert.match(result.url, /calendar\.readonly/);
    assert.doesNotMatch(result.url, /gmail\.(send|modify|compose)/);
    assert.equal(result.redirectUri, 'https://denizen.example/api/crm/google/callback');
    assert.equal(calendar.buildGoogleAuthUrl('org-1', '').error, 'identity_required');
  });

  it('seals tokens and keeps each person on their own connection', () => {
    const zion = calendar.sealToken('ya29.zion-access');
    const angela = calendar.sealToken('ya29.angela-access');
    assert.match(zion, /^enc:v1:/);
    assert.equal(calendar.openToken(zion), 'ya29.zion-access');
    const status = calendar.calendarStatus({
      calendarConnections: {
        'id-zion': { google: { access_token: zion, refresh_token: calendar.sealToken('refresh-zion'), email: 'zion@example.com' } },
        'id-angela': { google: { access_token: angela, email: 'angela@example.com' } },
      },
    }, 'id-zion');
    const packed = JSON.stringify(status);
    assert.equal(status.google.connected, true);
    assert.equal(status.google.email, 'zion@example.com');
    assert.equal(status.sendsMail, false);
    assert.equal(packed.includes('ya29'), false);
    assert.equal(packed.includes('angela@example.com'), false);
    assert.equal(packed.includes('refresh-zion'), false);
  });

  it('does not let a workspace save replace or copy OAuth tokens', () => {
    const full = {
      calendarConnections: {
        'id-zion': { google: { access_token: 'enc:zion', email: 'zion@example.com' } },
        'id-angela': { google: { access_token: 'enc:angela', email: 'angela@example.com' } },
      },
    };
    const merged = access.mergeMemberWorkspace(full, {
      calendarConnections: {
        'id-zion': { google: { email: 'zion@example.com', access_token: 'pasted-by-browser' } },
      },
    }, { identityId: 'id-zion', email: 'zion@example.com' });
    assert.equal(merged.calendarConnections['id-zion'].google.access_token, 'enc:zion');
    assert.equal(merged.calendarConnections['id-angela'].google.access_token, 'enc:angela');
    const visible = access.calendarConnectionsForIdentity(merged.calendarConnections, 'id-zion');
    assert.equal(visible['id-zion'].google.access_token, undefined);
    assert.equal(visible['id-zion'].google.email, 'zion@example.com');
  });

  it('renders Connect Google without a key-paste form', () => {
    const html = calendar.renderConnectPage({
      signedIn: true,
      sessionId: 'sess',
      status: calendar.calendarStatus({}, 'id-zion'),
    });
    assert.match(html, /Connect Google/);
    assert.doesNotMatch(html, /client secret/i);
    assert.doesNotMatch(html, /<input[^>]+type="password"/i);
    if (!calendar.calendarStatus({}, null).googleConfigured) {
      assert.match(html, /GOOGLE_CLIENT_ID/);
    } else {
      assert.match(html, /api\/crm\/google\/connect/);
    }
  });
});
