'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const bridge = require('../src/denizen-station-skill-bridge');

describe('denizen-station-skill-bridge', () => {
  it('routes browserclaw to desktop_agent on the station', () => {
    const route = bridge.resolveStationRoute('browserclaw', { task: 'Apply to the Indeed job on screen' });
    assert.equal(route.kind, 'desktop_agent');
    assert.match(route.instruction, /Indeed/i);
    assert.match(route.instruction, /mouse and keyboard/i);
  });

  it('routes file-read to file_read', () => {
    const route = bridge.resolveStationRoute('file-read', { path: '~/Documents/notes.txt' });
    assert.equal(route.kind, 'file_read');
    assert.equal(route.payload.path, '~/Documents/notes.txt');
  });

  it('does not route cloud-only skills', () => {
    assert.equal(bridge.resolveStationRoute('supabase', { task: 'list tables' }), null);
    assert.equal(bridge.resolveStationRoute('crm-summary', {}), null);
  });

  it('shouldRouteSkillToStation covers cowork skills', () => {
    assert.equal(bridge.shouldRouteSkillToStation('coding-agent'), true);
    assert.equal(bridge.shouldRouteSkillToStation('denizen-data'), false);
  });
});
