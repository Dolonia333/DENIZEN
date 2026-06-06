#!/usr/bin/env node
'use strict';
/**
 * Align data/voice-map.json with npc-roster gender fields.
 *
 *   node scripts/sync-voice-map.js           # print diff, no write
 *   node scripts/sync-voice-map.js --write   # assign voices by gender pools + save
 */

const fs = require('fs');
const path = require('path');
const roster = require('../src/npc-roster');
const voiceResolve = require('../src/voice-resolve');

const mapPath = path.join(__dirname, '..', 'data', 'voice-map.json');
const write = process.argv.includes('--write');

let current = {};
try {
  current = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
} catch (err) {
  console.error('Could not read voice-map.json:', err.message);
  process.exit(1);
}

const next = voiceResolve.applyRosterToVoiceMap(current, roster, {
  assignMissingVoices: true,
  reassignByGender: true,
});
next.autoAssignByGender = true;

const changes = [];
for (const e of roster.entries) {
  const name = e.display;
  const before = current.npcs?.[name];
  const after = next.npcs?.[name];
  if (!after) continue;
  if (before?.voiceId !== after.voiceId || before?.gender !== after.gender) {
    changes.push({ name, gender: after.gender, voiceId: after.voiceId, was: before?.voiceId });
  }
}

if (changes.length === 0) {
  console.log('voice-map.json already aligned with roster gender.');
} else {
  console.log('Changes:');
  for (const c of changes) {
    console.log(`  ${c.name} (${c.gender}): ${c.was || '(none)'} → ${c.voiceId}`);
  }
}

if (write) {
  fs.writeFileSync(mapPath, JSON.stringify(next, null, 2) + '\n');
  console.log(`Wrote ${mapPath}`);
} else if (changes.length) {
  console.log('\nDry run — pass --write to save.');
}
