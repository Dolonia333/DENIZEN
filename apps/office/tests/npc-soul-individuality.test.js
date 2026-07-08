'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const roster = require('../src/npc/npc-roster');

describe('NPC SOUL individuality', () => {
  for (const entry of roster.entries) {
    it(`${entry.display} SOUL has voice + teammate ownership`, () => {
      const soulPath = path.join(__dirname, '..', 'npcs', entry.folder, 'SOUL.md');
      const soul = fs.readFileSync(soulPath, 'utf8');
      assert.match(soul, /## Personality\r?\n/m, `${entry.display}: missing Personality`);
      assert.match(soul, /## Personality Quirks\r?\n/m, `${entry.display}: missing Personality Quirks`);
      assert.match(soul, /filler phrase is/i, `${entry.display}: missing filler phrase`);
      assert.match(soul, /## Idle Phrases\r?\n/m, `${entry.display}: missing Idle Phrases`);
      assert.match(soul, /## Teammate Ownership \(defer in character\)/m, `${entry.display}: missing Teammate Ownership`);
      assert.match(soul, /## Opinions\r?\n/m, `${entry.display}: missing Opinions`);
    });
  }
});
