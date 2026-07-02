'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createSentenceStream, pickFiller, trimSentence } = require('../src/voice-sentence.js');

describe('voice-sentence', () => {
  it('emits complete sentences from streaming buffer', () => {
    const out = [];
    const stream = createSentenceStream((text, index) => out.push({ text, index }));
    stream.push('Hello there. ');
    stream.push('How are you?');
    stream.flush();
    assert.equal(out.length, 2);
    assert.match(out[0].text, /Hello there/);
    assert.match(out[1].text, /How are you/);
  });

  it('pickFiller returns stable short phrase', () => {
    assert.equal(typeof pickFiller('Lucy'), 'string');
    assert.ok(pickFiller('Lucy').length < 20);
  });

  it('trimSentence collapses whitespace', () => {
    assert.equal(trimSentence('  hi   there  '), 'hi there');
  });
});
