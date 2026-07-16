'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const roster = require('../src/npc-roster.js');
const demo = require('../src/demo-roster.js');

describe('public demo roster', () => {
  it('uses eight canonical folder IDs and includes Marcus', () => {
    assert.equal(demo.DEFAULT_PUBLIC_DEMO_FOLDERS.length, 8);
    assert.ok(demo.DEFAULT_PUBLIC_DEMO_FOLDERS.includes('conference_man'));
    assert.ok(!demo.DEFAULT_PUBLIC_DEMO_FOLDERS.includes('marcus'));

    const entries = demo.filterRosterEntries(roster.entries);
    assert.equal(entries.length, 8);
    assert.ok(entries.some((entry) => entry.display === 'Marcus'));
  });

  it('keeps the browser and server defaults in sync', () => {
    const browserSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'public-demo-mode.js'),
      'utf8',
    );
    for (const folder of demo.DEFAULT_PUBLIC_DEMO_FOLDERS) {
      assert.match(browserSource, new RegExp(`['"]${folder}['"]`));
    }
  });

  it('only trims server brains when both public-demo flags are enabled', () => {
    assert.equal(demo.publicDemoNpcFolders({ DENIZEN_PUBLIC_DEMO: 'true' }), null);
    assert.deepEqual(demo.publicDemoNpcFolders({
      DENIZEN_PUBLIC_DEMO: 'true',
      DENIZEN_PUBLIC_DEMO_TRIM_BRAINS: 'true',
    }), demo.DEFAULT_PUBLIC_DEMO_FOLDERS);
  });
});
