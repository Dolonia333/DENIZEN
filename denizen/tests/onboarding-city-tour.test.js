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

describe('Denizen city onboarding', () => {
  it('keeps the first-run city tour short and non-technical', () => {
    const source = read('src/visitor-onboarding.js');
    const steps = arrayBlock(source, 'STEP_DEFS');

    assert.equal(countStepIds(steps), 6);
    assert.match(source, /A denizen is someone who belongs to a place/);
    assert.match(source, /work somewhere in the dark/);
    assert.match(source, /They move to a desk/);
    assert.match(source, /Ask\. Watch\. Know\./);
    assert.match(source, /Your city key/);
    assert.match(source, /beginning of your Denizen citizenship/);
    assert.match(source, /Help keep the lights on/);
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

  it('uses the city language on the phone home screen', () => {
    const source = read('src/denizen-phone-ui.js');

    assert.match(source, /label: 'Citizen ID'/);
    assert.match(source, /label: 'City Power'/);
    assert.match(source, /label: 'City Tour'/);
    assert.match(source, /label: 'Power Tour'/);
    assert.match(source, /label: 'City Guide'/);
  });

  it('attaches visitor onboarding during normal office startup', () => {
    const source = read('src/player-chat.js');

    assert.match(source, /if \(scene\) this\._attachVisitorUi\(\)/);
    assert.match(source, /DenizenVisitorOnboarding\.attach\(this\.scene, this\)/);
    assert.match(source, /upgrade\(scene, agentManager\)[\s\S]*?this\._attachVisitorUi\(\)/);
  });

  it('keeps the City Power entry surface in city language', () => {
    const nodeUi = read('src/visitor-node-ui.js');
    const sidebar = read('src/mobile-sidebar.js');

    assert.match(nodeUi, />Power the city</);
    assert.match(nodeUi, />POWER STATION</);
    assert.match(nodeUi, /make this computer a city station/);
    assert.match(sidebar, />Citizen ID</);
    assert.match(sidebar, />City Power</);
    assert.match(sidebar, /Your place in Denizen/);
  });
});
