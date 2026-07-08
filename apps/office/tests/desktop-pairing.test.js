'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createPairingToken,
  claimPairingToken,
  buildPairingResponse,
} = require('../src/denizen-desktop-pairing.js');

describe('denizen-desktop-pairing', () => {
  it('creates and claims a pairing token once', () => {
    const token = createPairingToken({
      sessionId: 'sess-test-1',
      sessionToken: 'tok-abc',
      serverUrl: 'https://denizen.dolonia.cloud',
    });
    assert.ok(token.includes('.'));

    const claimed = claimPairingToken(token);
    assert.equal(claimed.session_id, 'sess-test-1');
    assert.equal(claimed.session_token, 'tok-abc');
    assert.equal(claimed.server_url, 'https://denizen.dolonia.cloud');

    const replay = claimPairingToken(token);
    assert.equal(replay, null);
  });

  it('buildPairingResponse includes deep link', () => {
    const token = createPairingToken({
      sessionId: 's2',
      sessionToken: null,
      serverUrl: 'http://localhost:8081',
    });
    const resp = buildPairingResponse(token, 'http://localhost:8081');
    assert.equal(resp.ok, true);
    assert.ok(resp.deep_link.startsWith('denizen://pair?'));
    assert.equal(resp.expires_in_sec, 300);
  });
});
