'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ABBY_SOUL = fs.readFileSync(
  path.join(__dirname, '..', 'npcs', 'abby', 'SOUL.md'),
  'utf-8',
);

describe('Abby soul depth', () => {
  it('includes capture playbook sections', () => {
    assert.match(ABBY_SOUL, /## Capture & GovCon/);
    assert.match(ABBY_SOUL, /## Skill Playbook/);
    assert.match(ABBY_SOUL, /## Weekly Operating Rhythm/);
  });

  it('knows active pursuit and partnership', () => {
    assert.match(ABBY_SOUL, /OMES EV00000919/i);
    assert.match(ABBY_SOUL, /RM Cyber/i);
    assert.match(ABBY_SOUL, /Benjamin Ballard/i);
    assert.match(ABBY_SOUL, /teaming agreement/i);
  });

  it('knows ecosystem beyond DENIZEN', () => {
    assert.match(ABBY_SOUL, /SmartContainer/i);
    assert.match(ABBY_SOUL, /I\.W\.I\.N\./i);
    assert.match(ABBY_SOUL, /WOSB|MBE|SDB/i);
  });
});
