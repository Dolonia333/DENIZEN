'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function extractMethod(src, name) {
  const start = src.indexOf(`  ${name}(`);
  assert.ok(start >= 0, `missing method ${name}`);
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  assert.fail(`unclosed method ${name}`);
}

describe('Living-office furniture & social behaviors', () => {
  it('agent-actions exposes plant, whiteboard, chill, and Abby office verbs', () => {
    const src = read('src/agent-actions.js');
    for (const verb of [
      'waterPlant',
      'useWhiteboard',
      'chillInBreakroom',
      'inviteToManagerOffice',
      'approachManagerOffice',
      'visitCoworker',
    ]) {
      assert.match(src, new RegExp(String.raw`\n  ${verb}\(`), `missing ${verb}`);
    }
    assert.match(src, /_findFurnitureByKind/);
    assert.match(src, /_findFreeCouch/);
  });

  it('nearby furniture awareness includes plants', () => {
    const mgr = read('src/agent-office-manager.js');
    assert.match(mgr, /plant\|pot\|flora\|fern/i);
    assert.match(mgr, /kind = 'plant'/);
  });

  it('break decisions prefer couch chill and support multi-person breaks', () => {
    const mgr = read('src/agent-office-manager.js');
    const breakCase = mgr.match(/case 'break': \{[\s\S]*?\n      case '/);
    assert.ok(breakCase, 'break case');
    assert.match(breakCase[0], /chillInBreakroom/);
    assert.match(breakCase[0], /breakTargetKey/);
  });

  it('decision switch handles tend_plant, whiteboard, office_invite, office_visit', () => {
    const mgr = read('src/agent-office-manager.js');
    for (const action of ['tend_plant', 'whiteboard', 'office_invite', 'office_visit']) {
      assert.match(mgr, new RegExp(String.raw`case '${action}':`), action);
    }
    assert.match(mgr, /_handleManagerOfficeWalkIn/);
    assert.match(mgr, /inviteToManagerOffice/);
  });

  it('Abby busy walk-ins go through Lucy into the directive chain', () => {
    const mgr = read('src/agent-office-manager.js');
    assert.match(mgr, /_isAbbyBusy/);
    const walkIn = extractMethod(mgr, '_handleManagerOfficeWalkIn');
    assert.match(walkIn, /xp_lucy/);
    assert.match(walkIn, /npc_assign_directive/);
    assert.match(walkIn, /to: 'Abby'/);
    assert.match(walkIn, /She's tied up/);
  });

  it('ambient living-office tick is scheduled and covers chill/plant/whiteboard/invite', () => {
    const mgr = read('src/agent-office-manager.js');
    assert.match(mgr, /_tickLivingOfficeBehaviors/);
    assert.match(mgr, /callback: \(\) => this\._tickLivingOfficeBehaviors\(\)/);
    const tick = extractMethod(mgr, '_tickLivingOfficeBehaviors');
    assert.match(tick, /chillInBreakroom/);
    assert.match(tick, /waterPlant/);
    assert.match(tick, /useWhiteboard/);
    assert.match(tick, /inviteToManagerOffice/);
  });

  it('npc-brains decision schema and prompts know the new living-office actions', () => {
    const brains = read('src/npc-brains.js');
    assert.match(brains, /tend_plant/);
    assert.match(brains, /whiteboard/);
    assert.match(brains, /office_invite/);
    assert.match(brains, /office_visit/);
    assert.match(brains, /water or check a potted plant/);
    assert.match(brains, /leave a note with Lucy/);
  });

  it('cache busters bumped for living-office ship', () => {
    const html = read('index.html');
    assert.match(html, /agent-actions\.js\?v=bubbleChip6/);
    assert.match(html, /agent-office-manager\.js\?v=headTrack1/);
    assert.match(html, /floor-strip\.js\?v=mapFill10/);
  });
});
