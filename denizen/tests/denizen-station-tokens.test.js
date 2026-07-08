'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const stationTokens = require('../src/denizen-station-tokens.js');

describe('denizen-station-tokens', () => {
  it('creates and verifies a station token', () => {
    const env = { DENIZEN_STATION_TOKEN_SECRET: 'test-secret' };
    const created = stationTokens.createStationToken({
      identityId: 'id-abc',
      label: 'Rilwan NAS',
      machineId: 'k3yz-nas',
    }, env);
    assert.match(created.station_token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const verified = stationTokens.decodeToken(created.station_token, env);
    assert.equal(verified.identityId, 'id-abc');
    assert.equal(verified.machineId, 'k3yz-nas');
    assert.equal(verified.label, 'Rilwan NAS');
  });

  it('rejects tampered tokens', () => {
    const env = { DENIZEN_STATION_TOKEN_SECRET: 'test-secret' };
    const created = stationTokens.createStationToken({ identityId: 'id-abc' }, env);
    const bad = `${created.station_token}x`;
    assert.equal(stationTokens.decodeToken(bad, env), null);
  });

  it('builds install payload with bundle url', () => {
    const payload = stationTokens.buildProvisionPayload({
      identityId: 'id-abc',
      machine_id: 'k3yz-nas',
      label: 'NAS',
      publicUrl: 'https://denizen.dolonia.cloud',
      stationToken: 'tok.test',
    });
    assert.match(payload.bundle_url, /station_token=tok\.test/);
    assert.match(payload.install_linux, /STATION_TOKEN='tok\.test'/);
  });
});
