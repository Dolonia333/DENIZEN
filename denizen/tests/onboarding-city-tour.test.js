'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function arrayBlock(source, declaration) {
  const match = source.match(new RegExp(`const ${declaration} = \\[([\\s\\S]*?)\\n  \\];`));
  assert.ok(match, `expected ${declaration} array`);
  return match[1];
}

function countStepIds(block) {
  return [...block.matchAll(/\n\s+id:\s*'[^']+'/g)].length;
}

describe('Denizen office onboarding', () => {
  it('keeps the first-run office tour short and non-technical', () => {
    const source = read('src/visitor-onboarding.js');
    const steps = arrayBlock(source, 'STEP_DEFS');

    // Welcome → Buzz → assistant. City Power is the Power Tour's job.
    assert.equal(countStepIds(steps), 3);
    assert.match(source, /Hey — I work here too\. Use me\./);
    assert.match(source, /Denizen starts as an AI office you can actually see/);
    assert.match(source, /stay close to what happens next/);
    assert.match(source, /They move to a desk and keep the work visible/);
    assert.match(source, /Hey — I work here too\./);
    assert.match(source, /I'm Buzz — your office key/);
    assert.match(source, /your Citizen ID keeps that relationship connected/);
    assert.doesNotMatch(steps, /City Power|Power the city/);
    assert.match(source, /--onb-accent: #7dd3fc/);
    assert.match(source, /--onb-amber: #f59e0b/);
    assert.match(source, /font-family: var\(--onb-mono\)/);
    assert.match(source, /onb-buzz-phone/);
    assert.doesNotMatch(steps, /GPU\/CPU|BYOK|LM Studio|mesh jobs|capability matrix/i);
  });

  it('keeps the optional power tour focused on user choices', () => {
    const source = read('src/visitor-superuser-onboarding.js');
    const steps = arrayBlock(source, 'STEPS');

    assert.equal(countStepIds(steps), 5);
    assert.match(steps, /Connect your station/);
    assert.match(steps, /Choose how much to give/);
    assert.match(steps, /You stay in control/);
    assert.doesNotMatch(steps, /GPU\/CPU|LM Studio|queue|operator/i);
  });

  it('uses office-first language on the phone home screen', () => {
    const source = read('src/denizen-phone-ui.js');

    assert.match(source, /label: 'Citizen ID'/);
    assert.match(source, /label: 'City Power'/);
    assert.match(source, /label: 'Link Station'/);
    assert.match(source, /label: 'Office Tour'/);
    assert.doesNotMatch(source, /label: 'Power Tour'/);
    assert.doesNotMatch(source, /label: 'Office Guide'/);
    assert.doesNotMatch(source, /id: 'meshtour'/);
    assert.doesNotMatch(source, /id: 'guide',/);
  });

  it('attaches visitor onboarding during normal office startup', () => {
    const source = read('src/player-chat.js');

    assert.match(source, /if \(scene\) this\._attachVisitorUi\(\)/);
    assert.match(source, /DenizenVisitorOnboarding\.attach\(this\.scene, this\)/);
    assert.match(source, /upgrade\(scene, agentManager\)[\s\S]*?this\._attachVisitorUi\(\)/);
  });

  it('keeps City Power framed as office station to city power', () => {
    const nodeUi = read('src/visitor-node-ui.js');
    const sidebar = read('src/mobile-sidebar.js');

    assert.match(nodeUi, />Power the city</);
    assert.match(nodeUi, />POWER STATION</);
    assert.match(nodeUi, /Connect Desktop app/);
    assert.match(nodeUi, /make this computer your office station|Link browser to Denizen Desktop/);
    assert.match(sidebar, />Citizen ID</);
    assert.match(sidebar, />City Power</);
    assert.match(sidebar, /Your place in Denizen/);
  });
});
