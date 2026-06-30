'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const npcRoster = require('../src/npc-roster');

const NPCS_DIR = path.join(__dirname, '..', 'npcs');

describe('soul depth — all roster NPCs', () => {
  for (const entry of npcRoster.entries) {
    const soul = fs.readFileSync(path.join(NPCS_DIR, entry.folder, 'SOUL.md'), 'utf-8');
    const label = `${entry.display} (${entry.folder})`;

    it(`${label} has skill playbook`, () => {
      assert.match(soul, /## Skill Playbook/);
    });

    it(`${label} has weekly operating rhythm`, () => {
      assert.match(soul, /## Weekly Operating Rhythm/);
    });

    it(`${label} has never-guess boundary`, () => {
      assert.match(soul, /## Never Guess\r?\n/i);
    });

    it(`${label} knows 1921 pursuit context`, () => {
      assert.match(soul, /OMES|RM Cyber|1921 Holding|UEI/i);
    });

    it(`${label} has operating playbook section`, () => {
      assert.match(soul, /## .+ Operating Playbook/);
    });
  }
});
