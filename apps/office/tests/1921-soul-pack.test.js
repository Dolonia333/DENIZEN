'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const roster = require('../src/npc/npc-roster.js');

const NPCS_DIR = path.join(__dirname, '..', 'npcs');
const MARKER = /1921|DDT|OMES|YMP7Z9T1WVX5/i;

describe('1921 soul pack', () => {
  it('every roster NPC soul mentions 1921 context', () => {
    const missing = [];
    for (const { folder, display } of roster.entries) {
      const soulPath = path.join(NPCS_DIR, folder, 'SOUL.md');
      const text = fs.readFileSync(soulPath, 'utf8');
      if (!MARKER.test(text)) missing.push(display);
    }
    assert.equal(missing.length, 0, `missing 1921 context: ${missing.join(', ')}`);
  });
});
