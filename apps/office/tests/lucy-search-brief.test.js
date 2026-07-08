'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildRuleBasedBrief, isJunkSearchQuery, firstSentences } = require('../src/lucy-search-brief');

describe('lucy-search-brief', () => {
  it('flags junk queries', () => {
    assert.equal(isJunkSearchQuery('search'), true);
    assert.equal(isJunkSearchQuery('on the web'), true);
    assert.equal(isJunkSearchQuery('Goldendoodles'), false);
  });

  it('builds plain-English brief', () => {
    const text = buildRuleBasedBrief('Goldendoodles', [
      { title: 'Goldendoodle Breed Guide', url: 'https://example.com/golden' },
      { title: 'GANA Association', url: 'https://goldendoodleassociation.com/' },
    ]);
    assert.match(text, /Quick brief on Goldendoodles/);
    assert.match(text, /tell me more/i);
    assert.doesNotMatch(text, /https:\/\//);
  });

  it('summarizes read page content when available', () => {
    const text = buildRuleBasedBrief('Goldendoodles', [
      { title: 'Goldendoodle Breed Guide', url: 'https://example.com/golden' },
    ], {
      readPages: [{
        title: 'Goldendoodle Guide',
        url: 'https://example.com/golden',
        text: 'Goldendoodles are a cross between Golden Retrievers and Poodles. They are friendly family dogs. Grooming needs vary by coat type.',
      }],
    });
    assert.match(text, /read example\.com/i);
    assert.match(text, /friendly family dogs/i);
    assert.doesNotMatch(text, /Quick brief on/);
  });

  it('firstSentences trims to readable excerpt', () => {
    const s = firstSentences('One. Two. Three. Four. Five.');
    assert.match(s, /^One\./);
  });
});
