'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

describe('denizen-conversation-sense', () => {
  let sense;

  before(() => {
    sense = require('../src/denizen-conversation-sense');
  });

  it('classifies short casual as concise/expressive-ish', () => {
    const feat = sense.analyzeUtterance('lol fr bro idk');
    assert.equal(feat.casual, 1);
    assert.ok(feat.wordCount <= 6);
    const c = sense.classifyStyle({
      n: 10,
      ...feat,
      questions: 0,
      exclaims: 0,
      tech: 0,
      social: 0,
      friction: 0,
      warm: 0,
    });
    assert.ok(['concise', 'expressive', 'social', 'balanced'].includes(c.primary));
  });

  it('classifies technical friction', () => {
    const feat = sense.analyzeUtterance('The docker deploy pipeline is broken again, API error 500 on /oauth');
    assert.equal(feat.tech, 1);
    assert.equal(feat.friction, 1);
    const c = sense.classifyStyle({
      n: 12,
      len: feat.len,
      wordCount: feat.wordCount,
      emoji: 0,
      questions: 0,
      exclaims: 0,
      casual: 0,
      tech: 1,
      social: 0,
      friction: 1,
      warm: 0,
      capsRatio: 0.1,
      avgWordLen: 5,
    });
    assert.ok(['technical', 'frustrated', 'analytical'].includes(c.primary)
      || c.types.includes('technical')
      || c.types.includes('frustrated'));
  });

  it('observeChat + getPersonStyle adapts', () => {
    const uid = `test-user-${Date.now()}`;
    for (let i = 0; i < 6; i += 1) {
      const r = sense.observeChat({
        userId: uid,
        guildId: 'guild-test-1',
        content: 'yo whats up lol fr wanna hop in vc later?',
        source: 'test',
      });
      assert.equal(r.ok, true);
    }
    const person = sense.getPersonStyle(uid);
    assert.equal(person.known, true);
    assert.ok(person.n >= 5);
    assert.ok(person.primary);

    const block = sense.buildAdaptationBlock({
      userId: uid,
      guildId: 'guild-test-1',
      content: 'help the deploy is broken',
    });
    assert.match(block.block, /Conversation sense|style|How to talk/i);
    assert.ok(block.person.known);
  });

  it('scorecard ok', () => {
    const sc = sense.buildSenseScorecard();
    assert.equal(sc.ok, true);
    assert.ok(typeof sc.peopleKnown === 'number');
  });
});
