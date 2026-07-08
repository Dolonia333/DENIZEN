'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const ambientDialogue = require('../src/ambient-dialogue');

const mockBrains = {
  memories: {
    Alex: [
      { from: 'Josh', text: 'How is that task going for you?' },
      { from: 'Alex', text: 'Almost done with the mood shift logic — no regressions.' },
      { from: 'Roki', text: 'Hey Alex, got two seconds on the chatter bug?' },
      { from: 'Alex', text: 'Hmm. Two seconds. Where is the cooldown logic at?' },
    ],
    Josh: [
      { from: 'Alex', text: 'How is that task going for you?' },
      { from: 'Josh', text: 'UI is looking clean. Just one responsive breakpoint left.' },
    ],
  },
  _cannedResponse(npcName, fromName, message) {
    return `${npcName} canned to ${fromName}`;
  },
  _cleanDisplayText(str) {
    return String(str || '').trim();
  },
};

describe('ambient-dialogue replay corpus', () => {
  before(() => {
    ambientDialogue.resetCorpusCache();
  });

  it('buildCorpus extracts runtime conversation pairs', () => {
    const corpus = ambientDialogue.buildCorpus(mockBrains, { skipDisk: true });
    assert.ok(corpus.pairs.length >= 2);
    const joshAlex = corpus.pairs.find(
      (p) => p.responder === 'Josh' && p.from === 'Alex' && p.source === 'runtime',
    );
    assert.ok(joshAlex);
    assert.match(joshAlex.replied, /responsive breakpoint|UI is looking clean/i);
  });

  it('pickAmbientOpener prefers past lines from initiator', () => {
    ambientDialogue.resetCorpusCache();
    const opener = ambientDialogue.pickAmbientOpener('Alex', 'Josh', mockBrains);
    assert.equal(typeof opener, 'string');
    assert.ok(opener.length > 5);
  });

  it('pickReplayReply returns past LLM reply for matching pair', () => {
    ambientDialogue.resetCorpusCache();
    const reply = ambientDialogue.pickReplayReply(
      'Josh',
      'Alex',
      'How is that task going for you?',
      mockBrains,
    );
    assert.match(reply, /responsive breakpoint|UI is looking clean/i);
  });

  it('generateAmbientPair returns opener and replay reply', () => {
    ambientDialogue.resetCorpusCache();
    const pair = ambientDialogue.generateAmbientPair('Alex', 'Josh', mockBrains);
    assert.ok(pair.opener);
    assert.ok(pair.reply);
    assert.equal(pair.source, 'replay-corpus');
  });

  it('falls back to canned response when no corpus match', () => {
    ambientDialogue.resetCorpusCache();
    const isolated = { memories: {}, _cannedResponse: mockBrains._cannedResponse };
    const reply = ambientDialogue.pickReplayReply(
      'Molly',
      'CEO',
      'totally unrelated xyzzy flibble',
      isolated,
      { corpus: ambientDialogue.buildCorpus(isolated, { skipDisk: true }) },
    );
    assert.equal(reply, 'Molly canned to CEO');
  });

  it('loads pairs from MEMORY.md files on disk', () => {
    ambientDialogue.resetCorpusCache();
    const corpus = ambientDialogue.buildCorpus(mockBrains);
    const alexPairs = corpus.pairs.filter((p) => p.responder === 'Alex');
    assert.ok(alexPairs.length > 0, 'expected Alex MEMORY.md pairs');
  });
});
